"""Rachael Ray Nutrish dog food scraper.

Strategy:
1. Discover all dog product URLs from WordPress product sitemap
2. Filter out cat products, variety packs, and adventure packs
3. Parse each product page for ingredients, GA, calories, AAFCO statement
4. GA uses unique `...` separator format (e.g. "Crude Protein (Min.)...23.0%")

Source: nutrish.com — WordPress 6.x SSR, no JS rendering needed, no bot protection.
"""

import logging
import re
from pathlib import Path
from xml.etree import ElementTree

from bs4 import BeautifulSoup, Tag
from wafer import SyncSession

from .common import (
    GuaranteedAnalysis,
    Product,
    clean_text,
    normalize_calorie_content,
    write_brand_json,
)

logger = logging.getLogger(__name__)

BRAND = "Rachael Ray Nutrish"
WEBSITE_URL = "https://www.nutrish.com"
SITEMAP_URL = "https://www.nutrish.com/wp-sitemap-posts-product-1.xml"

# Slugs containing these are skipped (variety packs, cat products)
_SKIP_PATTERNS = [
    "variety-pack",
    "adventure-pack",
    "cat-food",
    "cat-treat",
    "for-cats",
    "wet-cat",
    "dry-cat",
    "lickable-complements",
]

# GA field mapping for Nutrish's `...` separated format
_GA_LABEL_MAP: dict[str, str] = {
    "crude protein": "crude_protein",
    "crude fat": "crude_fat",
    "crude fiber": "crude_fiber",
    "crude fibre": "crude_fiber",
    "moisture": "moisture",
    "calcium": "calcium",
    "phosphorus": "phosphorus",
    "omega-6 fatty acids": "omega_6",
    "omega 6 fatty acids": "omega_6",
    "omega-3 fatty acids": "omega_3",
    "omega 3 fatty acids": "omega_3",
    "linoleic acid": "omega_6",
    "eicosapentaenoic (epa) + docosahexaenoic acid (dha)": "epa_dha",
    "epa + dha": "epa_dha",
    "glucosamine": "glucosamine",
    "chondroitin sulfate": "chondroitin",
    "chondroitin": "chondroitin",
    "l-carnitine": "l_carnitine",
    "taurine": "taurine",
    "dha": "dha",
}

_MAX_BY_DEFAULT = {"crude_fiber", "moisture", "ash"}
_MG_KG_FIELDS = {"glucosamine", "chondroitin", "l_carnitine"}


def _slug_from_url(url: str) -> str:
    """Extract slug from URL like https://...com/product/slug/."""
    path = url.rstrip("/").split("/")[-1]
    return path


def _is_dog_product(url: str) -> bool:
    """Check if a sitemap URL is a dog product (not cat, not variety pack)."""
    slug = _slug_from_url(url)
    # Must contain 'dog' in slug
    if "dog" not in slug:
        return False
    # Skip variety packs and cat products
    for pattern in _SKIP_PATTERNS:
        if pattern in slug:
            return False
    return True


def _detect_format(slug: str, name: str) -> str:
    """Detect product format from slug/name."""
    lower = slug + " " + name.lower()
    if "dry-dog-food" in slug or "dry dog food" in name.lower():
        return "dry"
    if "wet-dog-food" in slug or "wet dog food" in name.lower():
        return "wet"
    # Treats are "dry" format
    if "dog-treat" in slug or "dog-chew" in slug:
        return "dry"
    # Stews, paw pie, muttballs, stroganwoof = wet
    if any(kw in lower for kw in ("stew", "paw pie", "muttball", "stroganwoof",
                                   "chunks in gravy", "premium pate", "paté")):
        return "wet"
    return "dry"


def _detect_type(slug: str) -> str:
    """Detect product type: food or treat."""
    if "dog-treat" in slug or "dog-chew" in slug:
        return "treat"
    return "food"


def _detect_sub_brand(name: str) -> str:
    """Detect sub-brand from product name."""
    lower = name.lower()
    if "dish" in lower and "dish" in name:
        return "Dish"
    if "big life" in lower:
        return "Big Life"
    if "zero grain" in lower or "grain free" in lower or "grain-free" in lower:
        return "Zero Grain"
    if "peak protein" in lower:
        return "Peak Protein"
    return ""


def _detect_life_stage(aafco: str, name: str) -> str:
    """Detect life stage from AAFCO statement or product name."""
    lower = (aafco + " " + name).lower()
    if "puppy" in lower or "growth" in lower:
        return "puppy"
    if "all life stages" in lower or "all stages" in lower:
        return "all"
    return "adult"


def _parse_ga_dots(text: str) -> GuaranteedAnalysis:
    """Parse GA from Nutrish's `...` separated format.

    Example: "Crude Protein (Min.)...23.0%, Crude Fat (Min.)...13.0%"
    Each entry is separated by commas (at the top level, outside parentheses).
    Within each entry, the label and value are separated by `...` (or `…`).
    """
    ga: dict[str, float] = {}

    # Normalize ellipsis character to three dots
    text = text.replace("…", "...")

    # Split on commas, but respect parentheses for entries like
    # "Eicosapentaenoic (EPA) + Docosahexaenoic Acid (DHA) (Min.)...0.05%"
    entries: list[str] = []
    current: list[str] = []
    depth = 0
    for char in text:
        if char == "(":
            depth += 1
            current.append(char)
        elif char == ")":
            depth -= 1
            current.append(char)
        elif char == "," and depth == 0:
            entry = "".join(current).strip()
            if entry:
                entries.append(entry)
            current = []
        else:
            current.append(char)
    last = "".join(current).strip()
    if last:
        entries.append(last)

    for entry in entries:
        # Split on ... to get label and value
        if "..." not in entry:
            continue
        parts = entry.split("...")
        if len(parts) < 2:
            continue
        label_raw = parts[0].strip()
        value_raw = parts[-1].strip()

        label_lower = label_raw.lower()

        # Detect min/max from label
        is_max = bool(re.search(r"\(max\.?\)", label_lower))
        is_min = bool(re.search(r"\(min\.?\)", label_lower))

        # Clean label: remove (Min.), (Max.), asterisks
        label_clean = re.sub(r"\s*\((?:min|max)\.?\)\s*", " ", label_lower).strip()
        label_clean = label_clean.strip("* ")

        # Check for mg/kg
        is_mg_kg = bool(re.search(r"mg\s*/\s*kg", value_raw, re.IGNORECASE))
        # Also check for IU/kg — skip these (vitamins, not GA)
        is_iu = bool(re.search(r"iu\s*/\s*kg", value_raw, re.IGNORECASE))
        if is_iu:
            continue

        # Extract numeric value
        num_match = re.search(r"([\d,]+\.?\d*)\s*(?:%|mg)", value_raw)
        if not num_match:
            num_match = re.search(r"([\d,]+\.?\d*)", value_raw)
        if not num_match:
            continue
        value = float(num_match.group(1).replace(",", ""))

        # Match to field name
        field_base = None

        # Try exact match first
        field_base = _GA_LABEL_MAP.get(label_clean)

        # Try partial match
        if not field_base:
            for known_label, field in _GA_LABEL_MAP.items():
                if known_label in label_clean or label_clean in known_label:
                    field_base = field
                    break

        if not field_base:
            logger.debug(f"  → unrecognized GA label: {label_clean}")
            continue

        # Handle combined EPA+DHA field
        if field_base == "epa_dha":
            # Store as combined — we don't split since source gives combined
            # Use a custom suffix; the DB doesn't have epa_dha but
            # we can store as epa_min (the combined value)
            # Actually, skip this — it's not a standard GA field
            continue

        # Determine suffix
        if is_max:
            suffix = "_max"
        elif is_min:
            suffix = "_min"
        elif field_base in _MAX_BY_DEFAULT:
            suffix = "_max"
        else:
            suffix = "_min"

        # Convert mg/kg to percentage for non-mg/kg fields
        if is_mg_kg and field_base not in _MG_KG_FIELDS:
            value = round(value / 10000, 4)

        ga[f"{field_base}{suffix}"] = value

    return ga  # type: ignore[return-value]


def _parse_product_page(html: str) -> dict:
    """Parse a Nutrish product page for nutrition data.

    Returns dict with keys: name, ingredients_raw, guaranteed_analysis,
    calorie_content, aafco_statement, image_url.
    """
    soup = BeautifulSoup(html, "lxml")
    result: dict = {
        "name": None,
        "ingredients_raw": None,
        "guaranteed_analysis": None,
        "calorie_content": None,
        "aafco_statement": None,
        "image_url": None,
        "discontinued": False,
    }

    # --- Check for discontinued ---
    body_text_quick = soup.get_text()
    if "This product has been discontinued" in body_text_quick:
        result["discontinued"] = True

    # --- Product name from <title> or <h1> ---
    title_tag = soup.find("title")
    if title_tag:
        title = clean_text(title_tag.get_text())
        # Remove "- Nutrish" suffix and brand prefix
        title = re.sub(r"\s*[-–|]\s*Nutrish.*$", "", title)
        result["name"] = title

    # Also try h1
    h1 = soup.find("h1")
    if h1:
        h1_text = clean_text(h1.get_text())
        if h1_text and len(h1_text) > 10:
            result["name"] = h1_text

    # --- Product image ---
    # Look for og:image meta tag
    og_img = soup.find("meta", property="og:image")
    if og_img and isinstance(og_img, Tag):
        img_url = og_img.get("content", "")
        if img_url:
            result["image_url"] = str(img_url)

    # --- Parse nutrition from Bootstrap accordion structure ---
    # Each section is a <button class="accordion-button"> with the heading text,
    # and the content is in the parent's next sibling <div>.

    def _accordion_text(heading: str) -> str | None:
        """Find accordion button with heading text and return content div text."""
        for btn in soup.find_all("button", class_="accordion-button"):
            btn_text = btn.get_text(strip=True)
            if heading.lower() in btn_text.lower():
                parent = btn.parent
                if parent:
                    content_div = parent.find_next_sibling("div")
                    if content_div:
                        return content_div.get_text(separator=" ").strip()
        return None

    # --- Guaranteed Analysis ---
    ga_text = _accordion_text("Guaranteed Analysis")
    if ga_text:
        # Remove footnote text starting with *
        ga_text = re.sub(r"\s*\*Not recognized.*$", "", ga_text, flags=re.IGNORECASE)
        ga = _parse_ga_dots(ga_text)
        if ga:
            result["guaranteed_analysis"] = ga

    # --- Calorie Content ---
    cal_text = _accordion_text("Calorie Content")
    if cal_text:
        normalized = normalize_calorie_content(cal_text)
        if normalized:
            result["calorie_content"] = normalized

    # --- AAFCO / Nutritional Statement ---
    aafco_text = _accordion_text("Nutritional Statement")
    if aafco_text:
        result["aafco_statement"] = clean_text(aafco_text)

    # --- Ingredients ---
    # Ingredients are inside an accordion, with an inner <h3> "Ingredients"
    # followed by a <div> with the actual ingredient text.
    ing_text = _accordion_text("Ingredients")
    if ing_text:
        # The accordion content starts with "Ingredients" heading text, strip it
        ing_text = re.sub(r"^\s*Ingredients\s*", "", ing_text).strip()
        if ing_text:
            result["ingredients_raw"] = clean_text(ing_text)

    return result


def _discover_dog_urls(session: SyncSession) -> list[str]:
    """Discover all dog product URLs from the WordPress sitemap."""
    logger.info(f"Fetching sitemap: {SITEMAP_URL}")
    resp = session.get(SITEMAP_URL)
    if not resp.ok:
        raise RuntimeError(f"Failed to fetch sitemap: {resp.status_code}")

    # Parse XML sitemap
    root = ElementTree.fromstring(resp.text)
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}

    urls: list[str] = []
    for url_elem in root.findall("s:url", ns):
        loc = url_elem.find("s:loc", ns)
        if loc is not None and loc.text:
            url = loc.text.strip()
            if _is_dog_product(url):
                urls.append(url)

    logger.info(f"Found {len(urls)} dog product URLs in sitemap")
    return urls


def scrape_nutrish(output_dir: Path) -> int:
    """Scrape Rachael Ray Nutrish dog food products from nutrish.com."""
    session = SyncSession(rate_limit=1.5)
    products: list[Product] = []
    errors: list[str] = []

    # Discover product URLs from sitemap
    dog_urls = _discover_dog_urls(session)

    for url in dog_urls:
        slug = _slug_from_url(url)
        logger.info(f"Processing: {slug}")

        try:
            resp = session.get(url)
            if not resp.ok:
                logger.warning(f"  → HTTP {resp.status_code}: {url}")
                errors.append(f"{slug}: HTTP {resp.status_code}")
                continue
        except Exception as e:
            logger.error(f"  → fetch failed: {e}")
            errors.append(f"{slug}: {e}")
            continue

        parsed = _parse_product_page(resp.text)

        if parsed.get("discontinued"):
            logger.info(f"  → SKIPPED (discontinued)")
            continue

        # Build clean product name
        name = parsed["name"] or slug.replace("-", " ").title()
        # Strip brand prefix patterns
        name = re.sub(
            r"^Rachael\s+Ray\s+Nutrish\s+", "Rachael Ray Nutrish ", name,
            flags=re.IGNORECASE,
        )
        # Normalize the brand prefix
        name = re.sub(r"^Rachael Ray\s*®?\s*Nutrish\s*™?\s*", "Rachael Ray Nutrish ", name)
        name = name.strip()

        product_type = _detect_type(slug)
        product_format = _detect_format(slug, name)
        sub_brand = _detect_sub_brand(name)
        aafco = parsed.get("aafco_statement") or ""
        life_stage = _detect_life_stage(aafco, name)

        product: Product = {
            "name": name,
            "brand": BRAND,
            "url": url,
            "channel": "retail",
            "product_type": product_type,
            "product_format": product_format,
        }

        if sub_brand:
            product["sub_brand"] = sub_brand
        if life_stage:
            product["life_stage"] = life_stage
        if parsed["ingredients_raw"]:
            product["ingredients_raw"] = parsed["ingredients_raw"]
        if parsed["guaranteed_analysis"]:
            product["guaranteed_analysis"] = parsed["guaranteed_analysis"]
            product["guaranteed_analysis_basis"] = "as-fed"
        if parsed["calorie_content"]:
            product["calorie_content"] = parsed["calorie_content"]
        if parsed["aafco_statement"]:
            product["aafco_statement"] = parsed["aafco_statement"]
        if parsed["image_url"]:
            product["images"] = [parsed["image_url"]]

        products.append(product)

        has_ing = "yes" if parsed["ingredients_raw"] else "NO"
        has_ga = "yes" if parsed["guaranteed_analysis"] else "NO"
        has_cal = "yes" if parsed["calorie_content"] else "NO"
        logger.info(f"  → ingredients={has_ing}, GA={has_ga}, calories={has_cal}")

    # Summary
    if errors:
        logger.warning(
            f"\n{'='*60}\n"
            f"ERRORS — {len(errors)} products failed:\n"
            + "\n".join(f"  - {e}" for e in errors)
            + f"\n{'='*60}"
        )

    complete = sum(
        1 for p in products
        if p.get("ingredients_raw") and p.get("guaranteed_analysis") and p.get("calorie_content")
    )
    logger.info(f"Complete: {complete}/{len(products)} products have full nutrition data")

    write_brand_json(BRAND, WEBSITE_URL, products, output_dir, slug="nutrish")
    return len(products)
