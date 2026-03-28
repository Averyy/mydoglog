"""Shared types, JSON writer, and parsers for dog food scrapers."""

import html as html_mod
import json
import logging
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import NotRequired, TypedDict

import httpx
from PIL import Image

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Image config
# ---------------------------------------------------------------------------
IMAGES_DATA_DIR = Path(__file__).parent.parent / "data" / "images"
_IMAGE_WORKERS = 10

PROJECT_ROOT = Path(__file__).parent.parent.parent
SMALL_DIR = PROJECT_ROOT / "public" / "products-small"
LARGE_DIR = PROJECT_ROOT / "public" / "products-large"
SMALL_WIDTH = 100
LARGE_MAX_WIDTH = 800

# Map content-type to file extension
_CONTENT_TYPE_EXT: dict[str, str] = {
    "image/webp": ".webp",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
}


# --- Output schema TypedDicts ---


class GuaranteedAnalysis(TypedDict, total=False):
    crude_protein_min: float
    crude_protein_max: float
    crude_fat_min: float
    crude_fat_max: float
    crude_fiber_max: float
    moisture_max: float
    ash_max: float
    # Less common but present on some products
    calcium_min: float
    calcium_max: float
    phosphorus_min: float
    phosphorus_max: float
    omega_6_min: float
    omega_3_min: float
    glucosamine_min: float
    chondroitin_min: float
    epa_min: float
    dha_min: float
    l_carnitine_min: float
    taurine_min: float
    potassium_min: float
    sodium_min: float
    sodium_max: float
    copper_min: float
    collagen_min: float


class Variant(TypedDict):
    size_kg: float
    size_description: str
    upc: NotRequired[str]
    sku: NotRequired[str]


class Product(TypedDict):
    name: str
    brand: str
    sub_brand: NotRequired[str]
    product_line: NotRequired[str]
    url: str
    channel: str  # "retail" or "vet"
    product_type: str  # "food", "treat", or "supplement"
    product_format: str  # "dry" or "wet"
    ingredients_raw: NotRequired[str]
    guaranteed_analysis: NotRequired[GuaranteedAnalysis]
    guaranteed_analysis_basis: NotRequired[str]  # "as-fed" or "dry-matter"
    calorie_content: NotRequired[str]
    aafco_statement: NotRequired[str]
    life_stage: NotRequired[str]
    breed_size: NotRequired[str]
    health_tags: NotRequired[list[str]]
    images: NotRequired[list[str]]
    variants: NotRequired[list[Variant]]
    source_id: NotRequired[str]  # brand-specific product ID


class BrandEnvelope(TypedDict):
    brand: str
    website_url: str
    scraped_at: str
    scraper_version: str
    stats: dict
    products: list[Product]


# --- JSON writer ---

SCRAPER_VERSION = "0.1.0"


def write_brand_json(
    brand: str,
    website_url: str,
    products: list[Product],
    output_dir: Path,
    *,
    slug: str | None = None,
    ingredient_overrides: dict[str, str] | None = None,
) -> None:
    """Write scraped products to JSON with metadata envelope."""
    file_slug = slug or brand.lower().replace(" ", "").replace("'", "")
    output_path = output_dir / f"{file_slug}.json"

    # Apply ingredient text fixups before writing
    for p in products:
        if p.get("ingredients_raw"):
            p["ingredients_raw"] = fix_ingredients_raw(
                p["ingredients_raw"], overrides=ingredient_overrides
            )

    # Download product images before writing JSON
    _download_brand_images(brand, products)

    # Compute stats
    channels = {}
    types = {}
    for p in products:
        channels[p["channel"]] = channels.get(p["channel"], 0) + 1
        types[p["product_type"]] = types.get(p["product_type"], 0) + 1

    envelope: BrandEnvelope = {
        "brand": brand,
        "website_url": website_url,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "scraper_version": SCRAPER_VERSION,
        "stats": {
            "product_count": len(products),
            "by_channel": channels,
            "by_type": types,
        },
        "products": products,
    }

    output_path.write_text(json.dumps(envelope, indent=2, ensure_ascii=False))
    logger.info(f"Wrote {len(products)} products to {output_path}")

    # Generate processed images for this brand (auto-remove white backgrounds)
    _process_brand_images(file_slug, remove_bg=True)


# --- Image downloading ---


def _slugify(text: str, max_len: int = 80) -> str:
    """Convert text to a URL-safe slug."""
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = text.strip("-")
    return text[:max_len].rstrip("-")


def _image_stem(brand: str, product_type: str, product_name: str) -> str:
    """Build deterministic image filename stem: {brand}-{type}-{product-name}"""
    return f"{_slugify(brand)}-{_slugify(product_type)}-{_slugify(product_name)}"


def _ext_from_url(url: str) -> str:
    """Guess file extension from URL path. Falls back to empty string."""
    path = url.split("?")[0].split("#")[0]
    if "." in path.split("/")[-1]:
        ext = "." + path.split("/")[-1].rsplit(".", 1)[-1].lower()
        if ext in (".webp", ".png", ".jpg", ".jpeg"):
            return ".jpg" if ext == ".jpeg" else ext
    return ""


def _find_existing(brand_dir: Path, stem: str) -> Path | None:
    """Find an existing image file with this stem in any format."""
    for ext in (".webp", ".png", ".jpg"):
        candidate = brand_dir / f"{stem}{ext}"
        if candidate.exists():
            return candidate
    return None


def download_product_image(
    brand: str,
    product_type: str,
    product_name: str,
    image_url: str,
) -> str | None:
    """Download a product image to data/images/{brand}/, return serving path or None.

    Saves the original image at full resolution in its original format.
    Returns the Next.js serving path: /products/{brand_slug}/{filename}.{ext}
    Skips if file already exists on disk (idempotent).
    """
    brand_slug = _slugify(brand)
    stem = _image_stem(brand, product_type, product_name)
    brand_dir = IMAGES_DATA_DIR / brand_slug

    # Check if already downloaded in any format
    existing = _find_existing(brand_dir, stem)
    if existing:
        return f"/products/{brand_slug}/{existing.name}"

    try:
        resp = httpx.get(image_url, timeout=15, follow_redirects=True, headers={
            "User-Agent": "Mozilla/5.0 (compatible; MyDogLog/1.0)",
        })
        resp.raise_for_status()

        # Determine extension from content-type, fall back to URL
        content_type = resp.headers.get("content-type", "").split(";")[0].strip()
        ext = _CONTENT_TYPE_EXT.get(content_type) or _ext_from_url(image_url) or ".jpg"

        filename = f"{stem}{ext}"
        brand_dir.mkdir(parents=True, exist_ok=True)
        (brand_dir / filename).write_bytes(resp.content)

        return f"/products/{brand_slug}/{filename}"
    except Exception as e:
        logger.warning(f"Image download failed for {brand} - {product_name}: {e}")
        return None


def _resize_to_width(img: Image.Image, target_width: int) -> Image.Image:
    """Resize an image to a target width, maintaining aspect ratio.

    Does not upscale — returns the image unchanged if already smaller.
    """
    w, h = img.size
    if w <= target_width:
        return img
    ratio = target_width / w
    return img.resize((target_width, round(h * ratio)), Image.LANCZOS)


def _open_and_convert(img_path: Path) -> Image.Image:
    """Open an image and convert to RGBA (if transparent) or RGB."""
    img = Image.open(img_path)
    has_alpha = img.mode in ("RGBA", "LA", "PA") or (
        img.mode == "P" and "transparency" in img.info
    )
    return img.convert("RGBA" if has_alpha else "RGB")


def _has_solid_background(
    img: Image.Image, edge_ratio: float = 0.85, max_std: float = 25.0
) -> bool:
    """Detect if an image has a solid-colored background (white, grey, etc.).

    Samples pixels along all four edges and checks if they are uniform enough
    (low standard deviation) and opaque. Catches white, grey, and other
    solid studio backdrops.
    """
    rgba = img.convert("RGBA")
    w, h = rgba.size
    if w < 4 or h < 4:
        return False

    edge_pixels: list[tuple[int, ...]] = []
    for x in range(w):
        edge_pixels.append(rgba.getpixel((x, 0)))
        edge_pixels.append(rgba.getpixel((x, h - 1)))
    for y in range(h):
        edge_pixels.append(rgba.getpixel((0, y)))
        edge_pixels.append(rgba.getpixel((w - 1, y)))

    # Filter to opaque pixels only
    opaque = [p for p in edge_pixels if p[3] > 200]
    if len(opaque) / len(edge_pixels) < edge_ratio:
        return False  # Already has transparency — no removal needed

    # Check if edge colors are uniform (low spread = solid background)
    r_vals = [p[0] for p in opaque]
    g_vals = [p[1] for p in opaque]
    b_vals = [p[2] for p in opaque]

    if len(r_vals) < 2:
        return False

    from statistics import stdev
    r_std = stdev(r_vals)
    g_std = stdev(g_vals)
    b_std = stdev(b_vals)

    return r_std < max_std and g_std < max_std and b_std < max_std


def _remove_background(img: Image.Image) -> Image.Image:
    """Remove background from an image using rembg."""
    from rembg import remove
    return remove(img)


def _process_brand_images(brand_slug: str, *, remove_bg: bool = False) -> None:
    """Generate small+large WebP images for a single brand.

    Args:
        brand_slug: Brand directory name under data/images/
        remove_bg: If True, auto-detect and remove white backgrounds before resizing.
    """
    brand_src = IMAGES_DATA_DIR / brand_slug
    if not brand_src.is_dir():
        return

    small_brand = SMALL_DIR / brand_slug
    large_brand = LARGE_DIR / brand_slug
    small_brand.mkdir(parents=True, exist_ok=True)
    large_brand.mkdir(parents=True, exist_ok=True)

    small_count = 0
    large_count = 0
    bg_removed_count = 0

    for img_path in brand_src.iterdir():
        if img_path.suffix.lower() not in (".webp", ".png", ".jpg"):
            continue

        dest_name = f"{img_path.stem}.webp"

        try:
            img = _open_and_convert(img_path)

            if remove_bg and _has_solid_background(img):
                img = _remove_background(img)
                bg_removed_count += 1

            small_img = _resize_to_width(img, SMALL_WIDTH)
            small_img.save(small_brand / dest_name, "WEBP", quality=80)
            small_count += 1

            large_img = _resize_to_width(img, LARGE_MAX_WIDTH)
            large_img.save(large_brand / dest_name, "WEBP", quality=85)
            large_count += 1
        except Exception as e:
            print(f"  Failed to process {img_path.name}: {e}", file=sys.stderr)

    bg_msg = f", {bg_removed_count} backgrounds removed" if bg_removed_count else ""
    logger.info(f"Generated {small_count} small + {large_count} large images for {brand_slug}{bg_msg}")


def _download_brand_images(brand: str, products: list[Product]) -> None:
    """Download images for all products in a brand, updating dicts in-place."""
    to_download: list[Product] = []
    for p in products:
        images = p.get("images")
        if images and images[0].startswith("http"):
            to_download.append(p)

    if not to_download:
        return

    def _dl(product: Product) -> tuple[Product, str | None]:
        product_brand = product.get("brand", brand)
        images = product["images"]  # type: ignore[index]
        # Try each URL in order (first is preferred, rest are fallbacks)
        for url in images:
            if not url.startswith("http"):
                continue
            result = download_product_image(
                product_brand,
                product.get("product_type", "other"),
                product["name"],
                url,
            )
            if result:
                return (product, result)
        return (product, None)

    downloaded = 0
    with ThreadPoolExecutor(max_workers=_IMAGE_WORKERS) as pool:
        futures = [pool.submit(_dl, p) for p in to_download]
        for future in as_completed(futures):
            product, local_path = future.result()
            if local_path:
                product["images"] = [local_path]
                downloaded += 1

    logger.info(f"Images for {brand}: {downloaded}/{len(to_download)} downloaded")


# --- Text cleaning ---


# Control chars 0x00-0x1F except tab (0x09), newline (0x0A), carriage return (0x0D)
_CONTROL_CHAR_RE = re.compile(
    r"[\x00-\x08\x0b\x0c\x0e-\x1f]"
)

# Purina-specific encoding artifacts: _x001F_, _x000D_, etc.
_PURINA_HEX_RE = re.compile(r"_x([0-9A-Fa-f]{4})_")


def clean_text(text: str) -> str:
    """Strip control characters, normalize whitespace, clean encoding artifacts."""
    # Replace Purina hex artifacts with the actual character (or empty if control)
    def _replace_hex(m: re.Match) -> str:
        code = int(m.group(1), 16)
        if code in (0x09, 0x0A, 0x0D) or code > 0x1F:
            return chr(code)
        return ""

    text = _PURINA_HEX_RE.sub(_replace_hex, text)
    text = _CONTROL_CHAR_RE.sub("", text)
    # Decode HTML entities: &#038; → &, &amp; → &
    text = html_mod.unescape(text)
    # Strip HTML tags: <br>, <br/>, etc. → space
    text = re.sub(r"<[^>]+>", " ", text)
    # Newlines → space (product names should be single-line)
    text = text.replace("\n", " ")
    # Strip trademark/copyright symbols
    text = text.replace("®", "").replace("©", "").replace("™", "")
    # Normalize smart/curly quotes to straight quotes
    text = text.replace("\u2018", "'").replace("\u2019", "'")  # ' '
    text = text.replace("\u201c", '"').replace("\u201d", '"')  # " "
    # Normalize dashes: en-dash (–) and em-dash (—) → ASCII hyphen
    text = text.replace("\u2013", "-").replace("\u2014", "-")
    # Normalize ligatures: ﬂ → fl, ﬁ → fi
    text = text.replace("\ufb02", "fl").replace("\ufb01", "fi")
    # Strip stray backslashes (encoding artifacts, e.g. "vitamin E\ supplement")
    text = text.replace("\\", "")
    # Insert space at camelCase boundaries (e.g. "CanolaOil" → "Canola Oil")
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    # Normalize whitespace: collapse runs, strip (includes \xa0 non-breaking spaces)
    text = re.sub(r"[\s]+", " ", text)
    # Ensure space after commas (e.g. "Sulfate,Riboflavin" → "Sulfate, Riboflavin")
    # But preserve digit,digit thousands separators (e.g. "3,290 kcal/kg")
    text = re.sub(r",(?!\s)(?!\d{1,3}(?:\D|$))", ", ", text)
    # Fix space before comma (e.g. "Chicken , Beef" → "Chicken, Beef")
    text = re.sub(r"\s+,", ",", text)
    return text.strip()


# ---------------------------------------------------------------------------
# Ingredient text fixups (applied after scraping, before JSON output)
# ---------------------------------------------------------------------------

# Global ingredient text replacements for known source data errors.
# Simple string replacements (no regex needed).
_INGREDIENT_RAW_FIXUPS: dict[str, str] = {
    # Missing spaces (scraper concatenation bugs)
    "chickenmeal": "chicken meal",
    "organicspinach": "organic spinach",
    "Pumpkinseeds": "Pumpkin Seeds",
    "guineafowl": "guinea fowl",
    "ground whole axseed": "ground whole flaxseed",
    # DL-methionine formatting variants
    "DLMethionine": "DL-Methionine",
    "DL methionine": "DL-methionine",
    "DL- Methionine": "DL-Methionine",
    # Extra/missing spaces around hyphens
    "freeze- dried": "freeze-dried",
    # Missing comma between ingredients
    "Choline Chloride Dried Chicken Cartilage": "Choline Chloride, Dried Chicken Cartilage",
    "canola oil ( preserved with mixed tocopherols and citric acid )flaxseed": (
        "canola oil (preserved with mixed tocopherols and citric acid), flaxseed"
    ),
}

# Regex-based fixups requiring word boundaries (ligature bugs, etc.).
_INGREDIENT_RAW_REGEX_FIXUPS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bsh oil\b"), "fish oil"),
    (re.compile(r"\boat ber\b"), "oat fiber"),
    (re.compile(r"\bnatural avor\b"), "natural flavor"),
    (re.compile(r"\briboavin\b"), "riboflavin"),
    (re.compile(r"\bbisulte\b"), "bisulfite"),
]

# Regex patterns stripped from the start of ingredients_raw (metadata prefixes).
_INGREDIENT_PREFIX_PATTERNS: list[re.Pattern[str]] = [
    # "INGREDIENTS: ..." prefix
    re.compile(r"^INGREDIENTS:\s*", re.IGNORECASE),
]

# Regex to detect and strip junk text before "Ingredients:" mid-stream.
_INGREDIENT_MIDSTREAM_RE = re.compile(r"^.+?Ingredients:\s+", re.DOTALL)


def fix_ingredients_raw(
    text: str,
    *,
    overrides: dict[str, str] | None = None,
) -> str:
    """Apply global and brand-specific fixups to an ingredients_raw string.

    Call this on every ingredients_raw value before writing to brand JSON.
    """
    # Strip metadata prefixes (e.g. "INGREDIENTS: Chicken, ...")
    for pat in _INGREDIENT_PREFIX_PATTERNS:
        text = pat.sub("", text)

    # Strip junk before mid-stream "Ingredients:" (product metadata bleed)
    m = _INGREDIENT_MIDSTREAM_RE.match(text)
    if m and len(m.group(0)) > 20:
        text = text[m.end():]

    # Apply global string fixups
    for bad, good in _INGREDIENT_RAW_FIXUPS.items():
        text = text.replace(bad, good)

    # Apply regex fixups (word-boundary-aware, e.g. ligature bugs)
    for pat, replacement in _INGREDIENT_RAW_REGEX_FIXUPS:
        text = pat.sub(replacement, text)

    # Apply brand-specific overrides
    if overrides:
        for bad, good in overrides.items():
            text = text.replace(bad, good)

    # Strip trailing disclaimers / production codes that aren't ingredients
    text = re.sub(
        r"\.\s*This is a naturally preserved product.*$", "", text
    )
    text = re.sub(
        r"\.\s*Contains a source of live \(viable\) naturally occurring microorganisms?$",
        "",
        text,
    )
    text = re.sub(r"\.\s*Manufactured in a facility.*$", "", text)
    # Production/lot codes (e.g. "Citric Acid. A-5064-C")
    text = re.sub(r"\.\s+[A-Z]-\d+-[A-Z]$", "", text)

    return text.strip()


# --- GA parsing ---

# Map common GA row labels to our field names
_GA_LABEL_MAP: dict[str, str] = {
    "crude protein": "crude_protein",
    "crude fat": "crude_fat",
    "fat content": "crude_fat",
    "crude fiber": "crude_fiber",
    "crude fibre": "crude_fiber",
    "moisture": "moisture",
    "ash": "ash",
    "calcium": "calcium",
    "phosphorus": "phosphorus",
    "omega-6 fatty acids": "omega_6",
    "omega 6 fatty acids": "omega_6",
    "omega-6": "omega_6",
    "omega-3 fatty acids": "omega_3",
    "omega 3 fatty acids": "omega_3",
    "omega-3": "omega_3",
    "glucosamine": "glucosamine",
    "chondroitin sulfate": "chondroitin",
    "chondroitin": "chondroitin",
    "epa": "epa",
    "dha": "dha",
    "l-carnitine": "l_carnitine",
    "taurine": "taurine",
    "linoleic acid": "omega_6",
    "potassium": "potassium",
    "sodium": "sodium",
    "copper": "copper",
    "protein": "crude_protein",
    "fat": "crude_fat",
    "fiber": "crude_fiber",
    "fibre": "crude_fiber",
    "collagen": "collagen",
}

# Suffixes that indicate min or max — ordered longest first to avoid partial replacement
_MIN_KEYWORDS = ["(min.)", "(min)", "minimum", "min.", "min"]
_MAX_KEYWORDS = ["(max.)", "(max)", "maximum", "max.", "max"]


# GA field patterns for text-based parsing — ordered with longer/more-specific FIRST
GA_TEXT_PATTERNS: list[tuple[str, str]] = [
    (r"omega[\s\-\u2013]*6\s+fatty\s+acid", "omega_6"),
    (r"omega[\s\-\u2013]*6", "omega_6"),
    (r"omega[\s\-\u2013]*3\s+fatty\s+acid", "omega_3"),
    (r"omega[\s\-\u2013]*3", "omega_3"),
    (r"crude\s+protein", "crude_protein"),
    (r"crude\s+fat", "crude_fat"),
    (r"crude\s+fib[re]+", "crude_fiber"),
    (r"\bprotein\b", "crude_protein"),
    (r"\bfat\b", "crude_fat"),
    (r"\bfib[re]+\b", "crude_fiber"),
    (r"moisture", "moisture"),
    (r"\bash\b", "ash"),
    (r"calcium", "calcium"),
    (r"phosphorus", "phosphorus"),
    (r"glucosamine", "glucosamine"),
    (r"chondroitin", "chondroitin"),
    (r"taurine", "taurine"),
    (r"\bdha\b", "dha"),
    (r"\bepa\b", "epa"),
    (r"l-carnitine", "l_carnitine"),
]


def parse_ga_text(text: str) -> GuaranteedAnalysis | None:
    """Parse guaranteed analysis from plain text.

    Handles multiple formats:
    - One value per line: "Crude Protein (min) 26.0%"
    - Comma/semicolon-separated: "Crude Protein (Min) 4.0%, Crude Fat (Min) 1.5%"
    - Jammed/no-separator: "Crude Protein (min) 10.0%Crude Fat (min) 2.00%"
    - Missing '%' sign on core fields: "Moisture (max) 10.0"

    Scopes to the "Guaranteed Analysis" section when present to avoid
    matching marketing copy (e.g. "feed up to 50% more food").
    """
    ga: dict[str, float] = {}
    _MAX_BY_DEFAULT = {"ash", "crude_fiber", "moisture"}

    # Scope to GA section
    ga_start = re.search(
        r"Guaranteed\s+Analysis\s*:?",
        text,
        re.IGNORECASE,
    )
    if ga_start:
        text = text[ga_start.start():]
        ga_end = re.search(
            r"\n\s*(?:Feeding|Calori[ce]|Directions|Transition|AAFCO|Pregnant|Nursing|Amount)",
            text,
            re.IGNORECASE,
        )
        if ga_end:
            text = text[:ga_end.start()]

    # Fix jammed GA formats (no separators between fields)
    text = re.sub(r"Analysis(?=Crude|Moisture)", "Analysis\n", text, flags=re.IGNORECASE)
    text = re.sub(r"\(MIN\)\s*%\s*([\d.]+)", r"\1% MIN", text)
    text = re.sub(r"\(MAX\)\s*%\s*([\d.]+)", r"\1% MAX", text)
    text = re.sub(r"(\d\s*%)(?=[A-Z](?!IN\b|AX\b))", r"\1\n", text)
    text = re.sub(r"(MIN|MAX)(?=[A-Z])", r"\1\n", text)
    text = re.sub(r"((?:mg|IU|CFU)[\u2044/](?:kg|lb))(?=[A-Z*])", r"\1\n", text)

    segments: list[str] = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        pct_count = len(re.findall(r"\d*\.?\d+\s*%", line))
        if pct_count > 1:
            parts = re.split(r"[,;]\s*(?=[A-Z*])", line)
            if len(parts) < pct_count:
                normalized = re.sub(
                    r"(%\.?\s*(?:MIN|MAX|min\.|max\.)?)\s+(?=[A-Z*])",
                    r"\1\n",
                    line,
                )
                parts = [p.strip() for p in normalized.split("\n") if p.strip()]
            segments.extend(parts)
        else:
            segments.append(line)

    for segment in segments:
        segment = segment.strip()
        if not segment:
            continue

        segment_lower = segment.lower()

        for pattern, field_base in GA_TEXT_PATTERNS:
            if not re.search(pattern, segment_lower):
                continue

            is_max = bool(re.search(r"\bmax\b", segment_lower))
            is_min = bool(re.search(r"\bmin\b", segment_lower))

            if not is_max and not is_min:
                if "not more than" in segment_lower:
                    is_max = True
                elif "not less than" in segment_lower:
                    is_min = True

            if not is_max and not is_min:
                is_max = field_base in _MAX_BY_DEFAULT
                is_min = not is_max

            suffix = "_max" if is_max else "_min"

            val_match = re.search(r"(\d*\.?\d+)\s*%", segment)
            if not val_match and field_base in _MAX_BY_DEFAULT | {
                "crude_protein",
                "crude_fat",
            }:
                fallback = re.search(
                    r"(?:min|max)\.?\)?\s+(\d*\.?\d+)(?!\s*mg)",
                    segment,
                    re.IGNORECASE,
                )
                if fallback:
                    val_match = fallback
            if val_match:
                ga[f"{field_base}{suffix}"] = float(val_match.group(1))

            break

    return ga if ga else None  # type: ignore[return-value]


def parse_ga_html_table(html: str) -> GuaranteedAnalysis:
    """Parse a guaranteed analysis HTML table into structured data.

    Handles common formats:
    - Row with label + value (e.g., "Crude Protein (min) 26%")
    - Two-column table (label | value)
    - Three-column table (label | min | max)
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    ga: dict[str, float] = {}

    rows = soup.find_all("tr")
    for row in rows:
        cells = row.find_all(["td", "th"])
        cell_texts = [clean_text(c.get_text()) for c in cells]

        if len(cell_texts) < 2:
            continue

        label_raw = cell_texts[0].lower()

        # Determine min/max from label using regex for word boundaries
        explicit_suffix: str | None = None
        max_match = re.search(r"\(max\.?\)|(?<!\w)max(?:imum)?\.?(?!\w)", label_raw)
        min_match = re.search(r"\(min\.?\)|(?<!\w)min(?:imum)?\.?(?!\w)", label_raw)
        if max_match:
            explicit_suffix = "_max"
            label_raw = label_raw[:max_match.start()] + label_raw[max_match.end():]
            label_raw = label_raw.strip()
        elif min_match:
            explicit_suffix = "_min"
            label_raw = label_raw[:min_match.start()] + label_raw[min_match.end():]
            label_raw = label_raw.strip()

        # Clean up label
        label_raw = label_raw.strip(" .")

        # Match to our field names
        field_base = _GA_LABEL_MAP.get(label_raw)
        if not field_base:
            # Try partial match
            for known_label, field in _GA_LABEL_MAP.items():
                if known_label in label_raw:
                    field_base = field
                    break

        if not field_base:
            continue

        # Determine suffix: use explicit (min)/(max) from the label when
        # present, otherwise apply the AAFCO convention — ash, crude fiber,
        # and moisture are reported as maximums; everything else as minimums.
        _MAX_BY_DEFAULT = {"ash", "crude_fiber", "moisture"}
        if explicit_suffix:
            suffix = explicit_suffix
        elif field_base in _MAX_BY_DEFAULT:
            suffix = "_max"
        else:
            suffix = "_min"

        field_name = f"{field_base}{suffix}"

        # Extract numeric value from second cell (or third for 3-col tables)
        value_text = cell_texts[1]

        # If label had no min/max hint, check value text for "minimum"/"maximum"
        if not max_match and not min_match:
            value_lower = value_text.lower()
            if "maximum" in value_lower or "max" in value_lower:
                suffix = "_max"
                field_name = f"{field_base}{suffix}"
            elif "minimum" in value_lower or "min" in value_lower:
                suffix = "_min"
                field_name = f"{field_base}{suffix}"

        # Fields that are always stored in mg/kg (never percentages)
        _MG_KG_FIELDS = {"glucosamine", "chondroitin", "l_carnitine", "collagen"}

        ga_result = _extract_ga_value(value_text)
        if ga_result is not None:
            value, is_mg_kg = ga_result
            # If the value is in mg/kg but the field normally uses percentages,
            # convert: 1% = 10,000 mg/kg → value_pct = value / 10000 * 100
            if is_mg_kg and field_base not in _MG_KG_FIELDS:
                value = round(value / 10000, 4)
            ga[field_name] = value
        else:
            value = None

        # If 3+ columns, second might be min and third max
        if len(cell_texts) >= 3:
            val2_result = _extract_ga_value(cell_texts[2])
            if val2_result is not None and value is not None:
                val2, is_mg_kg2 = val2_result
                if is_mg_kg2 and field_base not in _MG_KG_FIELDS:
                    val2 = round(val2 / 10000, 4)
                # First was min, second is max
                ga[f"{field_base}_min"] = value
                ga[f"{field_base}_max"] = val2

    # Sanity check: percentage-based GA fields must be <= 100%.
    # Fields like glucosamine/chondroitin/l_carnitine are in mg/kg
    # and can exceed 100, so we only validate true percentage fields.
    _PCT_FIELDS = {
        "crude_protein", "crude_fat", "crude_fiber", "moisture", "ash",
        "calcium", "phosphorus", "omega_6", "omega_3", "epa", "dha",
        "taurine", "potassium", "sodium", "copper",
    }
    bad_keys = [
        k for k, v in ga.items()
        if any(k.startswith(f) for f in _PCT_FIELDS) and v > 100
    ]
    for k in bad_keys:
        logger.warning(f"GA sanity check: dropping {k}={ga[k]} (>100%)")
        del ga[k]

    return ga  # type: ignore[return-value]


def _extract_ga_value(text: str) -> tuple[float, bool] | None:
    """Extract a GA value from text like '26%', '26.0 %', '500 mg/kg'.

    Returns (value, is_mg_kg) or None if no number found.
    """
    is_mg_kg = bool(re.search(r"mg\s*/\s*kg", text, re.IGNORECASE))
    m = re.search(r"(\d*[\d,]*\.?\d+)\s*(?:%|mg)", text)
    if not m:
        m = re.search(r"(\d*[\d,]*\.?\d+)", text)
    if m:
        value = float(m.group(1).replace(",", ""))
        return (value, is_mg_kg)
    return None


def _extract_percentage(text: str) -> float | None:
    """Extract a percentage number from text like '26%', '26.0 %', '26'.

    Legacy wrapper — use _extract_ga_value for mg/kg awareness.
    """
    result = _extract_ga_value(text)
    if result:
        return result[0]
    return None


# --- Calorie normalization ---


def normalize_calorie_content(raw: str) -> str | None:
    """Standardize calorie content to '{kcal/kg}, {kcal/cup}' format.

    Handles inputs like:
    - "3,456 kcal ME/kg; 345 kcal ME/cup"
    - "3456 kcal/kg, 345 kcal/standard cup"
    - "3,790 kcal/kg, 455 kcal/ 120g cup"       (weight before cup)
    - "1,069 kcal/kg, 388 cal/can"               (bare "cal")
    - "3,405 mg/kg, 409 kcal/120 g cup"          (mg/kg typo)
    - "This food contains 3,456 kcal of metabolizable energy (ME) per kilogram
       or 345 kcal ME per cup"
    - "3,200 kcal/kg, 38 kcal/treat"             (treats)
    - "2,996 kcal ME/kg; 86 kcal ME/piece"       (piece → treat)
    - "3,465 kcal/kg, One Bar = 70 kcal"         (bar → treat)
    - "3,050 kcal/kg, 4 kcal/bit"                (bit → treat)
    - "1,030 kcal/kg, 365 kcal/box"              (box/carton)
    """
    if not raw:
        return None

    raw_clean = raw.replace(",", "").lower()
    # Treat period-as-thousands-separator: "3.721 kcal" → "3721 kcal"
    # A digit, period, then exactly 3 digits followed by a non-digit is never a
    # real decimal in calorie values (no food is 3.721 kcal/kg).
    raw_clean = re.sub(r"(\d)\.(\d{3})(?=\D)", r"\1\2", raw_clean)

    # Match kcal, cal, calories, kilocalories — and tolerate mg/kg typos for kg extraction
    _CAL = r"(?:kcals?|kilocalories?|calories?|cals?)"
    _CAL_KG = r"(?:kcals?|kilocalories?|calories?|cals?|mg)"

    # Extract kcal/kg — number immediately before or near kg/kilogram
    kg_match = re.search(
        rf"(\d+\.?\d*)\s*{_CAL_KG}.*?(?:per\s+)?(?:kg|kilogram)",
        raw_clean,
    )
    # Extract kcal/cup, kcal/can, or kcal/treat — find the number closest to
    # the serving-size keyword.
    # Allow "/" as separator, optional weight like "120g" or "120 g" before cup
    # Treat-like units: treat, piece, bar, bit, stix, bone, chew, biscuit
    _TREAT_UNITS = r"(?:treat|piece|bar|bit|stix|bone|chew|biscuit)"
    _SERVING = (
        r"(?:[\d/]+\s*g?\s*)?"
        r"(?:cup|standard\s+cup|measuring\s+cup|can|pouch|box|"
        + _TREAT_UNITS
        + r")"
    )
    cup_match = re.search(
        rf"(\d+\.?\d*)\s*{_CAL}[/\s]*(?:me\s*)?(?:per\s+)?{_SERVING}",
        raw_clean,
    )
    if not cup_match:
        # Fallback: "or {N} kcal/kilocalories ME per cup" / "; {N} kcal/cup"
        cup_match = re.search(
            rf"(?:or|;|,)\s*(\d+\.?\d*)\s*{_CAL}.*?(?:per\s+)?{_SERVING}",
            raw_clean,
        )
    if not cup_match:
        # Fallback: "One Bar = 70 kcal" / "one treat = 38 kcal"
        eq_match = re.search(
            rf"(?:one|1)\s+{_TREAT_UNITS}\s*=\s*(\d+\.?\d*)\s*{_CAL}",
            raw_clean,
        )
        if eq_match:
            cup_match = eq_match

    # Determine the serving unit from the matched text
    cup_unit = "cup"
    if cup_match:
        matched = cup_match.group().lower()
        if "can" in matched and "cup" not in matched:
            cup_unit = "can"
        elif "box" in matched and "cup" not in matched:
            cup_unit = "box"
        elif "pouch" in matched and "cup" not in matched:
            cup_unit = "pouch"
        elif any(u in matched for u in ("treat", "piece", "bar", "bit", "stix", "bone", "chew", "biscuit")):
            if "cup" not in matched:
                cup_unit = "treat"

    parts = []
    if kg_match:
        parts.append(f"{int(float(kg_match.group(1)))} kcal/kg")
    if cup_match:
        val = float(cup_match.group(1))
        # Preserve decimals for per-treat/per-piece values (e.g. 1.73 kcal/treat)
        # but use int for cup/can/pouch where values are always whole numbers
        if cup_unit == "treat" and val != int(val):
            parts.append(f"{val:.2f} kcal/{cup_unit}")
        else:
            parts.append(f"{int(val)} kcal/{cup_unit}")

    if not parts:
        return None
    return ", ".join(parts)


def apply_fallback_data(
    products: list[Product],
    fallback_data: dict[str, dict],
    *,
    override_ga: bool = False,
    match_field: str = "url",
) -> int:
    """Apply manual fallback data to products missing GA or calories.

    Args:
        products: List of products to update in-place.
        fallback_data: URL-pattern-keyed dict with optional keys:
            calorie_content, guaranteed_analysis, guaranteed_analysis_basis.
        override_ga: If True, replace existing GA with fallback GA (used when
            replacing dry-matter GA with verified as-fed GA from Chewy).
            If False, only fill GA when product has none.
        match_field: Product field to match URL patterns against.

    Returns number of products filled.
    """
    filled = 0
    for product in products:
        match_value = product.get(match_field, "")
        for pattern, fields in fallback_data.items():
            if pattern not in match_value:
                continue
            changed = False
            if fields.get("guaranteed_analysis"):
                if override_ga or not product.get("guaranteed_analysis"):
                    product["guaranteed_analysis"] = fields["guaranteed_analysis"]
                    product["guaranteed_analysis_basis"] = fields.get(
                        "guaranteed_analysis_basis", "as-fed"
                    )
                    changed = True
            if fields.get("calorie_content") and not product.get("calorie_content"):
                cal = normalize_calorie_content(fields["calorie_content"])
                if cal:
                    product["calorie_content"] = cal
                    changed = True
            if changed:
                filled += 1
                logger.info(f"  Fallback: filled {product['name'][:50]}")
            break
    if filled:
        logger.info(f"  Fallback filled {filled} products")
    return filled


# --- Chewy.com helpers ---

# Canadian → US spelling normalization for ingredient comparison
_CA_US_SPELLING: dict[str, str] = {
    "flavour": "flavor",
    "flavours": "flavors",
    "fibre": "fiber",
    "colour": "color",
    "colours": "colors",
    "honour": "honor",
    "honours": "honors",
    "savour": "savor",
    "savours": "savors",
    "favourite": "favorite",
    "favourites": "favorites",
    "centre": "center",
    "centres": "centers",
    "metre": "meter",
    "metres": "meters",
    "litre": "liter",
    "litres": "liters",
    "defence": "defense",
    "offence": "offense",
    "licence": "license",
    "practise": "practice",
    "analyse": "analyze",
    "catalyse": "catalyze",
    "mineralised": "mineralized",
    "stabilised": "stabilized",
    "oxidised": "oxidized",
    "sulphate": "sulfate",
    "sulphates": "sulfates",
}


def _normalize_ingredient(name: str) -> str:
    """Normalize an ingredient name for comparison.

    Lowercases, strips whitespace, applies CA→US spelling, and singularizes
    simple trailing-s plurals (potatoes→potato).
    """
    name = name.lower().strip()
    # Apply CA→US spelling map
    for ca, us in _CA_US_SPELLING.items():
        name = name.replace(ca, us)
    # Simple singular/plural normalization: trailing "es" → strip
    # Only for known cases to avoid false matches
    if name.endswith("oes"):
        name = name[:-2]  # potatoes → potato
    elif name.endswith("ies"):
        pass  # keep as-is: berries ≠ berri
    elif name.endswith("s") and not name.endswith("ss"):
        # Strip trailing s only for simple plurals
        name_without_s = name[:-1]
        if len(name_without_s) > 3:
            name = name_without_s
    return name


def chewy_ingredients_match(
    our_ingredients: str, chewy_ingredients: str, n: int = 5
) -> bool:
    """Check if first n ingredients match between our data and Chewy's.

    Conservative: returns True only if all n ingredients match in order.
    Handles CA/US spelling differences and simple plural variations.
    """
    our_list = [s.strip() for s in our_ingredients.split(",") if s.strip()]
    chewy_list = [s.strip() for s in chewy_ingredients.split(",") if s.strip()]

    # If either list has fewer than n ingredients, compare what we have
    compare_count = min(n, len(our_list), len(chewy_list))
    if compare_count == 0:
        return False

    for i in range(compare_count):
        if _normalize_ingredient(our_list[i]) != _normalize_ingredient(chewy_list[i]):
            return False

    return True


def parse_chewy_nutrition(html: str) -> dict:
    """Parse calorie, GA, and ingredient data from a Chewy.com product page.

    Chewy uses predictable section IDs:
    - #CALORIC_CONTENT-section p → calorie text
    - #GUARANTEED_ANALYSIS-section table → GA table
    - #INGREDIENTS-section p → ingredient text

    Returns dict with keys: calorie_content, guaranteed_analysis, ingredients
    (each None if not found).
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")

    result: dict = {
        "calorie_content": None,
        "guaranteed_analysis": None,
        "ingredients": None,
    }

    # Calorie content
    cal_section = soup.find(id="CALORIC_CONTENT-section")
    if cal_section:
        p = cal_section.find("p")
        if p:
            cal_text = clean_text(p.get_text())
            if cal_text:
                result["calorie_content"] = normalize_calorie_content(cal_text)

    # Guaranteed analysis
    ga_section = soup.find(id="GUARANTEED_ANALYSIS-section")
    if ga_section:
        table = ga_section.find("table")
        if table:
            ga = parse_ga_html_table(str(table))
            if ga:
                result["guaranteed_analysis"] = ga

    # Ingredients
    ing_section = soup.find(id="INGREDIENTS-section")
    if ing_section:
        p = ing_section.find("p")
        if p:
            ing_text = clean_text(p.get_text())
            if ing_text and len(ing_text) > 10:
                result["ingredients"] = ing_text

    return result


def search_chewy(query: str, session: "SyncSession") -> str | None:
    """Search Chewy.com and return the first product detail URL, or None.

    Product detail URLs match the pattern /dp/\\d+ at the end.
    """
    search_url = f"https://www.chewy.com/s?query={query.replace(' ', '+')}"
    try:
        resp = session.get(search_url)
    except Exception:
        logger.debug(f"Chewy search failed for: {query}")
        return None

    if not resp.ok:
        logger.debug(f"Chewy search returned {resp.status_code}")
        return None

    # Find product detail links - skip ad tracking/redirect URLs
    # (api/event URLs trigger Kasada and aren't real product pages)
    for match in re.finditer(r'href="(https://www\.chewy\.com/[^"]*?/dp/\d+)"', resp.text):
        url = match.group(1)
        if "/api/" not in url and "&amp;" not in url:
            return url

    # Fallback: relative URLs
    for match in re.finditer(r'href="(/[^"]*?/dp/\d+)"', resp.text):
        url = match.group(1)
        if "/api/" not in url and "&amp;" not in url:
            return f"https://www.chewy.com{url}"

    return None
