"""Open Farm scraper.

Data source: Shopify JSON + HTML page scrape.
- Listing: GET openfarmpet.com/products.json (paginated, 30/page)
- Metadata: Shopify JSON has tags, variants, images, prices
- Detail: Full product page HTML for ingredients, GA, calories
- Tags: Rich metadata (_protein::salmon, _lifestage::adult, _format::traditionalkibble)

Key notes:
- /products.json has product discovery data but NOT ingredients/GA/calories
- Must fetch each product page HTML for nutritional data
- Full ingredient list is inside an "ingredients-modal" div (the inline
  <details> section only shows the first 2-3 items + "View Complete Ingredients")
- Handles with special characters (e.g. trademark symbol) must be URL-encoded
- All retail channel
- Tags provide excellent structured metadata
"""

import logging
import re
import urllib.parse
from pathlib import Path

from bs4 import BeautifulSoup, Tag
from wafer import SyncSession

from .common import (
    GuaranteedAnalysis,
    Product,
    Variant,
    clean_text,
    normalize_calorie_content,
    parse_ga_html_table,
    write_brand_json,
)

logger = logging.getLogger(__name__)

PRODUCTS_JSON_URL = "https://openfarmpet.com/products.json"
WEBSITE_URL = "https://openfarmpet.com"

# Conversion constants
LB_TO_KG = 0.45359237
OZ_TO_KG = 0.02834952


def _fetch_all_shopify_products(session: SyncSession) -> list[dict]:
    """Fetch all products from Shopify /products.json with pagination."""
    all_products: list[dict] = []
    page = 1

    while True:
        url = f"{PRODUCTS_JSON_URL}?page={page}&limit=250"
        resp = session.get(url)
        if not resp.ok:
            break

        products = resp.json().get("products", [])
        if not products:
            break

        all_products.extend(products)
        logger.info(f"  Page {page}: {len(products)} products (total: {len(all_products)})")

        if len(products) < 30:
            break
        page += 1

        if page > 20:  # safety limit
            break

    return all_products


def _is_dog_product(product: dict) -> bool:
    """Filter to dog products only using tags.

    Excludes bundles/variety packs and discontinued/hidden products.
    """
    tags = product.get("tags", [])
    if isinstance(tags, list):
        tag_str = " ".join(t.lower() for t in tags)
    else:
        tag_str = str(tags).lower()

    # Skip discontinued/hidden products
    if "_discontinued" in tag_str or "_hidden" in tag_str:
        return False

    # Skip bundles — they're multi-product packs, not individual foods
    if "category::bundle" in tag_str:
        return False
    title = product.get("title", "").lower()
    if "bundle" in title or "variety pack" in title:
        return False

    if "product_dog" in tag_str:
        return True

    if "dog" in title:
        return True

    return False


def _extract_tag_value(tags: list[str], prefix: str) -> str | None:
    """Extract a tag value by prefix (e.g., '_protein::salmon' -> 'salmon')."""
    for tag in tags:
        if tag.startswith(prefix):
            return tag[len(prefix):]
    return None


def _extract_all_tag_values(tags: list[str], prefix: str) -> list[str]:
    """Extract all tag values matching a prefix."""
    values: list[str] = []
    for tag in tags:
        if tag.startswith(prefix):
            values.append(tag[len(prefix):])
    return values


def _detect_type(tags: list[str], title: str) -> str:
    """Detect product type: food, treat, or supplement."""
    title_lower = title.lower()

    # Treats — air-dried bars/sticks/biscuits
    type_val = _extract_tag_value(tags, "_productType::")
    if type_val and "treat" in type_val.lower():
        return "treat"
    if "treat" in title_lower:
        return "treat"

    # Supplements — health chews, bone broth, toppers
    if "supplement" in title_lower or "bone broth" in title_lower:
        return "supplement"
    if type_val and ("topper" in type_val.lower() or "supplement" in type_val.lower()):
        return "supplement"
    if "topper" in title_lower:
        return "supplement"

    return "food"


def _detect_format(tags: list[str], title: str) -> str:
    """Detect product format: dry or wet."""
    title_lower = title.lower()

    # Wet: pâtés, stews, wet food, toppers, bone broth, rolls
    type_val = _extract_tag_value(tags, "_productType::")
    if type_val:
        type_lower = type_val.lower()
        if "wet" in type_lower or "stew" in type_lower or "pate" in type_lower:
            return "wet"
        if "topper" in type_lower:
            return "wet"

    if any(kw in title_lower for kw in ("pâté", "pate", "stew", "wet food", "topper", "bone broth")):
        return "wet"

    return "dry"


def _detect_product_line(tags: list[str], title: str) -> str | None:
    """Detect product line from tags, with title-based fallback.

    Open Farm product lines:
    - From _brand:: tag: RawMix, Epic Blend, GoodGut, goodbowl, Original, etc.
    - From title/tags for untagged products: Hearty Stew, Healthy Weight,
      Digestive Health, Skin & Coat Health
    """
    brand_val = _extract_tag_value(tags, "_brand::")
    if brand_val:
        # Normalize casing: "goodbowl" -> "Goodbowl"
        return brand_val.title() if brand_val.islower() else brand_val

    # Infer from title patterns for products without _brand:: tag
    title_lower = title.lower()
    if "hearty stew" in title_lower:
        return "Hearty Stew"
    if "rustic stew" in title_lower:
        return "Rustic Stew"
    if "healthy weight" in title_lower:
        return "Healthy Weight"
    if "digestive health" in title_lower:
        return "Digestive Health"
    if "skin" in title_lower and "coat" in title_lower:
        return "Skin & Coat Health"
    if "icelandic" in title_lower:
        return "Icelandic"
    if "kind earth" in title_lower:
        return "Kind Earth"
    if "freshly crafted" in title_lower:
        return "Freshly Crafted"
    if "freeze dried raw" in title_lower:
        return "Freeze Dried Raw"
    if "air dried" in title_lower:
        return "Air Dried"
    if "bone broth" in title_lower:
        return "Bone Broth"

    # Infer from _dietaryneeds:: tags
    dietary = _extract_tag_value(tags, "_dietaryneeds::")
    if dietary:
        dietary_map = {
            "weightmanagement": "Healthy Weight",
            "digestivehealth": "Digestive Health",
            "skincoathealth": "Skin & Coat Health",
        }
        if dietary in dietary_map:
            return dietary_map[dietary]

    return None


def _detect_life_stage(tags: list[str], title: str) -> str | None:
    """Detect life stage from tags, considering all _lifestage:: values.

    Priority logic:
    - If "all_lifestages" tag present -> "All Life Stages"
    - If both puppy and adult/senior tags -> "All Life Stages"
    - If only puppy tags -> "Puppy"
    - If only adult/senior -> "Adult"
    - Also check title for "Puppy" keyword as a fallback
    """
    stages = _extract_all_tag_values(tags, "_lifestage::")
    if not stages:
        # Title-based fallback
        if "puppy" in title.lower():
            return "Puppy"
        return None

    stage_set = {s.lower() for s in stages}

    # Explicit all_lifestages tag
    if "all_lifestages" in stage_set:
        return "All Life Stages"

    has_puppy = any(s.startswith("puppy") for s in stage_set)
    has_adult = "adult" in stage_set
    has_senior = "senior" in stage_set

    # If both puppy and adult/senior stages are present, it's all life stages
    if has_puppy and (has_adult or has_senior):
        return "All Life Stages"

    if has_puppy:
        return "Puppy"

    if has_senior and not has_adult:
        return "Senior"

    if has_adult:
        return "Adult"

    # Fallback: title check
    if "puppy" in title.lower():
        return "Puppy"

    return stages[0].title() if stages else None


def _parse_ingredients_from_modal(html: str) -> str | None:
    """Extract full ingredients from the ingredients-modal div.

    Open Farm product pages have the full ingredient list inside a modal
    dialog (class="ingredients-modal") with each ingredient in an <h4> tag.
    The inline <details> section only shows the first 2-3 ingredients.
    """
    soup = BeautifulSoup(html, "lxml")
    modal = soup.find("div", class_="ingredients-modal")
    if not modal:
        return None

    h4s = modal.find_all("h4")
    if not h4s:
        return None

    ingredients = [clean_text(h4.get_text(strip=True)) for h4 in h4s]
    # Filter out empty strings
    ingredients = [i for i in ingredients if i]

    if not ingredients:
        return None

    return ", ".join(ingredients)


def _clean_ingredient_text(raw: str) -> str:
    """Clean raw ingredient text: remove heading prefix and 'View Complete' noise."""
    text = clean_text(raw)
    text = re.sub(r"^ingredients?\s*:?\s*", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"\s*View Complete Ingredients\s*", "", text, flags=re.IGNORECASE).strip()
    return text


def _parse_ingredients_html(html: str) -> str | None:
    """Extract ingredients from product page HTML.

    Strategy:
    1. First try the ingredients-modal (has the full list)
    2. Fall back to inline <details> section or text search
    """
    # Primary: extract from modal (full ingredient list)
    modal_ingredients = _parse_ingredients_from_modal(html)
    if modal_ingredients:
        return modal_ingredients

    # Fallback: search for ingredient-like text blocks in page
    soup = BeautifulSoup(html, "lxml")

    # Look for ingredients section by heading
    for heading in soup.find_all(["h2", "h3", "h4", "strong", "b", "span"]):
        text = heading.get_text(strip=True).lower()
        if text in ("ingredients", "ingredients:") or "ingredient" in text:
            # Get the next sibling content
            sibling = heading.find_next_sibling()
            if sibling:
                ing_text = _clean_ingredient_text(sibling.get_text(separator=" "))
                if len(ing_text) > 20:
                    return ing_text

            # Check parent's next sibling
            parent = heading.parent
            if parent:
                next_sib = parent.find_next_sibling()
                if next_sib:
                    ing_text = _clean_ingredient_text(next_sib.get_text(separator=" "))
                    if len(ing_text) > 20:
                        return ing_text

    # Last resort: regex on full text
    full_text = soup.get_text(separator="\n")
    match = re.search(
        r"Ingredients?\s*:?\s*\n(.*?)(?:\nGuaranteed Analysis|\nCalorie|\nFeeding|\n\n|\nAAFCO)",
        full_text,
        re.IGNORECASE | re.DOTALL,
    )
    if match:
        ing = _clean_ingredient_text(match.group(1))
        if len(ing) > 20:
            return ing

    return None


def _parse_ga_html(html: str) -> GuaranteedAnalysis | None:
    """Extract GA from product page HTML table."""
    soup = BeautifulSoup(html, "lxml")
    for table in soup.find_all("table"):
        table_text = table.get_text().lower()
        if "protein" in table_text or "crude fat" in table_text:
            ga = parse_ga_html_table(str(table))
            if ga:
                return ga
    return None


def _parse_calorie_html(html: str) -> str | None:
    """Extract calorie content from product page HTML."""
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(separator=" ")

    cal_match = re.search(
        r"(\d[\d,]*)\s*kcal/kg.*?(\d+)\s*kcal/(?:cup|can)",
        text,
        re.IGNORECASE,
    )
    if cal_match:
        return normalize_calorie_content(cal_match.group(0))

    # Broader calorie search
    match = re.search(r"calorie.*?(\d[\d,]*\s*kcal.*?)(?:\n|$)", text, re.IGNORECASE)
    if match:
        return normalize_calorie_content(match.group(1))

    return None


def _parse_size_description(size_desc: str) -> float:
    """Parse a size description like '3.5 lb', '18 lb', '12.5 oz' to kg.

    Also handles case-style descriptions like '12.5 oz (Case of 12)' — the
    case multiplier is ignored; we report per-unit weight.
    """
    if not size_desc:
        return 0.0

    # Extract the numeric value and unit
    match = re.match(r"(\d+\.?\d*)\s*(lb|lbs|fl\s*oz|oz|kg|g)\b", size_desc, re.IGNORECASE)
    if not match:
        return 0.0

    value = float(match.group(1))
    unit = match.group(2).lower().strip()

    if unit in ("lb", "lbs"):
        return round(value * LB_TO_KG, 3)
    elif unit == "oz":
        return round(value * OZ_TO_KG, 3)
    elif unit in ("fl oz", "floz"):
        # Fluid ounces — approximate as weight ounces for liquids like broth
        return round(value * OZ_TO_KG, 3)
    elif unit == "kg":
        return round(value, 3)
    elif unit == "g":
        return round(value / 1000, 3)

    return 0.0


def _parse_variants(product: dict) -> list[Variant]:
    """Extract variants from Shopify product data."""
    variants: list[Variant] = []
    for v in product.get("variants", []):
        title = v.get("title", "")
        sku = v.get("sku", "")
        grams = v.get("grams", 0)

        if not title and not grams:
            continue

        # Prefer grams from Shopify if non-zero, otherwise parse from title
        if grams:
            size_kg = round(grams / 1000, 3)
        else:
            size_kg = _parse_size_description(title)

        variant: Variant = {
            "size_kg": size_kg,
            "size_description": title,
        }
        if sku:
            variant["sku"] = sku
        variants.append(variant)

    return variants


def _parse_images(product: dict) -> list[str]:
    """Extract image URLs from Shopify images array in position order.

    Shopify's ``position`` field reflects the merchant's intended display
    order: position 1 is always the product packshot. We preserve this
    order rather than sorting by pixel count (which would push small-but-
    correct packshots behind large lifestyle/dog photos).
    """
    raw_images = product.get("images", [])
    sorted_images = sorted(
        raw_images,
        key=lambda img: img.get("position", 0),
    )
    images: list[str] = []
    for img in sorted_images[:5]:
        src = img.get("src", "")
        if src:
            images.append(src)
    return images


def _url_encode_handle(handle: str) -> str:
    """URL-encode special characters in a Shopify handle.

    Some handles contain non-ASCII characters like the trademark symbol,
    which must be percent-encoded for valid HTTP requests.
    """
    return urllib.parse.quote(handle, safe="-._~")


def _parse_product(
    shopify_product: dict, page_html: str | None
) -> Product | None:
    """Parse an Open Farm product from Shopify data + page HTML."""
    title = shopify_product.get("title", "")
    handle = shopify_product.get("handle", "")
    if not title or not handle:
        return None

    tags = shopify_product.get("tags", [])
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",")]

    product: Product = {
        "name": clean_text(title),
        "brand": "Open Farm",
        "url": f"{WEBSITE_URL}/products/{_url_encode_handle(handle)}",
        "channel": "retail",
        "product_type": _detect_type(tags, title),
        "product_format": _detect_format(tags, title),
    }

    product_line = _detect_product_line(tags, title)
    if product_line:
        product["product_line"] = product_line

    life_stage = _detect_life_stage(tags, title)
    if life_stage:
        product["life_stage"] = life_stage

    # Nutritional data from HTML page
    if page_html:
        ingredients = _parse_ingredients_html(page_html)
        if ingredients:
            product["ingredients_raw"] = ingredients

        ga = _parse_ga_html(page_html)
        if ga:
            product["guaranteed_analysis"] = ga
            product["guaranteed_analysis_basis"] = "as-fed"

        cal = _parse_calorie_html(page_html)
        if cal:
            product["calorie_content"] = cal

    # Images from Shopify
    images = _parse_images(shopify_product)
    if images:
        product["images"] = images

    # Variants from Shopify
    variants = _parse_variants(shopify_product)
    if variants:
        product["variants"] = variants

    # Source ID
    product_id = shopify_product.get("id")
    if product_id:
        product["source_id"] = str(product_id)

    return product


def scrape_openfarm(output_dir: Path) -> int:
    """Scrape all Open Farm dog food products. Returns product count."""
    with SyncSession(rate_limit=1.0) as session:
        # Step 1: Get all products from Shopify JSON
        all_shopify = _fetch_all_shopify_products(session)
        logger.info(f"Fetched {len(all_shopify)} total Shopify products")

        # Filter to dog products
        dog_products = [p for p in all_shopify if _is_dog_product(p)]
        logger.info(f"Filtered to {len(dog_products)} dog products")

        # Step 2: Fetch each product page for nutritional data
        products: list[Product] = []
        for i, shopify_product in enumerate(dog_products):
            handle = shopify_product.get("handle", "")
            title = shopify_product.get("title", "?")
            logger.info(f"  [{i + 1}/{len(dog_products)}] {title}")

            # Fetch product page HTML (URL-encode handle for special chars)
            page_html: str | None = None
            if handle:
                encoded_handle = _url_encode_handle(handle)
                page_url = f"{WEBSITE_URL}/products/{encoded_handle}"
                resp = session.get(page_url)
                if resp.ok:
                    page_html = resp.text
                else:
                    logger.warning(f"Failed to fetch page for {handle}: {resp.status_code}")

            product = _parse_product(shopify_product, page_html)
            if product:
                products.append(product)

    write_brand_json("Open Farm", WEBSITE_URL, products, output_dir, slug="openfarm")
    return len(products)
