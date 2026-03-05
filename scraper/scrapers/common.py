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
    product_type: str  # "dry", "wet", "treats", "supplements"
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
) -> None:
    """Write scraped products to JSON with metadata envelope."""
    file_slug = slug or brand.lower().replace(" ", "").replace("'", "")
    output_path = output_dir / f"{file_slug}.json"

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

    # Generate processed images for this brand
    _process_brand_images(file_slug)


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


def _process_brand_images(brand_slug: str) -> None:
    """Generate small+large WebP images for a single brand."""
    brand_src = IMAGES_DATA_DIR / brand_slug
    if not brand_src.is_dir():
        return

    small_brand = SMALL_DIR / brand_slug
    large_brand = LARGE_DIR / brand_slug
    small_brand.mkdir(parents=True, exist_ok=True)
    large_brand.mkdir(parents=True, exist_ok=True)

    small_count = 0
    large_count = 0

    for img_path in brand_src.iterdir():
        if img_path.suffix.lower() not in (".webp", ".png", ".jpg"):
            continue

        dest_name = f"{img_path.stem}.webp"

        try:
            img = _open_and_convert(img_path)

            small_img = _resize_to_width(img, SMALL_WIDTH)
            small_img.save(small_brand / dest_name, "WEBP", quality=80)
            small_count += 1

            large_img = _resize_to_width(img, LARGE_MAX_WIDTH)
            large_img.save(large_brand / dest_name, "WEBP", quality=85)
            large_count += 1
        except Exception as e:
            print(f"  Failed to process {img_path.name}: {e}", file=sys.stderr)

    logger.info(f"Generated {small_count} small + {large_count} large images for {brand_slug}")


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
    # Insert space at camelCase boundaries (e.g. "CanolaOil" → "Canola Oil")
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    # Normalize whitespace: collapse runs, strip
    text = re.sub(r"[ \t]+", " ", text)
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
}

# Suffixes that indicate min or max — ordered longest first to avoid partial replacement
_MIN_KEYWORDS = ["(min.)", "(min)", "minimum", "min.", "min"]
_MAX_KEYWORDS = ["(max.)", "(max)", "maximum", "max.", "max"]


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

        value = _extract_percentage(value_text)
        if value is not None:
            ga[field_name] = value

        # If 3+ columns, second might be min and third max
        if len(cell_texts) >= 3:
            val2 = _extract_percentage(cell_texts[2])
            if val2 is not None and value is not None:
                # First was min, second is max
                ga[f"{field_base}_min"] = value
                ga[f"{field_base}_max"] = val2

    return ga  # type: ignore[return-value]


def _extract_percentage(text: str) -> float | None:
    """Extract a percentage number from text like '26%', '26.0 %', '26'."""
    m = re.search(r"(\d+\.?\d*)\s*%?", text)
    if m:
        return float(m.group(1))
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

    # Match kcal, cal, kilocalories — and tolerate mg/kg typos for kg extraction
    _CAL = r"(?:kcals?|kilocalories?|cal)"
    _CAL_KG = r"(?:kcals?|kilocalories?|cal|mg)"

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
        parts.append(f"{int(float(cup_match.group(1)))} kcal/{cup_unit}")

    return ", ".join(parts) if parts else raw.strip()


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
