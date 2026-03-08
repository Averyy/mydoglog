"""Go! Solutions scraper (Petcurean).

Data source: Next.js __NEXT_DATA__ (Contentful CMS).
- Listing: GET go-solutions.com/en-ca/dog-food → __NEXT_DATA__ has all products
- Detail: GET go-solutions.com/en-ca/{slug} → __NEXT_DATA__ has full product data
  - Ingredients: cat2Recipe[].fields.{label, compositeList} (ordered list, with
    compositeList expanding vitamin/mineral premixes into sub-ingredients)
  - GA: guaranteedAnalysis[].fields.{label, quantity}
  - Calories: calorieContent string
  - Images: productImage.fields.file.url (Contentful CDN)
  - Variants: packaging string ("Available in 3.5 lb, 12 lb and 22 lb bag sizes")

Key notes:
- 44 dog products across dry, wet, toppers, treats
- Product type detected from URL slug (/dry/, /wet/, /toppers/, /treats/)
- All products are retail channel
- Product line detected from titleEyebrow field
- Product name is prefixed with product_line to avoid duplicates across lines
"""

import json
import logging
import re
from pathlib import Path

from bs4 import BeautifulSoup
from wafer import SyncSession

from .common import (
    GuaranteedAnalysis,
    Product,
    Variant,
    clean_text,
    normalize_calorie_content,
    write_brand_json,
)

logger = logging.getLogger(__name__)

LISTING_URL = "https://www.go-solutions.com/en-ca/dog-food"
WEBSITE_URL = "https://www.go-solutions.com"

# GA label patterns → our field names
_GA_LABEL_MAP: dict[str, tuple[str, str]] = {
    "crude protein": ("crude_protein", "min"),
    "crude fat": ("crude_fat", "min"),
    "crude fiber": ("crude_fiber", "max"),
    "crude fibre": ("crude_fiber", "max"),
    "moisture": ("moisture", "max"),
    "ash": ("ash", "max"),
    "calcium": ("calcium", "min"),
    "phosphorus": ("phosphorus", "min"),
    "omega-6": ("omega_6", "min"),
    "omega-3": ("omega_3", "min"),
    "omega 6": ("omega_6", "min"),
    "omega 3": ("omega_3", "min"),
    "glucosamine": ("glucosamine", "min"),
    "chondroitin": ("chondroitin", "min"),
    "epa": ("epa", "min"),
    "dha": ("dha", "min"),
    "l-carnitine": ("l_carnitine", "min"),
    "taurine": ("taurine", "min"),
}


def _extract_next_data(html: str) -> dict | None:
    """Extract __NEXT_DATA__ JSON from page HTML."""
    soup = BeautifulSoup(html, "lxml")
    script = soup.find("script", id="__NEXT_DATA__")
    if not script or not script.string:
        return None
    try:
        return json.loads(script.string)
    except json.JSONDecodeError:
        return None


def _get_page_fields(next_data: dict) -> dict:
    """Extract pageData.fields from __NEXT_DATA__."""
    try:
        return next_data["props"]["pageProps"]["pageData"]["fields"]
    except (KeyError, TypeError):
        return {}


def _detect_product_type(slug: str) -> str:
    """Detect product type from URL slug."""
    if "/toppers/" in slug or "/topper/" in slug:
        return "supplement"
    if "/treats/" in slug or "/treat/" in slug:
        return "treat"
    return "food"


def _detect_product_format(slug: str) -> str:
    """Detect product format from URL slug."""
    if "/wet/" in slug or "/toppers/" in slug or "/topper/" in slug:
        return "wet"
    return "dry"


def _parse_ingredients(fields: dict) -> str | None:
    """Extract ingredients from cat2Recipe or cat3Recipe ingredient entries.

    Handles composite ingredients (e.g. "vitamins", "minerals") that have a
    ``compositeList`` of sub-ingredients.  When present, the parent label and
    its expanded children are emitted as ``"vitamins (vitamin E supplement,
    niacin, ...)"`` matching the format shown on the product page.
    """
    # Try cat2Recipe first (primary availability), fall back to cat3Recipe
    for key in ("cat2Recipe", "cat3Recipe"):
        recipe = fields.get(key, [])
        if not recipe:
            continue

        names: list[str] = []
        for entry in recipe:
            entry_fields = entry.get("fields", {})
            label = entry_fields.get("label", "")
            if not label:
                continue

            composite = entry_fields.get("compositeList")
            if composite and isinstance(composite, list):
                # Expand sub-ingredients: "vitamins (sub1, sub2, ...)"
                sub_names: list[str] = []
                for sub in composite:
                    sub_label = sub.get("fields", {}).get("label", "")
                    if sub_label:
                        sub_names.append(clean_text(sub_label))
                if sub_names:
                    names.append(
                        f"{clean_text(label)} ({', '.join(sub_names)})"
                    )
                else:
                    names.append(clean_text(label))
            else:
                names.append(clean_text(label))

        if names:
            return ", ".join(names)

    return None


def _parse_ga(fields: dict) -> GuaranteedAnalysis | None:
    """Parse GA from guaranteedAnalysis Contentful entries."""
    ga_entries = fields.get("guaranteedAnalysis", [])
    if not ga_entries:
        return None

    ga: dict[str, float] = {}

    for entry in ga_entries:
        entry_fields = entry.get("fields", {})
        label = entry_fields.get("label", "").lower()
        quantity = entry_fields.get("quantity", "")

        if not label or not quantity:
            continue

        # Strip leading * and clean label
        label = label.lstrip("*").strip()

        # Determine min/max from label
        suffix = "min"
        if "(max" in label or "max" in label.split()[-1:]:
            suffix = "max"
        elif "(min" in label or "min" in label.split()[-1:]:
            suffix = "min"

        # Clean label to match our map
        clean_label = re.sub(r"\s*\((?:min|max)\.?\)\s*", "", label).strip()

        # Extract numeric value — strip commas first so "1,000" → "1000"
        quantity_clean = quantity.replace(",", "")
        m = re.search(r"(\d+\.?\d*)\s*%?", quantity_clean)
        if not m:
            continue
        value = float(m.group(1))

        # Map to field name
        for pattern, (field_base, default_suffix) in _GA_LABEL_MAP.items():
            if pattern in clean_label:
                # Use the suffix from label if present, otherwise use default
                if "(max" in label:
                    field_name = f"{field_base}_max"
                elif "(min" in label:
                    field_name = f"{field_base}_min"
                else:
                    field_name = f"{field_base}_{default_suffix}"
                ga[field_name] = value
                break

    return ga if ga else None  # type: ignore[return-value]


def _parse_calorie_content(fields: dict) -> str | None:
    """Extract and normalize calorie content."""
    raw = fields.get("calorieContent", "")
    if not raw:
        return None
    return normalize_calorie_content(clean_text(raw))


def _parse_images(fields: dict) -> list[str]:
    """Extract image URLs from Contentful fields."""
    images: list[str] = []

    # Primary product image
    product_img = fields.get("productImage", {})
    if isinstance(product_img, dict):
        file_info = product_img.get("fields", {}).get("file", {})
        url = file_info.get("url", "")
        if url:
            if url.startswith("//"):
                url = f"https:{url}"
            images.append(url)

    # Carousel images
    for img in fields.get("carouselImages", []):
        if isinstance(img, dict):
            file_info = img.get("fields", {}).get("file", {})
            url = file_info.get("url", "")
            if url:
                if url.startswith("//"):
                    url = f"https:{url}"
                images.append(url)

    return images


def _parse_product_line(fields: dict) -> str | None:
    """Extract product line from titleEyebrow."""
    eyebrow = fields.get("titleEyebrow", "")
    if eyebrow:
        return clean_text(eyebrow)
    return None


def _parse_variants(fields: dict) -> list[Variant]:
    """Extract size variants from the packaging text field.

    Handles formats like:
    - "Available in 3.5 lb, 12 lb and 22 lb bag sizes"
    - "Available in 2.8 oz (79 g) single-serve pouches"
    - "Available in 12.5 oz (354 g) carton"
    - "Available in 6 oz (170 g) resealable bag"
    """
    packaging = fields.get("packaging", "")
    if not packaging or not isinstance(packaging, str):
        return []

    variants: list[Variant] = []

    # Find all weight mentions: "3.5 lb", "12 lb", "2.8 oz", "12.5 oz"
    # Pattern: number + unit (lb/lbs/oz/kg/g)
    for m in re.finditer(
        r"(\d+(?:\.\d+)?)\s*(lb|lbs|oz|kg|g)\b", packaging, re.IGNORECASE
    ):
        value = float(m.group(1))
        unit = m.group(2).lower()

        # Convert to kg
        if unit in ("lb", "lbs"):
            size_kg = round(value * 0.453592, 3)
        elif unit == "oz":
            size_kg = round(value * 0.0283495, 3)
        elif unit == "g":
            size_kg = round(value / 1000, 3)
        else:
            size_kg = value

        size_desc = f"{m.group(1)} {m.group(2)}"

        # Skip parenthetical metric equivalents — e.g. "(79 g)" after "2.8 oz"
        # Check if this match is inside parentheses
        start = m.start()
        preceding = packaging[:start]
        if preceding.count("(") > preceding.count(")"):
            continue

        variants.append(Variant(size_kg=size_kg, size_description=size_desc))

    return variants


def _parse_product(fields: dict, slug: str) -> Product | None:
    """Parse a Go! Solutions product from detail page fields."""
    name = fields.get("productName", "")
    if not name:
        return None

    url = f"{WEBSITE_URL}/en-ca/{slug}"

    # Product line
    product_line = _parse_product_line(fields)

    # Prepend product_line to name for uniqueness across lines
    # e.g. "Joint Care - Minced Chicken with Gravy Booster Dog Food Topper"
    clean_name = clean_text(name)
    if product_line:
        display_name = f"{product_line} - {clean_name}"
    else:
        display_name = clean_name

    product: Product = {
        "name": display_name,
        "brand": "Go! Solutions",
        "url": url,
        "channel": "retail",
        "product_type": _detect_product_type(slug),
        "product_format": _detect_product_format(slug),
    }

    if product_line:
        product["product_line"] = product_line

    # Ingredients
    ingredients = _parse_ingredients(fields)
    if ingredients:
        product["ingredients_raw"] = ingredients

    # GA
    ga = _parse_ga(fields)
    if ga:
        product["guaranteed_analysis"] = ga
        product["guaranteed_analysis_basis"] = "as-fed"

    # Calorie content
    cal = _parse_calorie_content(fields)
    if cal:
        product["calorie_content"] = cal

    # Images
    images = _parse_images(fields)
    if images:
        product["images"] = images

    # Variants
    variants = _parse_variants(fields)
    if variants:
        product["variants"] = variants

    # Source ID from externalIDs
    ext_ids = fields.get("externalIDs", {})
    if isinstance(ext_ids, dict):
        sku = ext_ids.get("sku", "")
        if sku:
            product["source_id"] = str(sku)

    return product


def scrape_gosolutions(output_dir: Path) -> int:
    """Scrape all Go! Solutions dog food products. Returns product count."""
    with SyncSession(rate_limit=1.0) as session:
        # Step 1: Get product list from listing page __NEXT_DATA__
        resp = session.get(LISTING_URL)
        resp.raise_for_status()

        next_data = _extract_next_data(resp.text)
        if not next_data:
            logger.error("Failed to extract __NEXT_DATA__ from listing page")
            return 0

        listing_fields = _get_page_fields(next_data)
        product_entries = listing_fields.get("products", [])
        logger.info(f"Found {len(product_entries)} products on listing page")

        # Step 2: Fetch each product detail page
        products: list[Product] = []
        for i, entry in enumerate(product_entries):
            entry_fields = entry.get("fields", {})
            slug = entry_fields.get("slug", "")
            name = entry_fields.get("productName", "?")

            if not slug:
                logger.warning(f"No slug for product: {name}")
                continue

            logger.info(f"  [{i + 1}/{len(product_entries)}] {name}")

            detail_url = f"{WEBSITE_URL}/en-ca/{slug}"
            resp = session.get(detail_url)
            if not resp.ok:
                logger.warning(f"Failed to fetch {detail_url}: {resp.status_code}")
                continue

            detail_data = _extract_next_data(resp.text)
            if not detail_data:
                logger.warning(f"No __NEXT_DATA__ for {slug}")
                continue

            detail_fields = _get_page_fields(detail_data)
            product = _parse_product(detail_fields, slug)
            if product:
                products.append(product)
            else:
                logger.warning(f"Failed to parse: {slug}")

    write_brand_json(
        "Go! Solutions", WEBSITE_URL, products, output_dir, slug="gosolutions"
    )
    return len(products)
