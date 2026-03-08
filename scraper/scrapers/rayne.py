"""Rayne Clinical Nutrition scraper.

Data source: Shopify products.json API.
- Listing: GET raynenutrition.com/products.json (single request, all products)
- Detail: Parse body_html from JSON — ingredients in tabbed HTML (#tab2)
- GA/calories: Rayne publishes GA data as PNG images in tab3 and as PDF diet
  pages linked from product descriptions. Since these are not machine-readable,
  GA and calorie values are maintained as a static lookup (_GA_DATA) transcribed
  from the official GA images and diet page PDFs on raynenutrition.com.
  The "% As Is" column = as-fed basis, which maps to standard AAFCO GA fields.
  Calorie data (ME kcal/kg and kcal/cup) comes from the PDF diet pages.
- All products are vet channel (prescription clinical nutrition)

Key notes:
- Products include both dog and cat food — filter on title keywords
- Product types: Dry, Wet, Stew, Roll, Freeze-Dried, Treats, Toppers, Meatballs
- Variants have grams (weight), SKU, price
- Some treats have marketing copy after ingredients (e.g. "Kangaroo liver.
  Yup, that's it!") — stripped during parsing
- Some dry products come in chickpea and quinoa formulas; the main product
  handle uses the chickpea formula GA values (more common).
"""

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

PRODUCTS_URL = "https://raynenutrition.com/products.json"
WEBSITE_URL = "https://raynenutrition.com"

# Shopify product_type → our product_type
_TYPE_MAP: dict[str, str] = {
    "dry": "food",
    "wet": "food",
    "canned": "food",
    "stew": "food",
    "roll": "food",
    "treats": "treat",
    "toppers": "supplement",
    "meatballs": "treat",
    "freeze-dried": "food",
}

# Shopify product_type → our product_format
_FORMAT_MAP: dict[str, str] = {
    "dry": "dry",
    "wet": "wet",
    "canned": "wet",
    "stew": "wet",
    "roll": "wet",
    "treats": "dry",
    "toppers": "wet",
    "meatballs": "wet",
    "freeze-dried": "dry",
}

# Cat-only indicators in title
_CAT_KEYWORDS = ["cat food", "cat ", "feline", " cats"]


# --- Static GA + calorie data ---
# Transcribed from official Rayne GA images (PNG) and diet page PDFs hosted on
# raynenutrition.com/Shopify CDN.  Values are "% As Is" (as-fed basis).
# Calorie data (kcal/kg and kcal/cup) from the PDF diet pages.
# Last verified: 2026-03-02
#
# Structure: handle -> (GuaranteedAnalysis dict, calorie_content str or None, basis str)
# basis: "as-fed" (default) or "per-1000kcal" (g/1,000 kcal)

_GA_DATA: dict[str, tuple[GuaranteedAnalysis, str | None] | tuple[GuaranteedAnalysis, str | None, str]] = {
    # --- DRY ---
    # Source: GA image + PDF (DS061-0720), chickpea formula
    "crocodilia-maint-canine-bag": (
        {
            "crude_protein_min": 20.9,
            "crude_fat_min": 11.7,
            "crude_fiber_max": 2.6,
            "calcium_min": 0.79,
            "phosphorus_min": 0.51,
            "taurine_min": 0.13,
        },
        "3524 kcal/kg, 378 kcal/cup",
    ),
    # Source: PDF (DS036-0623, Jan 2025)
    "adult-health-rss-canine-bag": (
        {
            "crude_protein_min": 22.5,
            "crude_fat_min": 13.3,
            "crude_fiber_max": 6.1,
            "calcium_min": 0.91,
            "phosphorus_min": 0.72,
            "taurine_min": 0.16,
        },
        "3556 kcal/kg, 391 kcal/cup",
    ),
    # Source: PDF (DS042-0121), chickpea formula
    "rabbit-maint-canine-bag": (
        {
            "crude_protein_min": 26.2,
            "crude_fat_min": 13.1,
            "crude_fiber_max": 1.6,
            "calcium_min": 1.2,
            "phosphorus_min": 0.94,
            "taurine_min": 0.12,
        },
        "3574 kcal/kg, 380 kcal/cup",
    ),
    # Source: PDF (DS044-0421), chickpea formula
    "low-fat-kangaroo-maint-canine-bag": (
        {
            "crude_protein_min": 31.2,
            "crude_fat_min": 7.7,
            "crude_fiber_max": 2.2,
            "calcium_min": 0.73,
            "phosphorus_min": 0.56,
            "taurine_min": 0.13,
        },
        "3333 kcal/kg, 313 kcal/cup",
    ),
    # Source: PDF (DS038-0620)
    "growth-sensitive-gi-canine-bag": (
        {
            "crude_protein_min": 24.1,
            "crude_fat_min": 11.3,
            "crude_fiber_max": 3.5,
            "calcium_min": 1.4,
            "phosphorus_min": 0.9,
            "taurine_min": 0.12,
        },
        "3413 kcal/kg, 362 kcal/cup",
    ),
    # Source: GA image + diet page /vc303
    "skin-relief-canine-bag": (
        {
            "crude_protein_min": 30.5,
            "crude_fat_min": 9.0,
            "crude_fiber_max": 3.8,
            "calcium_min": 1.2,
            "phosphorus_min": 1.0,
            "taurine_min": 0.09,
            "omega_3_min": 0.76,
        },
        "3295 kcal/kg, 310 kcal/cup",
    ),
    # Source: diet page /vc312mq
    "ecoderm-bsfl-canine-bag-1": (
        {
            "crude_protein_min": 23.0,
            "crude_fat_min": 14.7,
            "crude_fiber_max": 5.8,
            "calcium_min": 0.90,
            "phosphorus_min": 0.65,
            "taurine_min": 0.15,
        },
        "3494 kcal/kg, 252 kcal/cup",
    ),
    # --- WET (canned pate) ---
    # Source: GA image + diet page /vc009m
    "crocodilia-maint-canine-cans-1": (
        {
            "crude_protein_min": 7.0,
            "crude_fat_min": 4.3,
            "crude_fiber_max": 0.82,
            "calcium_min": 0.23,
            "phosphorus_min": 0.14,
            "taurine_min": 0.07,
        },
        "994 kcal/kg, 367 kcal/can",
    ),
    # Source: diet page /vc008m-7
    "rabbit-maint-canine-cans-1": (
        {
            "crude_protein_min": 9.2,
            "crude_fat_min": 4.7,
            "crude_fiber_max": 0.01,
            "calcium_min": 0.33,
            "phosphorus_min": 0.30,
            "taurine_min": 0.08,
        },
        "1027 kcal/kg, 379 kcal/can",
    ),
    # Source: diet page /rc002
    "low-fat-kangaroo-maint-canine-cans-1": (
        {
            "crude_protein_min": 11.2,
            "crude_fat_min": 2.2,
            "crude_fiber_max": 0.37,
            "calcium_min": 0.20,
            "phosphorus_min": 0.18,
            "taurine_min": 0.05,
        },
        "860 kcal/kg, 317 kcal/can",
    ),
    # Source: diet page /vc008d-7 — DIAG (diagnostic elimination), no GA table
    "rabbit-diag-dual-species-cans-1": (
        {},
        "1051 kcal/kg, 388 kcal/can",
    ),
    # --- WET (stew) ---
    # Source: GA image + diet page (no new calorie data found)
    "adult-health-rss-canine-stew": (
        {
            "crude_protein_min": 10.8,
            "crude_fat_min": 4.5,
            "crude_fiber_max": 0.35,
            "calcium_min": 0.20,
            "phosphorus_min": 0.15,
            "taurine_min": 0.10,
        },
        None,
    ),
    # Source: GA image (RC302-5_GA.png) — note: image shows dry-basis-like values
    # for this stew product; these are the official "% As Is" figures from Rayne.
    "low-fat-kangaroo-maint-canine-stew": (
        {
            "crude_protein_min": 31.2,
            "crude_fat_min": 7.7,
            "crude_fiber_max": 2.2,
            "calcium_min": 0.73,
            "phosphorus_min": 0.56,
            "taurine_min": 0.13,
        },
        None,
    ),
    # Source: diet page /vc008M-9
    "rabbit-maint-canine-stew": (
        {
            "crude_protein_min": 7.0,
            "crude_fat_min": 5.4,
            "crude_fiber_max": 0.44,
            "calcium_min": 0.34,
            "phosphorus_min": 0.29,
            "taurine_min": 0.06,
        },
        "1040 kcal/kg, 368 kcal/box",
    ),
    # Source: diet page /vc000m-9
    "plant-based-canine-chunky-stew": (
        {
            "crude_protein_min": 8.2,
            "crude_fat_min": 3.1,
            "crude_fiber_max": 0.74,
            "calcium_min": 0.31,
            "phosphorus_min": 0.31,
            "taurine_min": 0.08,
        },
        "1030 kcal/kg, 365 kcal/box",
    ),
    # Source: diet page /vc001d-9 — DIAG (diagnostic elimination), no GA table
    "kangaroo-diag-dual-species-chunky-stew": (
        {},
        "627 kcal/kg, 222 kcal/box",
    ),
    # --- FREEZE-DRIED ---
    # Source: diet page /VC408D — DIAG, no GA table
    "rabbit-diag-dual-species-freeze-dried": (
        {},
        "4156 kcal/kg, 192 kcal/cup",
    ),
    # Source: diet page /VC401D — DIAG, no GA table
    "kangaroo-diag-dual-species-freeze-dried": (
        {},
        "3521 kcal/kg, 176 kcal/cup",
    ),
    # --- DENTAL CHEWS ---
    # Source: diet page /rt208dental
    "rabbit-dental-chews-for-dogs": (
        {
            "crude_protein_min": 6.4,
            "crude_fat_min": 1.3,
            "crude_fiber_max": 0.0,
            "calcium_min": 0.20,
            "phosphorus_min": 0.50,
        },
        "2845 kcal/kg, 43 kcal/treat",
    ),
    # Source: diet page /rt101dental
    "rayne-rewards-kangaroo-dental-chews": (
        {
            "crude_protein_min": 7.3,
            "crude_fat_min": 1.4,
            "crude_fiber_max": 0.69,
            "calcium_min": 0.39,
            "phosphorus_min": 0.64,
        },
        "3900 kcal/kg, 60 kcal/treat",
    ),
    # --- TREATS (calorie-only, g/1000 kcal format — no standard GA) ---
    # Source: diet page /treats
    "rayne-rewards-simple-ingredients-treats-pork": (
        {
            "crude_protein_min": 40.0,
            "crude_fat_min": 23.0,
            "crude_fiber_max": 2.0,
            "moisture_max": 20.0,
        },
        "40 kcal/treat",
    ),
    "kangaroo-liver-treats": (
        {
            "crude_protein_min": 65.0,
            "crude_fat_min": 10.0,
            "crude_fiber_max": 1.0,
            "moisture_max": 5.0,
        },
        "3756 kcal/kg, 1 kcal/treat",
    ),
    # Meatballs: GA is published as g/1000kcal (not as-fed %). Without kcal/kg
    # we can't convert to percentages, so we omit GA and store calories only.
    "rabbit-meatballs": (
        {},
        "25 kcal/treat",
    ),
    "kangaroo-meatballs": (
        {},
        "22 kcal/treat",
    ),
    # --- ROLLS ---
    # Source: diet page /treats (kcal/g as fed)
    # Converted from g/1,000 kcal using 2200 kcal/kg
    "rabbit-fresh-roll-for-dogs": (
        {
            "crude_protein_min": 13.9,
            "crude_fat_min": 9.7,
            "crude_fiber_max": 4.07,
            "calcium_min": 0.75,
            "phosphorus_min": 0.40,
            "potassium_min": 0.79,
            "sodium_min": 1.19,
        },
        "2200 kcal/kg",
    ),
    # Converted from g/1,000 kcal using 2500 kcal/kg
    "plant-based-fresh-roll-for-dogs": (
        {
            "crude_protein_min": 15.5,
            "crude_fat_min": 7.9,
            "crude_fiber_max": 6.4,
            "calcium_min": 0.80,
            "phosphorus_min": 0.38,
            "potassium_min": 0.75,
            "sodium_min": 1.10,
        },
        "2500 kcal/kg",
    ),
    # --- TOPPERS ---
    # Source: diet page /wellstridetreats
    "wellstride-treats-turkey-blueberries": (
        {
            "crude_protein_min": 25.0,
            "crude_fat_min": 10.0,
            "crude_fiber_max": 2.0,
            "moisture_max": 20.0,
        },
        "3256 kcal/kg, 6 kcal/treat",
    ),
    "good-gravy-veggie": (
        {},
        "540 kcal/kg, 22 kcal/pouch",
    ),
}

# Samples share the same formulation as the main product — map sample handles
# to the main product handle so they inherit GA/calorie data.
_SAMPLE_TO_MAIN: dict[str, str] = {
    "crocodilia-maint-canine-bag-sample": "crocodilia-maint-canine-bag",
    "rabbit-maint-canine-bag-sample": "rabbit-maint-canine-bag",
    "rabbit-maint-quinoa-canine-bag-sample": "rabbit-maint-canine-bag",
    "growth-sensitive-gi-canine-bag-sample": "growth-sensitive-gi-canine-bag",
    "adult-health-rss-canine-bag-sample": "adult-health-rss-canine-bag",
    "low-fat-kangaroo-maint-canine-bag-sample": "low-fat-kangaroo-maint-canine-bag",
    "low-fat-kangaroo-maint-quinoa-canine-bag-sample": "low-fat-kangaroo-maint-canine-bag",
    "plant-based-canine-bag-sample": "plant-based-canine-bag",
}


def _get_ga_and_calories(handle: str) -> tuple[GuaranteedAnalysis | None, str | None, str]:
    """Look up GA and calorie data for a product by its Shopify handle.

    Returns (ga, calorie_content, basis) where basis is "as-fed" or "per-1000kcal".
    """
    def _unpack(entry: tuple) -> tuple[GuaranteedAnalysis | None, str | None, str]:
        if len(entry) == 3:
            return entry[0], entry[1], entry[2]  # type: ignore[return-value]
        return entry[0], entry[1], "as-fed"

    # Direct match
    if handle in _GA_DATA:
        return _unpack(_GA_DATA[handle])
    # Sample → main product fallback
    main_handle = _SAMPLE_TO_MAIN.get(handle)
    if main_handle and main_handle in _GA_DATA:
        return _unpack(_GA_DATA[main_handle])
    return None, None, "as-fed"


def _is_dog_product(product: dict) -> bool:
    """Filter to dog products only (exclude cat-only and non-food items)."""
    title = product.get("title", "").lower()
    product_type = product.get("product_type", "").lower()

    # Skip brochures and non-food items
    if product_type in ("brochure",):
        return False

    # Skip cat-only products
    if "cat food" in title and "dog" not in title:
        return False
    if "cat " in title and "dog" not in title:
        return False
    if "feline" in title and "canine" not in title and "dog" not in title:
        return False

    # Include products that mention dog/canine, or multi-species products
    if "dog" in title or "canine" in title:
        return True
    if "dogs and cats" in title or "cats and dogs" in title:
        return True

    return False


def _detect_type(product: dict) -> str:
    """Map Shopify product_type to our product type."""
    shopify_type = product.get("product_type", "").lower().strip()
    return _TYPE_MAP.get(shopify_type, "food")


def _detect_format(product: dict) -> str:
    """Map Shopify product_type to our product format."""
    shopify_type = product.get("product_type", "").lower().strip()
    return _FORMAT_MAP.get(shopify_type, "dry")


def _strip_marketing_copy(text: str) -> str:
    """Strip marketing sentences that follow ingredient lists.

    Some treat products have marketing copy after the ingredient list, e.g.:
    "Kangaroo liver. Yup, that's it! Just one, real food ingredient..."

    Heuristic: split on ". " and keep sentences that look like ingredient text
    (comma-separated names). If a sentence after a period starts with a
    non-ingredient word (capitalized pronoun, exclamation, etc.), truncate there.
    """
    # If no sentence break, return as-is
    if ". " not in text:
        return text

    # Non-ingredient sentence starters — marketing language
    _MARKETING_STARTS = re.compile(
        r"^(Yup|Just|That|It|Our|We|This|Try|Made|Only|No |Real |And that)",
        re.IGNORECASE,
    )

    parts = text.split(". ")
    kept: list[str] = [parts[0]]

    for part in parts[1:]:
        if _MARKETING_STARTS.match(part.strip()):
            break
        kept.append(part)

    result = ". ".join(kept)
    # Restore trailing period if the original ingredient list had one
    if not result.endswith("."):
        result += "."
    return result


def _parse_ingredients(body_html: str) -> str | None:
    """Extract ingredients from #tab2 in body_html."""
    if not body_html:
        return None

    soup = BeautifulSoup(body_html, "html.parser")
    tab2 = soup.find("li", id="tab2")
    if not tab2:
        return None

    text = clean_text(tab2.get_text(separator=" "))
    if len(text) < 10:
        return None

    text = _strip_marketing_copy(text)
    return text


def _parse_variants(product: dict) -> list[Variant]:
    """Extract size variants from Shopify variants array."""
    variants: list[Variant] = []

    for v in product.get("variants", []):
        title = v.get("title", "")
        sku = v.get("sku", "")
        grams = v.get("grams", 0)

        if not title and not grams:
            continue

        size_kg = round(grams / 1000, 3) if grams else 0.0

        variant: Variant = {
            "size_kg": size_kg,
            "size_description": title,
        }
        if sku:
            variant["sku"] = sku

        variants.append(variant)

    return variants


def _parse_images(product: dict) -> list[str]:
    """Extract image URLs from Shopify images array."""
    images: list[str] = []
    for img in product.get("images", []):
        src = img.get("src", "")
        if src:
            images.append(src)
    return images


def _parse_product(product: dict) -> Product | None:
    """Parse a Shopify product into our Product format."""
    title = product.get("title", "")
    handle = product.get("handle", "")
    if not title or not handle:
        return None

    name = clean_text(title)
    url = f"{WEBSITE_URL}/products/{handle}"

    result: Product = {
        "name": name,
        "brand": "Rayne",
        "sub_brand": "Rayne Clinical Nutrition",
        "url": url,
        "channel": "vet",
        "product_type": _detect_type(product),
        "product_format": _detect_format(product),
    }

    # Ingredients from body_html tab2
    ingredients = _parse_ingredients(product.get("body_html", ""))
    if ingredients:
        result["ingredients_raw"] = ingredients

    # GA + calorie data from static lookup
    ga, calorie_raw, ga_basis = _get_ga_and_calories(handle)
    if ga:
        result["guaranteed_analysis"] = ga
        result["guaranteed_analysis_basis"] = ga_basis
    if calorie_raw:
        normalized = normalize_calorie_content(calorie_raw)
        if normalized:
            result["calorie_content"] = normalized

    # Images
    images = _parse_images(product)
    if images:
        result["images"] = images

    # Variants
    variants = _parse_variants(product)
    if variants:
        result["variants"] = variants

    # Source ID
    product_id = product.get("id")
    if product_id:
        result["source_id"] = str(product_id)

    return result


def scrape_rayne(output_dir: Path) -> int:
    """Scrape all Rayne dog food products. Returns product count."""
    with SyncSession(rate_limit=0.5) as session:
        resp = session.get(PRODUCTS_URL)
        resp.raise_for_status()
        all_products = resp.json()["products"]

        logger.info(f"Fetched {len(all_products)} total products from Shopify")

        # Filter to dog products
        dog_products = [p for p in all_products if _is_dog_product(p)]
        logger.info(f"Filtered to {len(dog_products)} dog products")

        products: list[Product] = []
        for shopify_product in dog_products:
            product = _parse_product(shopify_product)
            if product:
                products.append(product)
            else:
                logger.warning(f"Failed to parse: {shopify_product.get('title', '?')}")

    write_brand_json("Rayne", WEBSITE_URL, products, output_dir, slug="rayne")
    return len(products)
