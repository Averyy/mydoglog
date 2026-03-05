"""Purina Canada scraper.

Data source: Drupal search API (listing) + Gatsby page-data.json (detail).
- Listing: GET live-purina-canada-h20.pantheonsite.io/api/search/products?species=1117&page={0-17}
- Detail: GET purina.ca/page-data/{url-path}/page-data.json

Key challenges:
- Control char cleaning (ASCII 0x00-0x1F) before JSON parsing
- Ingredient reconstruction from structured array
- Channel detection from brand taxonomy ID (1560=PPVD=vet)
- Product type detection from URL path
"""

import logging
import re
from pathlib import Path

from wafer import SyncSession

from .common import (
    IMAGES_DATA_DIR,
    GuaranteedAnalysis,
    Product,
    Variant,
    _find_existing,
    _image_stem,
    _slugify,
    clean_text,
    normalize_calorie_content,
    parse_ga_html_table,
    write_brand_json,
)

logger = logging.getLogger(__name__)

LISTING_API = "https://live-purina-canada-h20.pantheonsite.io/api/search/products"
DETAIL_BASE = "https://www.purina.ca/page-data"
WEBSITE_URL = "https://www.purina.ca"

# Brand taxonomy IDs → vet channel
_VET_BRAND_TIDS = {1560}  # PPVD (Pro Plan Veterinary Diets)

# URL path patterns → product type
_TYPE_PATTERNS: list[tuple[str, str]] = [
    (r"/dry-dog-food/", "dry"),
    (r"/dry-food/", "dry"),
    (r"/wet-dog-food/", "wet"),
    (r"/wet-food/", "wet"),
    (r"/dog-treats/", "treats"),
    (r"/treats/", "treats"),
    (r"/dog-supplements/", "supplements"),
    (r"/supplements/", "supplements"),
    (r"/dog-food/", "dry"),  # fallback
]

# --- Static fallback data for products missing GA/calories on purina.ca ---
# Sources: Chewy.ca, PetSmart US, Purina PDF spec sheets.
# Last verified: 2026-03-02
#
# Structure: URL path suffix → (GA dict or None, calorie string or None)
# Only used when normal parsing returns no data for these fields.

_FALLBACK_DATA: dict[str, tuple[GuaranteedAnalysis | None, str | None]] = {
    # Source: PetSmart.com US (item #5258024)
    "purina-pro-plan-veterinary-diets/dog/dry-food/ha-hydrolyzed-chicken-flavour-dry-canine-formula": (
        {
            "crude_protein_min": 18.0,
            "crude_fat_min": 9.5,
            "crude_fiber_max": 4.0,
            "moisture_max": 11.0,
            "ash_max": 7.0,
            "calcium_min": 0.7,
            "phosphorus_min": 0.6,
        },
        "3563 kcal/kg, 315 kcal/cup",
    ),
    # Source: Chewy.ca + Tractor Supply
    "dentalife/dogs/dental-chews/activfresh-daily-oral-chews-mini-dogs": (
        {
            "crude_protein_min": 6.0,
            "crude_fat_min": 1.5,
            "crude_fiber_max": 1.5,
            "moisture_max": 15.0,
        },
        "3110 kcal/kg, 25 kcal/treat",
    ),
    # Source: Chewy.ca
    "dentalife/dogs/dental-chews/activfresh-daily-oral-chews-medium": (
        {
            "crude_protein_min": 6.0,
            "crude_fat_min": 1.5,
            "crude_fiber_max": 1.5,
            "moisture_max": 15.0,
        },
        "3110 kcal/kg",
    ),
    # Source: Purina PDF spec sheet
    "beyond/dogs/wet-dog-food/beef-spinach-in-gravy": (
        {
            "crude_protein_min": 8.0,
            "crude_fat_min": 2.5,
            "crude_fiber_max": 1.5,
            "moisture_max": 82.0,
        },
        "868 kcal/kg, 307 kcal/can",
    ),
    # Source: Chewy.ca
    "alpo/semi-moist-dog-food/moist-meaty-lamb": (
        {
            "crude_protein_min": 18.0,
            "crude_fat_min": 7.0,
            "crude_fiber_max": 3.0,
            "moisture_max": 33.0,
        },
        "2732 kcal/kg, 464 kcal/pouch",
    ),
    # Source: Chewy.ca
    "alpo/semi-moist-dog-food/moist-meaty-chicken": (
        {
            "crude_protein_min": 18.0,
            "crude_fat_min": 7.0,
            "crude_fiber_max": 3.0,
            "moisture_max": 33.0,
        },
        "2717 kcal/kg, 462 kcal/pouch",
    ),
    # Source: Chewy.ca + VetRxDirect
    "purina-pro-plan-veterinary-diets/dog/supplements/fortiflora-canine-probiotic-supplement": (
        {
            "crude_protein_min": 43.0,
            "crude_fat_min": 10.0,
            "crude_fiber_max": 1.0,
            "moisture_max": 5.0,
        },
        "4 kcal/treat",
    ),
    # Source: Chewy.ca + PetSmart
    "purina-pro-plan-veterinary-diets/dog/supplements/fortiflora-canine-probiotic-tablets": (
        {
            "crude_protein_min": 16.5,
            "crude_fat_min": 4.5,
            "crude_fiber_max": 14.0,
            "moisture_max": 10.0,
        },
        "2.9 kcal/treat",
    ),
}


# Trailing Purina product/lot codes — e.g. "C458920", "A850923.", "B251921C"
# Always at the very end of the ingredient string, after a period.
# Pattern: period + whitespace + single uppercase letter + 5-7 digits + optional trailing letter + optional period.
# No real ingredient matches [A-Z]\d{5,} — all AAFCO names are multi-word.
_PRODUCT_CODE_RE = re.compile(r"\.\s+[A-Z]\d{5,}[A-Z]?\.?.*$")

# Control chars to strip before JSON parsing
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _clean_response_text(text: str) -> str:
    """Strip control characters from response text before JSON parsing."""
    return _CONTROL_CHAR_RE.sub("", text)


def _fetch_all_listings(session: SyncSession) -> list[dict]:
    """Fetch all dog product listings across all pages."""
    all_products: list[dict] = []
    page = 0

    while True:
        url = f"{LISTING_API}?species=1117&page={page}"
        resp = session.get(url)
        resp.raise_for_status()

        text = _clean_response_text(resp.text)
        import json

        data = json.loads(text)

        products = data.get("search_results", []) or data.get("results", [])
        if not products:
            break

        all_products.extend(products)
        logger.info(f"  Page {page}: {len(products)} products (total: {len(all_products)})")

        # Drupal API returns 12 per page, stop when we get fewer
        if len(products) < 12:
            break
        page += 1

        # Safety: don't exceed 30 pages
        if page > 30:
            logger.warning("Hit page limit, stopping")
            break

    return all_products


def _fetch_page_data(session: SyncSession, url_path: str) -> dict | None:
    """Fetch Gatsby page-data.json for a product URL path."""
    # Normalize path: ensure leading /, strip trailing /
    path = url_path.strip("/")
    url = f"{DETAIL_BASE}/{path}/page-data.json"

    resp = session.get(url)
    if not resp.ok:
        logger.warning(f"Page data fetch failed for {path}: {resp.status_code}")
        return None

    text = _clean_response_text(resp.text)
    import json

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        logger.warning(f"JSON parse error for {path}: {e}")
        return None

    return data


def _detect_channel(page_data: dict, listing: dict | None = None) -> str:
    """Detect vet vs retail from brand taxonomy ID or brand name."""
    node = _get_node(page_data)
    if not node:
        # Fallback: check listing URL for vet indicators
        if listing:
            url = listing.get("url", "").lower()
            if "veterinary" in url or "ppvd" in url:
                return "vet"
        return "retail"

    # Check brand relationship — by tid or by name
    brand = node.get("relationships", {}).get("brand", {})
    if isinstance(brand, dict):
        tid = brand.get("drupal_internal__tid")
        if tid in _VET_BRAND_TIDS:
            return "vet"
        name = brand.get("name", "").lower()
        if "veterinary" in name:
            return "vet"
    elif isinstance(brand, list):
        for b in brand:
            if not isinstance(b, dict):
                continue
            tid = b.get("drupal_internal__tid")
            if tid in _VET_BRAND_TIDS:
                return "vet"
            name = b.get("name", "").lower()
            if "veterinary" in name:
                return "vet"

    # Fallback: check listing URL
    if listing:
        url = listing.get("url", "").lower()
        if "veterinary" in url or "ppvd" in url:
            return "vet"

    return "retail"


def _detect_type(url_path: str, title: str = "") -> str:
    """Detect product type from URL path, with title fallback."""
    for pattern, ptype in _TYPE_PATTERNS:
        if re.search(pattern, url_path, re.IGNORECASE):
            return ptype

    # Title-based fallback for vet products with non-standard URLs
    title_lower = title.lower()
    if "canned" in title_lower or "stew" in title_lower or "gravy" in title_lower:
        return "wet"
    if "treat" in title_lower:
        return "treats"
    if "supplement" in title_lower or "probiotic" in title_lower:
        return "supplements"

    return "dry"  # default


def _get_node(page_data: dict) -> dict | None:
    """Extract the product node from Gatsby page-data structure."""
    try:
        return page_data["result"]["data"]["node"]
    except (KeyError, TypeError):
        return None


def _parse_ingredients(node: dict) -> str | None:
    """Reconstruct ingredients text from structured ingredient array."""
    relationships = node.get("relationships", {})
    ingredients = relationships.get("ingredients", [])

    if not ingredients:
        return None

    # Join ingredient names with ", "
    names: list[str] = []
    for ing in ingredients:
        if isinstance(ing, dict):
            name = ing.get("name", "")
            if name:
                names.append(clean_text(name))

    if not names:
        return None

    joined = ", ".join(names)
    # Strip trailing Purina product/lot codes (e.g. "sodium selenite. C458920")
    joined = _PRODUCT_CODE_RE.sub("", joined)
    # Repair Purina encoding truncations where control chars eat "fi"/"fl":
    # "oat ber" → "oat fiber", "natural avor" → "natural flavor"
    joined = re.sub(r"\boat ber\b", "oat fiber", joined)
    joined = re.sub(r"\bnatural avor\b", "natural flavor", joined)
    return joined


def _get_ga_html(node: dict) -> str:
    """Get the guaranteedAnalysis HTML which contains both GA table and calorie info."""
    ga_data = node.get("guaranteedAnalysis", {})
    if not ga_data:
        return ""

    if isinstance(ga_data, dict):
        return ga_data.get("processed", "") or ga_data.get("value", "")
    elif isinstance(ga_data, str):
        return ga_data
    return ""


def _get_feeding_instructions_html(node: dict) -> str:
    """Get the feeding_instructions HTML which often contains calorie content.

    On purina.ca, calorie data for retail products is typically stored in the
    feeding_instructions.processed field rather than in guaranteedAnalysis.
    """
    fi_data = node.get("feeding_instructions", {})
    if not fi_data:
        return ""

    if isinstance(fi_data, dict):
        return fi_data.get("processed", "") or fi_data.get("value", "")
    elif isinstance(fi_data, str):
        return fi_data
    return ""


def _extract_calories_from_html(html: str) -> str | None:
    """Extract and normalize calorie content from an HTML string.

    Returns the normalized calorie string or None if not found.
    Rejects false positives where mineral values like "0.35 mg/kg"
    (Selenium) are misinterpreted as calorie data.
    """
    if not html:
        return None

    from bs4 import BeautifulSoup as BS

    soup = BS(html, "lxml")

    # Strategy 1: Look for a "Calorie Content" heading and extract text
    # from the following siblings — this avoids false positives from
    # unrelated numbers elsewhere in the HTML.
    for heading in soup.find_all(["h2", "h3", "h4"]):
        heading_text = heading.get_text(strip=True).lower()
        if "calorie content" in heading_text:
            # Gather text from siblings after this heading
            parts: list[str] = []
            for sib in heading.next_siblings:
                if hasattr(sib, "name") and sib.name in ("h2", "h3", "h4", "table"):
                    break
                sib_text = sib.get_text(separator=" ") if hasattr(sib, "get_text") else str(sib)
                parts.append(sib_text)
            cal_text = clean_text(" ".join(parts))
            cal = normalize_calorie_content(cal_text)
            if cal and "kcal" in cal:
                return cal

    # Strategy 2: Fall back to full text extraction for simpler HTML
    # where calorie data isn't under a heading.
    text = soup.get_text(separator=" ")
    cal = normalize_calorie_content(clean_text(text))
    if cal and "kcal" in (cal or ""):
        # Sanity check: reject implausibly low kcal/kg values.
        # Real pet food ranges from ~600 kcal/kg (wet) to ~5000 kcal/kg (dry).
        # Values < 100 are false positives from mineral data like "0.35 mg/kg"
        # or footnotes like "2 Kilocalories of metabolizable energy".
        m = re.match(r"(\d+)\s*kcal/kg", cal)
        if m and int(m.group(1)) < 100:
            return None
        return cal
    return None


def _parse_ga(node: dict) -> dict | None:
    """Parse guaranteed analysis from HTML table in page data.

    Checks guaranteedAnalysis first, then falls back to feeding_instructions
    for products where the GA table is embedded in feeding instructions.
    """
    html = _get_ga_html(node)
    if html and "<" in html:
        ga = parse_ga_html_table(html)
        if ga:
            return ga

    # Fallback: some products embed the GA table in feeding_instructions
    fi_html = _get_feeding_instructions_html(node)
    if fi_html and "<table" in fi_html.lower():
        ga = parse_ga_html_table(fi_html)
        if ga:
            return ga

    return None


def _parse_variants(node: dict) -> list[Variant]:
    """Extract size variants from SKU relationships."""
    variants: list[Variant] = []
    relationships = node.get("relationships", {})
    skus = relationships.get("skus", [])

    for sku_item in skus:
        if not isinstance(sku_item, dict):
            continue

        size = sku_item.get("size", "") or sku_item.get("field_size", "")
        upc = sku_item.get("upc", "") or sku_item.get("field_upc", "")

        size_kg = _parse_purina_weight(str(size))
        if size_kg is None and not size:
            continue

        variant: Variant = {
            "size_kg": size_kg or 0.0,
            "size_description": str(size),
        }
        if upc:
            variant["upc"] = str(upc)

        variants.append(variant)

    return variants


def _parse_purina_weight(text: str) -> float | None:
    """Parse Purina weight strings (e.g., '7 kg', '380 g', '1.5 lb')."""
    text = text.lower().replace(",", "").strip()

    m = re.search(r"(\d+\.?\d*)\s*kg", text)
    if m:
        return round(float(m.group(1)), 2)

    m = re.search(r"(\d+\.?\d*)\s*g(?:\b|$)", text)
    if m:
        return round(float(m.group(1)) / 1000, 3)

    m = re.search(r"(\d+\.?\d*)\s*(?:lb|lbs)", text)
    if m:
        return round(float(m.group(1)) / 2.20462, 2)

    m = re.search(r"(\d+\.?\d*)\s*oz", text)
    if m:
        return round(float(m.group(1)) / 35.274, 3)

    return None


def _parse_images(node: dict) -> list[str]:
    """Extract image URLs from node."""
    images: list[str] = []
    relationships = node.get("relationships", {})

    for img in relationships.get("images", []) or relationships.get("field_images", []) or []:
        if isinstance(img, dict):
            url = img.get("url", "") or img.get("uri", {}).get("url", "")
            if url:
                if not url.startswith("http"):
                    url = f"https://www.purina.ca{url}"
                images.append(url)

    # Also check top-level image
    for field in ("image", "field_image"):
        img = node.get(field, {})
        if isinstance(img, dict):
            url = img.get("url", "") or img.get("uri", {}).get("url", "")
            if url:
                if not url.startswith("http"):
                    url = f"https://www.purina.ca{url}"
                images.append(url)

    return images


def _parse_sub_brand(node: dict) -> str | None:
    """Extract sub-brand name (e.g., 'Pro Plan', 'PPVD', 'Beneful')."""
    relationships = node.get("relationships", {})
    brand = relationships.get("brand", {})
    if isinstance(brand, dict):
        name = brand.get("name", "")
        if name:
            return clean_text(name)
    elif isinstance(brand, list) and brand:
        name = brand[0].get("name", "") if isinstance(brand[0], dict) else ""
        if name:
            return clean_text(name)
    return None


def _parse_html_fallback(html: str) -> dict:
    """Parse ingredients, GA, and calories from rendered HTML (for PPVD products)."""
    from bs4 import BeautifulSoup as BS

    soup = BS(html, "lxml")
    result: dict = {}

    text = soup.get_text(separator=" ")

    # Find ingredient list — look for the section after "Ingredients" heading
    for heading in soup.find_all(["h3", "h2", "h4"]):
        heading_text = heading.get_text(strip=True).lower()
        if heading_text == "ingredients" or heading_text.startswith("ingredient"):
            # Next sibling paragraph(s) contain the ingredients
            sibling = heading.find_next_sibling()
            if sibling:
                ing_text = sibling.get_text(separator=" ")
                ing_text = clean_text(ing_text)
                if len(ing_text) > 20:
                    result["ingredients_raw"] = _PRODUCT_CODE_RE.sub("", ing_text)
            break

    # Find GA table
    for table in soup.find_all("table"):
        table_text = table.get_text().lower()
        if "crude protein" in table_text or "crude fat" in table_text:
            ga = parse_ga_html_table(str(table))
            if ga:
                result["guaranteed_analysis"] = ga
            break

    # Find calorie content
    cal = normalize_calorie_content(clean_text(text))
    if cal and "kcal" in cal:
        result["calorie_content"] = cal

    return result


def _parse_product(
    listing: dict, page_data: dict, html_fallback: str | None = None
) -> Product | None:
    """Parse a listing + page-data pair into a Product."""
    node = _get_node(page_data)
    if not node:
        return None

    url_path = listing.get("url", "") or listing.get("path", "")
    title = listing.get("title", "") or node.get("title", "")
    if not title:
        return None

    # Skip variety packs — bundles without individual ingredient data
    combined = f"{title} {url_path}".lower()
    if "variety" in combined and "pack" in combined:
        logger.debug(f"Skipping variety pack: {title}")
        return None

    product: Product = {
        "name": clean_text(title),
        "brand": "Purina",
        "url": f"{WEBSITE_URL}{url_path}" if url_path.startswith("/") else f"{WEBSITE_URL}/{url_path}",
        "channel": _detect_channel(page_data, listing),
        "product_type": _detect_type(url_path, title),
    }

    # Sub-brand
    sub_brand = _parse_sub_brand(node)
    if sub_brand:
        product["sub_brand"] = sub_brand

    # Ingredients
    ingredients = _parse_ingredients(node)
    if ingredients:
        product["ingredients_raw"] = ingredients

    # GA
    ga = _parse_ga(node)
    if ga:
        product["guaranteed_analysis"] = ga
        product["guaranteed_analysis_basis"] = "as-fed"

    # Calorie content — check GA HTML first, then feeding_instructions
    cal_normalized = _extract_calories_from_html(_get_ga_html(node))
    if not cal_normalized:
        cal_normalized = _extract_calories_from_html(_get_feeding_instructions_html(node))
    if cal_normalized:
        product["calorie_content"] = cal_normalized

    # Images — try node first, fall back to listing thumbnail
    images = _parse_images(node)
    if not images:
        listing_img = listing.get("product_image", "")
        if listing_img:
            if not listing_img.startswith("http"):
                listing_img = f"{WEBSITE_URL}{listing_img}"
            images = [listing_img]
    if images:
        product["images"] = images

    # Variants
    variants = _parse_variants(node)
    if variants:
        product["variants"] = variants

    # HTML fallback for products missing data (e.g., PPVD vet products)
    if html_fallback and not product.get("ingredients_raw"):
        fallback = _parse_html_fallback(html_fallback)
        if fallback.get("ingredients_raw"):
            product["ingredients_raw"] = fallback["ingredients_raw"]
        if fallback.get("guaranteed_analysis") and not product.get("guaranteed_analysis"):
            product["guaranteed_analysis"] = fallback["guaranteed_analysis"]
            product["guaranteed_analysis_basis"] = "as-fed"
        if fallback.get("calorie_content") and not product.get("calorie_content"):
            product["calorie_content"] = fallback["calorie_content"]

    # Static fallback for products where purina.ca has no GA/calories
    url_key = url_path.lstrip("/")
    if url_key in _FALLBACK_DATA:
        fb_ga, fb_cal = _FALLBACK_DATA[url_key]
        if fb_ga and not product.get("guaranteed_analysis"):
            product["guaranteed_analysis"] = fb_ga
            product["guaranteed_analysis_basis"] = "as-fed"
        if fb_cal and not product.get("calorie_content"):
            cal = normalize_calorie_content(fb_cal)
            if cal:
                product["calorie_content"] = cal

    # UPC from listing
    upc = listing.get("upc", "")
    if upc:
        product["source_id"] = str(upc)

    return product


def _download_purina_images(
    session: SyncSession, products: list[Product]
) -> None:
    """Download Purina product images using the wafer session.

    Purina's CDN blocks plain httpx requests with 403, so we use the
    same browser session the scraper already has open.
    """
    brand_slug = _slugify("Purina")
    brand_dir = IMAGES_DATA_DIR / brand_slug
    brand_dir.mkdir(parents=True, exist_ok=True)

    downloaded = 0
    for product in products:
        images = product.get("images")
        if not images or not images[0].startswith("http"):
            continue

        stem = _image_stem("Purina", product.get("product_type", "other"), product["name"])
        existing = _find_existing(brand_dir, stem)
        if existing:
            product["images"] = [f"/products/{brand_slug}/{existing.name}"]
            downloaded += 1
            continue

        try:
            resp = session.get(images[0])
            if not resp.ok:
                logger.warning(f"Image {resp.status_code} for {product['name']}")
                continue

            content_type = resp.headers.get("content-type", "").split(";")[0].strip()
            ext_map = {"image/webp": ".webp", "image/png": ".png", "image/jpeg": ".jpg"}
            ext = ext_map.get(content_type, ".jpg")

            filename = f"{stem}{ext}"
            (brand_dir / filename).write_bytes(resp.content)
            product["images"] = [f"/products/{brand_slug}/{filename}"]
            downloaded += 1
        except Exception as e:
            logger.warning(f"Image download failed for {product['name']}: {e}")

    logger.info(f"Purina images: {downloaded}/{len(products)} downloaded")


def scrape_purina(output_dir: Path) -> int:
    """Scrape all Purina Canada dog products. Returns product count."""
    with SyncSession(rate_limit=1.0) as session:
        # Step 1: Get all listings
        listings = _fetch_all_listings(session)
        logger.info(f"Found {len(listings)} listings")

        # Step 2: Fetch page-data for each product
        products: list[Product] = []
        for i, listing in enumerate(listings):
            url_path = listing.get("url", "") or listing.get("path", "")
            if not url_path:
                logger.warning(f"No URL for product: {listing.get('title', '?')}")
                continue

            logger.info(f"  [{i + 1}/{len(listings)}] {listing.get('title', '?')}")
            page_data = _fetch_page_data(session, url_path)
            if not page_data:
                continue

            product = _parse_product(listing, page_data)
            if not product:
                continue

            # If ingredients missing, try HTML fallback
            if not product.get("ingredients_raw"):
                full_url = f"{WEBSITE_URL}{url_path}" if url_path.startswith("/") else f"{WEBSITE_URL}/{url_path}"
                logger.info(f"    Fetching HTML fallback for {listing.get('title', '?')}")
                html_resp = session.get(full_url)
                if html_resp.ok:
                    product = _parse_product(listing, page_data, html_fallback=html_resp.text)

            if product:
                products.append(product)

        # Deduplicate: if two products share the same name, differentiate
        # using the URL slug suffix (e.g., OraChews vs OraChews Large)
        name_counts: dict[str, int] = {}
        for p in products:
            key = p["name"].lower().strip()
            name_counts[key] = name_counts.get(key, 0) + 1

        seen: dict[str, int] = {}
        for p in products:
            key = p["name"].lower().strip()
            if name_counts[key] > 1:
                seen[key] = seen.get(key, 0) + 1
                # Extract differentiating suffix from URL slug
                slug = p["url"].rstrip("/").rsplit("/", 1)[-1]
                # Take last segment after the base slug, e.g. "ora-chews-large" → "Large"
                base_slug = slug.rsplit("-", 1)
                if len(base_slug) == 2 and base_slug[1].isalpha():
                    suffix = base_slug[1].title()
                    p["name"] = f"{p['name']} {suffix}"

        # Download images using the browser session (Purina CDN blocks plain httpx)
        _download_purina_images(session, products)

    write_brand_json("Purina", WEBSITE_URL, products, output_dir, slug="purina")
    return len(products)
