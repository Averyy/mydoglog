"""Now Fresh scraper (Petcurean).

Data source: Next.js __NEXT_DATA__ (Contentful CMS) — same platform as Go! Solutions.
- Listing: GET nowfresh.com/en-ca/dog-food → __NEXT_DATA__ has all products
- Detail: GET nowfresh.com/en-ca/{slug} → full product data in __NEXT_DATA__
- Same Contentful space ID (sa0sroutfts9) as Go! Solutions

Reuses Go! Solutions parsing patterns (same CMS structure).
"""

import logging
from pathlib import Path

from wafer import SyncSession

from .common import Product, write_brand_json
from .gosolutions import (
    _detect_product_type,
    _extract_next_data,
    _get_page_fields,
    _parse_calorie_content,
    _parse_ga,
    _parse_images,
    _parse_ingredients,
    _parse_product_line,
    clean_text,
)

logger = logging.getLogger(__name__)

LISTING_URL = "https://www.nowfresh.com/en-ca/dog-food"
WEBSITE_URL = "https://www.nowfresh.com"


def _parse_product(fields: dict, slug: str) -> Product | None:
    """Parse a Now Fresh product from detail page fields."""
    name = fields.get("productName", "")
    if not name:
        return None

    url = f"{WEBSITE_URL}/en-ca/{slug}"

    product_line = _parse_product_line(fields)

    # Prepend product_line to name to avoid collisions — many Now Fresh
    # products share the same productName (e.g. "Turkey, Salmon & Duck
    # Grain-Free Dry Dog Food") and are differentiated only by product_line.
    cleaned_name = clean_text(name)
    if product_line:
        cleaned_name = f"{product_line} {cleaned_name}"

    product: Product = {
        "name": cleaned_name,
        "brand": "Now Fresh",
        "url": url,
        "channel": "retail",
        "product_type": _detect_product_type(slug),
    }

    if product_line:
        product["product_line"] = product_line

    ingredients = _parse_ingredients(fields)
    if ingredients:
        product["ingredients_raw"] = ingredients

    ga = _parse_ga(fields)
    if ga:
        product["guaranteed_analysis"] = ga
        product["guaranteed_analysis_basis"] = "as-fed"

    cal = _parse_calorie_content(fields)
    if cal:
        product["calorie_content"] = cal

    images = _parse_images(fields)
    if images:
        product["images"] = images

    ext_ids = fields.get("externalIDs", {})
    if isinstance(ext_ids, dict):
        sku = ext_ids.get("sku", "")
        if sku:
            product["source_id"] = str(sku)

    return product


def scrape_nowfresh(output_dir: Path) -> int:
    """Scrape all Now Fresh dog food products. Returns product count."""
    with SyncSession(rate_limit=1.0) as session:
        resp = session.get(LISTING_URL)
        resp.raise_for_status()

        next_data = _extract_next_data(resp.text)
        if not next_data:
            logger.error("Failed to extract __NEXT_DATA__ from listing page")
            return 0

        listing_fields = _get_page_fields(next_data)
        product_entries = listing_fields.get("products", [])
        logger.info(f"Found {len(product_entries)} products on listing page")

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

    write_brand_json("Now Fresh", WEBSITE_URL, products, output_dir, slug="nowfresh")
    return len(products)
