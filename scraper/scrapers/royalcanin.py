"""Royal Canin Canada scraper.

Data source: Azure API Management REST API (public key from frontend JS bundle).
- Listing: POST /internal/product-digital-shelf/products/facets
- Detail: GET /internal/product/v2/products/mainitem/{mainItemCode}/{locale}

All data is JSON — no HTML parsing needed.

API response structure (from live probing):
- product_pillar: list[dict] e.g. [{"code": "sptretail", "label": "SPT"}]
- digital_sub_category: dict e.g. {"code": "dry_food", "label": "Dry food"}
- composition: list[dict] with keys like "ingredients", "guaranteed_analysis", "calorie_content"
- packs: list[dict] with weight, ean, base_pack_size, converted_weight, etc.
- product_title: clean display title
- lifestage/pet_size: list[dict] with code/label
"""

import logging
import re
from pathlib import Path

from wafer import SyncSession

from .common import (
    Product,
    Variant,
    _GA_LABEL_MAP,
    clean_text,
    normalize_calorie_content,
    write_brand_json,
)

logger = logging.getLogger(__name__)

API_BASE = "https://rc-api.royalcanin.com/internal"
API_KEY = "c38cb7c1224146569e41a2f2d01359fc"
LOCALE = "en_CA"
WEBSITE_URL = "https://www.royalcanin.com/ca"

# Map product_pillar code to channel
_CHANNEL_MAP: dict[str, str] = {
    "sptretail": "retail",
    "vet": "vet",
}

# Map digital_sub_category code to product type
_TYPE_MAP: dict[str, str] = {
    "dry_food": "food",
    "dry": "food",
    "wet_food": "food",
    "wet": "food",
    "treats": "treat",
    "treat": "treat",
    "supplement": "supplement",
}

# Map digital_sub_category code to product format
_FORMAT_MAP: dict[str, str] = {
    "dry_food": "dry",
    "dry": "dry",
    "wet_food": "wet",
    "wet": "wet",
    "treats": "dry",
    "treat": "dry",
    "supplement": "dry",
}


def _get_headers() -> dict[str, str]:
    return {
        "ocp-apim-subscription-key": API_KEY,
        "Content-Type": "application/json",
    }


def _fetch_product_list(session: SyncSession) -> list[dict]:
    """Fetch all dog products from the listing API."""
    resp = session.post(
        f"{API_BASE}/product-digital-shelf/products/facets",
        json={
            "locale": LOCALE,
            "page": 1,
            "limit": 300,  # over-request to get all (~156)
            "species": ["dog"],
            "commercetools_enabled": False,
        },
        headers=_get_headers(),
    )
    resp.raise_for_status()
    data = resp.json()

    products = data.get("products", [])
    logger.info(f"Listing returned {len(products)} products")
    return products


def _fetch_product_detail(session: SyncSession, main_item_code: str) -> dict | None:
    """Fetch full product detail by mainItemCode."""
    url = f"{API_BASE}/product/v2/products/mainitem/{main_item_code}/{LOCALE}"
    resp = session.get(url, headers=_get_headers())
    if not resp.ok:
        logger.warning(
            f"Detail fetch failed for {main_item_code}: {resp.status_code}"
        )
        return None
    return resp.json()


def _parse_channel(detail: dict) -> str:
    """Determine retail vs vet from product_pillar.

    product_pillar is a list of dicts: [{"code": "sptretail", "label": "SPT"}]
    """
    pillars = detail.get("product_pillar", [])
    if isinstance(pillars, list):
        for p in pillars:
            code = p.get("code", "").lower() if isinstance(p, dict) else str(p).lower()
            if code in _CHANNEL_MAP:
                return _CHANNEL_MAP[code]
    elif isinstance(pillars, str):
        return _CHANNEL_MAP.get(pillars.lower(), "retail")
    return "retail"


def _parse_type(detail: dict) -> str:
    """Determine product type from digital_sub_category."""
    sub_cat = detail.get("digital_sub_category", {})
    if isinstance(sub_cat, dict):
        code = sub_cat.get("code", "").lower()
    else:
        code = str(sub_cat).lower()

    if code in _TYPE_MAP:
        return _TYPE_MAP[code]

    # Fallback: check family field
    family = str(detail.get("family", "")).lower()
    if family == "treat" or detail.get("is_treat"):
        return "treat"

    return "food"


def _parse_format(detail: dict) -> str:
    """Determine product format from digital_sub_category."""
    sub_cat = detail.get("digital_sub_category", {})
    if isinstance(sub_cat, dict):
        code = sub_cat.get("code", "").lower()
    else:
        code = str(sub_cat).lower()

    if code in _FORMAT_MAP:
        return _FORMAT_MAP[code]

    return "dry"


def _parse_ingredients(detail: dict) -> str | None:
    """Extract ingredients text from composition array.

    Retail products use key "ingredients", vet products use key "composition".
    Both start with prefix "Ingredient: " that we strip.
    """
    composition = detail.get("composition", [])
    for item in composition:
        # Try both keys — retail uses "ingredients", vet uses "composition"
        text = item.get("ingredients", "") or item.get("composition", "")
        if text:
            text = clean_text(text)
            # Strip common prefix "Ingredient:" or "Ingredients:"
            text = re.sub(r"^ingredients?\s*:\s*", "", text, flags=re.IGNORECASE)
            return text.strip()
    return None


def _parse_ga(detail: dict) -> dict[str, float] | None:
    """Extract guaranteed analysis from composition array.

    GA is a single string like:
    "Crude Protein (min.) 28.0%, Crude Fat (min.) 14.0%, ..."
    """
    composition = detail.get("composition", [])
    ga: dict[str, float] = {}

    for item in composition:
        ga_text = item.get("guaranteed_analysis", "")
        if not ga_text:
            continue

        # Strip common prefix "Guaranteed analysis:"
        ga_text = re.sub(r"^guaranteed\s+analysis\s*:\s*", "", ga_text, flags=re.IGNORECASE)

        # Split on commas or periods followed by uppercase
        # RC format: "Crude Protein (min.) 28.0%, Crude Fat (min.) 14.0%"
        entries = re.split(r",\s*", ga_text)

        for entry in entries:
            entry = entry.strip()
            if not entry:
                continue

            # Pattern: "Label (min./max.) value% or value unit"
            m = re.match(
                r"(.+?)\s*\(?(min|max|minimum|maximum)\.?\)?\s*(\d+\.?\d*)\s*(%|IU/kg|mg/kg|ppm)?",
                entry,
                re.IGNORECASE,
            )
            if not m:
                continue

            label = m.group(1).strip().rstrip("*").strip().lower()
            minmax = m.group(2).lower()
            value = float(m.group(3))
            unit = m.group(4) or "%"

            suffix = "_min" if "min" in minmax else "_max"
            field_base = _GA_LABEL_MAP.get(label)

            if not field_base:
                # Try partial match
                for known_label, field in _GA_LABEL_MAP.items():
                    if known_label in label:
                        field_base = field
                        break

            if field_base:
                ga[f"{field_base}{suffix}"] = value

    return ga if ga else None


def _parse_calorie_content(detail: dict) -> str | None:
    """Extract calorie content from composition array."""
    composition = detail.get("composition", [])
    for item in composition:
        cal_text = item.get("calorie_content", "")
        if cal_text:
            # Strip common prefix "Calorie content:"
            cal_text = re.sub(r"^calorie\s+content\s*:\s*", "", cal_text, flags=re.IGNORECASE)
            cleaned = clean_text(cal_text)
            # Reject GA text that leaked into calorie field (e.g. product 1480).
            # Real calorie strings contain "kcal" or "kilocalorie"; GA text only
            # has "%" and "mg/kg" which normalize_calorie_content would mis-parse.
            if not re.search(r"kcal|kilocalorie", cleaned, re.IGNORECASE):
                continue
            result = normalize_calorie_content(cleaned)
            if result and "kcal" in result:
                return result
    return None


def _parse_aafco(detail: dict) -> str | None:
    """Extract AAFCO statement from composition or top-level."""
    # Check composition array first
    composition = detail.get("composition", [])
    for item in composition:
        text = item.get("aafco_statement", "")
        if text:
            return clean_text(text)

    # Top-level
    text = detail.get("aafco_statement", "")
    return clean_text(text) if text else None


def _parse_variants(detail: dict) -> list[Variant]:
    """Extract pack sizes as variants.

    Packs have: ean, base_pack_size, converted_weight (in kg), weight (raw), scode, etc.
    """
    variants: list[Variant] = []
    packs = detail.get("packs", [])

    for pack in packs:
        ean = str(pack.get("ean", "")).strip()

        # Use converted_weight (already in kg) or base_pack_size
        size_kg: float | None = None
        converted = pack.get("converted_weight")
        if converted:
            try:
                size_kg = round(float(converted), 2)
            except (ValueError, TypeError):
                pass

        if size_kg is None:
            weight_grams = pack.get("weight_in_grams")
            if weight_grams:
                try:
                    size_kg = round(float(weight_grams) / 1000, 3)
                except (ValueError, TypeError):
                    pass

        if size_kg is None:
            size_kg = _parse_weight_kg(str(pack.get("base_pack_size", "")))

        if size_kg is None:
            continue

        size_desc = pack.get("base_pack_size", "") or f"{size_kg} kg"

        variant: Variant = {
            "size_kg": size_kg,
            "size_description": str(size_desc),
        }
        if ean:
            variant["upc"] = ean

        scode = pack.get("scode", "")
        if scode:
            variant["sku"] = str(scode)

        variants.append(variant)

    return variants


def _parse_weight_kg(text: str) -> float | None:
    """Parse a weight string to kg. Handles kg, g, lb, oz."""
    text = text.lower().replace(",", "").strip()

    m = re.search(r"(\d+\.?\d*)\s*kg", text)
    if m:
        return round(float(m.group(1)), 2)

    m = re.search(r"(\d+\.?\d*)\s*g(?:rams?)?(?:\b|$)", text)
    if m:
        return round(float(m.group(1)) / 1000, 3)

    m = re.search(r"(\d+\.?\d*)\s*(?:lb|lbs|pound)", text)
    if m:
        return round(float(m.group(1)) / 2.20462, 2)

    m = re.search(r"(\d+\.?\d*)\s*(?:oz|ounce)", text)
    if m:
        return round(float(m.group(1)) / 35.274, 3)

    return None


def _parse_images(detail: dict) -> list[str]:
    """Extract image URLs from various image fields."""
    images: list[str] = []

    # Bag image
    bag = detail.get("bag_image", {})
    if isinstance(bag, dict):
        url = bag.get("url", "") or bag.get("src", "")
        if url and url.startswith("http"):
            images.append(url)

    # Thumbnail
    thumb = detail.get("thumbnail", {})
    if isinstance(thumb, dict):
        url = thumb.get("url", "") or thumb.get("src", "")
        if url and url.startswith("http") and url not in images:
            images.append(url)

    # Kibble image
    kibble = detail.get("kibble_image", {})
    if isinstance(kibble, dict):
        url = kibble.get("url", "") or kibble.get("src", "")
        if url and url.startswith("http") and url not in images:
            images.append(url)

    # Secondary images
    for img in detail.get("secondary_image_external", []):
        url = img.get("url", "") if isinstance(img, dict) else str(img)
        if url and url.startswith("http") and url not in images:
            images.append(url)

    return images


def _parse_product(listing_item: dict, detail: dict) -> Product:
    """Parse a listing + detail pair into a Product."""
    name = clean_text(
        detail.get("product_title", "")
        or listing_item.get("title", "")
        or detail.get("title", "")
    )
    url_slug = (
        listing_item.get("titleUrl", "")
        or detail.get("product_title_url", "")
    )
    url = f"{WEBSITE_URL}/dogs/{url_slug}" if url_slug else WEBSITE_URL

    product: Product = {
        "name": name,
        "brand": "Royal Canin",
        "url": url,
        "channel": _parse_channel(detail),
        "product_type": _parse_type(detail),
        "product_format": _parse_format(detail),
    }

    # Product line from range field
    range_info = detail.get("range", {})
    if isinstance(range_info, dict):
        label = range_info.get("label", "")
        if label:
            product["product_line"] = clean_text(label)
    elif isinstance(range_info, str) and range_info:
        product["product_line"] = clean_text(range_info)

    # Ingredients
    ingredients = _parse_ingredients(detail)
    if ingredients:
        product["ingredients_raw"] = ingredients

    # GA
    ga = _parse_ga(detail)
    if ga:
        product["guaranteed_analysis"] = ga  # type: ignore[assignment]
        product["guaranteed_analysis_basis"] = "as-fed"

    # Calories
    calories = _parse_calorie_content(detail)
    if calories:
        product["calorie_content"] = calories

    # AAFCO
    aafco = _parse_aafco(detail)
    if aafco:
        product["aafco_statement"] = aafco

    # Life stage
    lifestage = detail.get("lifestage", [])
    if isinstance(lifestage, list) and lifestage:
        labels = [
            ls.get("label", ls.get("code", ""))
            for ls in lifestage
            if isinstance(ls, dict)
        ]
        if labels:
            product["life_stage"] = ", ".join(labels)

    # Breed size
    pet_size = detail.get("pet_size", [])
    if isinstance(pet_size, list) and pet_size:
        labels = [
            ps.get("label", ps.get("code", ""))
            for ps in pet_size
            if isinstance(ps, dict)
        ]
        if labels:
            product["breed_size"] = ", ".join(labels)

    # Images
    images = _parse_images(detail)
    if images:
        product["images"] = images

    # Variants
    variants = _parse_variants(detail)
    if variants:
        product["variants"] = variants

    # Source ID
    main_item = listing_item.get("bvProductId", "") or listing_item.get("id", "")
    if main_item:
        product["source_id"] = str(main_item)

    return product


def scrape_royalcanin(output_dir: Path) -> int:
    """Scrape all Royal Canin Canada dog products. Returns product count."""
    with SyncSession(rate_limit=0.5) as session:
        # Step 1: Get all product listings
        listings = _fetch_product_list(session)

        # Step 2: Fetch detail for each product
        products: list[Product] = []
        seen_names: set[str] = set()
        for i, item in enumerate(listings):
            main_item_code = item.get("bvProductId", "") or item.get("id", "")
            if not main_item_code:
                logger.warning(f"No mainItemCode for product: {item.get('title', '?')}")
                continue

            logger.info(
                f"  [{i + 1}/{len(listings)}] {item.get('title', '?')}"
            )
            detail = _fetch_product_detail(session, main_item_code)
            if not detail:
                continue

            product = _parse_product(item, detail)

            # Deduplicate by case-insensitive name (API returns some products
            # with different URL casing, e.g. "GIANT ADULT" vs "Giant Adult")
            name_key = product["name"].lower().strip()
            if name_key in seen_names:
                logger.info(f"  Skipping duplicate: {product['name']}")
                continue
            seen_names.add(name_key)
            products.append(product)

    write_brand_json("Royal Canin", WEBSITE_URL, products, output_dir, slug="royalcanin")
    return len(products)
