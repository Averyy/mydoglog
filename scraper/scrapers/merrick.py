"""Merrick scraper (merrickpetcare.com/canada).

Data source: Drupal 11 SSR with clean HTML sections.
- Discovery: GET /canada/dog-food?page=N → JSON-LD ItemList with product URLs
  Pages are 0-indexed, 12 items/page. Paginate until < 12 items.
- Detail: GET /shop/{slug} or /canada/shop/{slug} → plain HTML
  - Product name + sub-brand: JSON-LD Product schema
  - Ingredients: <h3> "Ingredients" section text
  - GA: <h3> "Guaranteed Analysis" section text (inline or list)
  - Calories: <h3> "Calorie Content" section text
  - Image: JSON-LD Product.image.url or og:image meta tag

Key notes:
- 59 products on Canada catalog (food, treats, toppers)
- Mix of /shop/ (shared US/CA) and /canada/shop/ (CA-specific) URLs
- No anti-bot protection, plain HTML parsing
- GA in two formats: inline "Crude Protein (min)... 23.0%, ..." or list items
- Sub-brands from JSON-LD brand.name (e.g., "Limited Ingredient Diet", "Backcountry")
"""

import json
import logging
import re
from pathlib import Path

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

WEBSITE_URL = "https://www.merrickpetcare.com"
_LISTING_URL = f"{WEBSITE_URL}/canada/dog-food"
_ITEMS_PER_PAGE = 12


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


def _fetch_product_urls(session: SyncSession) -> list[str]:
    """Discover all product URLs from the Canada dog-food listing pages."""
    urls: list[str] = []
    page = 0

    while True:
        url = _LISTING_URL if page == 0 else f"{_LISTING_URL}?page={page}"
        resp = session.get(url)
        if resp.status_code != 200:
            break

        # Extract JSON-LD ItemList
        m = re.search(
            r'<script type="application/ld\+json">(.*?)</script>',
            resp.text,
            re.DOTALL,
        )
        if not m:
            break

        try:
            ld = json.loads(m.group(1))
        except json.JSONDecodeError:
            break

        items = ld.get("@graph", [{}])[0].get("itemListElement", [])
        if not items:
            break

        for item in items:
            product_url = item.get("url", "")
            if product_url and product_url not in urls:
                urls.append(product_url)

        logger.info(f"  Page {page}: {len(items)} items (total unique: {len(urls)})")

        if len(items) < _ITEMS_PER_PAGE:
            break
        page += 1

    return urls


# ---------------------------------------------------------------------------
# Product type / format detection
# ---------------------------------------------------------------------------

_TREAT_KEYWORDS = (
    "treat", "bites", "kisses", "biscuit", "chew", "bone",
)


def _detect_product_type(url: str, name: str) -> str:
    """Detect product type from URL and name."""
    slug = url.lower()
    name_lower = name.lower()

    if "topper" in slug or "bone-broth" in slug or "broth" in name_lower:
        return "supplement"
    for kw in _TREAT_KEYWORDS:
        if kw in slug:
            return "treat"
    return "food"


def _detect_product_format(url: str, product_type: str) -> str:
    """Detect product format from URL."""
    slug = url.lower()

    if "dry" in slug:
        return "dry"
    if "wet" in slug or "can" in slug:
        return "wet"

    # Toppers (bone broth) are wet
    if product_type == "supplement":
        return "wet"
    # Treats default to dry
    if product_type == "treat":
        return "dry"

    return "dry"


def _detect_life_stage(name: str) -> str | None:
    """Detect life stage from product name."""
    name_lower = name.lower()
    if "puppy" in name_lower:
        return "puppy"
    if "senior" in name_lower:
        return "senior"
    return None


def _detect_breed_size(name: str) -> str | None:
    """Detect breed size from product name."""
    name_lower = name.lower()
    if "large breed" in name_lower:
        return "large"
    if "small breed" in name_lower or "lil" in name_lower:
        return "small"
    return None


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------


def _extract_json_ld(html: str) -> dict | None:
    """Extract product JSON-LD from page HTML."""
    m = re.search(
        r'<script type="application/ld\+json">(.*?)</script>',
        html,
        re.DOTALL,
    )
    if not m:
        return None
    try:
        ld = json.loads(m.group(1))
        graph = ld.get("@graph", [])
        for node in graph:
            if node.get("@type") == "Product":
                return node
    except json.JSONDecodeError:
        pass
    return None


def _find_section_text(soup: BeautifulSoup, heading_text: str) -> str | None:
    """Find text content following an h3 heading matching heading_text."""
    for h3 in soup.find_all("h3"):
        h3_text = h3.get_text(strip=True).lower().rstrip(":")
        if heading_text.lower() in h3_text:
            # Collect text from following siblings until next heading
            parts: list[str] = []
            for sibling in h3.next_siblings:
                if isinstance(sibling, Tag):
                    if sibling.name and sibling.name.startswith("h"):
                        break
                    text = sibling.get_text(" ", strip=True)
                    if text:
                        parts.append(text)
            if parts:
                return " ".join(parts)
    return None


def _parse_ingredients(soup: BeautifulSoup) -> str | None:
    """Extract ingredients text from the page."""
    raw = _find_section_text(soup, "ingredients")
    if not raw:
        return None

    text = clean_text(raw)

    # Remove trailing lot code (e.g., "B286423")
    text = re.sub(r"\s*B\d{5,}$", "", text)

    return text if text else None


def _parse_ga_text(text: str) -> GuaranteedAnalysis:
    """Parse GA from inline text or list format.

    Handles:
    - Inline: "Crude Protein (min)... 23.0%, Crude Fat (min)... 14.0%, ..."
    - List:   "Crude Protein (Min) 11.0%\\nCrude Fat (Min) 3.0%\\n..."
    """
    ga: dict[str, float] = {}

    # Normalize ellipses and whitespace
    text = text.replace("...", " ").replace("\u2026", " ")

    # GA label map
    label_map: dict[str, str] = {
        "crude protein": "crude_protein",
        "crude fat": "crude_fat",
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
        "taurine": "taurine",
        "l-carnitine": "l_carnitine",
        "epa": "epa",
        "dha": "dha",
    }

    _MAX_BY_DEFAULT = {"ash", "crude_fiber", "moisture"}
    _MG_KG_FIELDS = {"glucosamine", "chondroitin", "l_carnitine"}

    # Match patterns like "Crude Protein (min) 23.0%" or "Crude Protein (min)  23.0%"
    # Also handles "400 mg/kg"
    # Character class includes digits for labels like "Omega-6", "Omega-3"
    for m in re.finditer(
        r"([A-Za-z][A-Za-z0-9\s\-*()./]+?)\s+"
        r"(\d+\.?\d*)\s*"
        r"(%|mg/kg)",
        text,
    ):
        label_raw = m.group(1).strip().lower()
        value = float(m.group(2))
        unit = m.group(3)

        is_mg_kg = unit == "mg/kg"

        # Determine min/max from label
        explicit_suffix: str | None = None
        max_match = re.search(r"\(max\.?\)", label_raw)
        min_match = re.search(r"\(min\.?\)", label_raw)
        if max_match:
            explicit_suffix = "_max"
            label_raw = label_raw[: max_match.start()].strip()
        elif min_match:
            explicit_suffix = "_min"
            label_raw = label_raw[: min_match.start()].strip()

        # Strip asterisks and trailing punctuation
        label_raw = label_raw.strip("* .")

        # Match to field name
        field_base: str | None = None
        for known_label, field in label_map.items():
            if known_label == label_raw or known_label in label_raw:
                field_base = field
                break

        if not field_base:
            continue

        # Determine suffix
        if explicit_suffix:
            suffix = explicit_suffix
        elif field_base in _MAX_BY_DEFAULT:
            suffix = "_max"
        else:
            suffix = "_min"

        # Convert mg/kg to percentage for non-mg/kg fields
        if is_mg_kg and field_base not in _MG_KG_FIELDS:
            value = round(value / 10000, 4)

        ga[f"{field_base}{suffix}"] = value

    return ga  # type: ignore[return-value]


def _parse_ga(soup: BeautifulSoup) -> GuaranteedAnalysis | None:
    """Extract and parse guaranteed analysis."""
    raw = _find_section_text(soup, "guaranteed analysis")
    if not raw:
        return None

    ga = _parse_ga_text(raw)
    return ga if ga else None


def _parse_calories(soup: BeautifulSoup) -> str | None:
    """Extract and normalize calorie content."""
    raw = _find_section_text(soup, "calorie content")
    if not raw:
        return None

    text = clean_text(raw)
    return normalize_calorie_content(text)


def _parse_image(html: str) -> str | None:
    """Extract primary product image URL from JSON-LD or og:image."""
    ld = _extract_json_ld(html)
    if ld:
        img = ld.get("image", {})
        if isinstance(img, dict):
            url = img.get("url", "")
            if url:
                return url
        elif isinstance(img, str) and img:
            return img

    # Fallback: og:image
    m = re.search(r'<meta property="og:image" content="([^"]+)"', html)
    if m:
        return m.group(1)

    return None


def _parse_sub_brand(html: str) -> str | None:
    """Extract sub-brand from JSON-LD brand.name."""
    ld = _extract_json_ld(html)
    if ld:
        brand = ld.get("brand", {})
        if isinstance(brand, dict):
            name = brand.get("name", "")
            if name and name.lower() != "merrick":
                return clean_text(name)
    return None


def _parse_name(html: str) -> str | None:
    """Extract product name from JSON-LD."""
    ld = _extract_json_ld(html)
    if ld:
        name = ld.get("name", "")
        if name:
            return clean_text(name)
    return None


def _parse_sizes(soup: BeautifulSoup) -> list[str]:
    """Extract available sizes from 'Available Sizes' section."""
    sizes: list[str] = []
    for h2 in soup.find_all("h2"):
        if "available sizes" in h2.get_text(strip=True).lower():
            for sibling in h2.next_siblings:
                if isinstance(sibling, Tag):
                    if sibling.name == "h2":
                        text = sibling.get_text(strip=True)
                        # Match size patterns like "4 lb. Bag", "12.7 oz. Can"
                        if re.search(r"\d+\.?\d*\s*(?:lb|oz|kg|g)\b", text, re.I):
                            sizes.append(text)
                        else:
                            break
    return sizes


# ---------------------------------------------------------------------------
# Product scraping
# ---------------------------------------------------------------------------


def _scrape_product(url: str, session: SyncSession) -> Product | None:
    """Scrape a single product page."""
    resp = session.get(url)
    if resp.status_code != 200:
        logger.warning(f"  Failed to fetch {url}: {resp.status_code}")
        return None

    html = resp.text
    soup = BeautifulSoup(html, "lxml")

    # Name
    name = _parse_name(html)
    if not name:
        logger.warning(f"  No product name found: {url}")
        return None

    # Type and format
    product_type = _detect_product_type(url, name)
    product_format = _detect_product_format(url, product_type)

    product: Product = {
        "name": name,
        "brand": "Merrick",
        "url": url,
        "channel": "retail",
        "product_type": product_type,
        "product_format": product_format,
    }

    # Sub-brand
    sub_brand = _parse_sub_brand(html)
    if sub_brand:
        product["sub_brand"] = sub_brand

    # Life stage
    life_stage = _detect_life_stage(name)
    if life_stage:
        product["life_stage"] = life_stage

    # Breed size
    breed_size = _detect_breed_size(name)
    if breed_size:
        product["breed_size"] = breed_size

    # Ingredients
    ingredients = _parse_ingredients(soup)
    if ingredients:
        product["ingredients_raw"] = ingredients
    else:
        logger.warning(f"  Missing ingredients: {name}")

    # GA
    ga = _parse_ga(soup)
    if ga:
        product["guaranteed_analysis"] = ga
        product["guaranteed_analysis_basis"] = "as-fed"
    else:
        logger.warning(f"  Missing GA: {name}")

    # Calories
    calories = _parse_calories(soup)
    if calories:
        product["calorie_content"] = calories
    else:
        logger.warning(f"  Missing calories: {name}")

    # Image
    image = _parse_image(html)
    if image:
        product["images"] = [image]

    return product


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def scrape_merrick(output_dir: Path) -> int:
    """Scrape all Merrick Canada dog products. Returns product count."""
    with SyncSession(rate_limit=1.0) as session:
        # Step 1: Discover product URLs
        logger.info("Discovering products from Canada catalog...")
        product_urls = _fetch_product_urls(session)
        logger.info(f"Found {len(product_urls)} product URLs")

        # Step 2: Scrape each product
        products: list[Product] = []
        for i, url in enumerate(product_urls):
            logger.info(f"  [{i + 1}/{len(product_urls)}] {url.split('/')[-1]}")
            product = _scrape_product(url, session)
            if product:
                products.append(product)

    # Log completeness
    has_ingredients = sum(1 for p in products if p.get("ingredients_raw"))
    has_ga = sum(1 for p in products if p.get("guaranteed_analysis"))
    has_cal = sum(1 for p in products if p.get("calorie_content"))
    logger.info(
        f"Completeness: {has_ingredients}/{len(products)} ingredients, "
        f"{has_ga}/{len(products)} GA, {has_cal}/{len(products)} calories"
    )

    write_brand_json("Merrick", WEBSITE_URL, products, output_dir, slug="merrick")
    return len(products)
