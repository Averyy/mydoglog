"""Hill's retail (Science Diet) scraper (via PetSmart.ca).

Hill's website only publishes dry-matter-basis "typical" nutrient values, not
the as-fed label GA every other brand stores. PetSmart carries Science Diet
products and has the real as-fed label GA in their RSC payloads.

For products where PetSmart is missing GA or calories, we fall back to
hillspet.ca. GA from Hill's is dry-matter basis — fine for dry food (standard
comparison), flagged as "dry-matter" for wet food so the UI can show "(DMB)".

Single scrape using PetSmart's featured-brands page for Hills Science Diet.
"""

import json
import logging
import re
from pathlib import Path

from bs4 import BeautifulSoup
from wafer import SyncSession

from .common import Product, write_brand_json
from .petsmart import scrape_petsmart_brand

logger = logging.getLogger(__name__)

HILLS_CA_BASE = "https://www.hillspet.ca/en-ca/dog-food/"

# Manual fallback data for products where neither PetSmart RSC nor Hill's CA
# have the data. Sourced from Chewy.ca, PawDiet.com, hillspet.ca packaging.
# Key: PetSmart URL substring. Last verified: 2026-03-22.
_MANUAL_PRODUCT_DATA: dict[str, dict] = {
    # --- Dry food with dead Hill's CA pages ---
    # Source: Chewy.ca (dp/1000074875, dp/1000034574)
    "health-mobility-adult-dog-food-3380": {
        "calorie_content": "3617 kcal/kg, 359 kcal/cup",
        "guaranteed_analysis": {
            "crude_protein_min": 17.0,
            "crude_fat_min": 10.0,
            "crude_fiber_max": 3.0,
            "moisture_max": 10.0,
            "omega_3_min": 1.0,
            "epa_min": 0.2,
            "glucosamine_min": 250,
            "chondroitin_min": 750,
        },
        "guaranteed_analysis_basis": "as-fed",
    },
    # Source: PawDiet.com (hills-science-diet-perfect-digestion-chicken-brown-rice-whole-oats-recipe-small-bites)
    "perfect-digestion-small-bites-adult-dry-dog-food---chicken-whole-oats-and-rice-61773": {
        "calorie_content": "3620 kcal/kg",
        "guaranteed_analysis": {
            "crude_protein_min": 25.0,
            "crude_fat_min": 14.5,
            "crude_fiber_max": 2.1,
            "moisture_max": 10.0,
        },
        "guaranteed_analysis_basis": "as-fed",
    },
    # --- Wet food missing calories from Hill's CA ---
    # Source: Chewy.com (dp/121612) — 12.5 oz (354g) can
    "healthy-cuisine-adult-7-wet-dog-food---125-oz-77238": {
        "calorie_content": "257 kcal/can",
    },
    # --- Treats — Hill's CA has no kcal values ---
    # Sources: hillspet.ca (packaging text), Chewy.ca
    "soft-baked-dog-treat---natural-grain-free-beef-and-sweet-potato-18789": {
        "calorie_content": "12 kcal/treat",
    },
    "soft-baked-dog-treat---natural-grain-free-duck-and-pumpkin-66467": {
        "calorie_content": "11 kcal/treat",
    },
    "soft-baked-naturals-dog-treat---grain-free-chicken-and-carrots-59942": {
        "calorie_content": "12 kcal/treat",
    },
    "jerky-strips-dog-treat---71-oz-2609": {
        "calorie_content": "3061 kcal/kg, 16 kcal/treat",
    },
    "mini-jerky-strips-dog-treat---71-oz-2636": {
        "calorie_content": "3061 kcal/kg, 16 kcal/treat",
    },
    "flexi-stix-jerky-dog-treat---natural-beef-31421": {
        "calorie_content": "3240 kcal/kg",
    },
    "flexi-stix-jerky-dog-treat---natural-turkey-30860": {
        "calorie_content": "3170 kcal/kg",
    },
    "soft-savories-dog-treat---natural-peanut-butter-and-banana-66469": {
        "calorie_content": "27 kcal/treat",
    },
    "soft-and-chewy-training-treats---chicken-78336": {
        "calorie_content": "2 kcal/treat",
    },
}

# Complete PetSmart → Hill's CA URL mapping.
# Key: PetSmart URL suffix (after /hills-science-diet- or /hills-).
# Value: Hill's CA slug (after /en-ca/dog-food/).
# Last verified: 2026-03-22.

_PETSMART_TO_HILLS_CA: dict[str, str] = {
    # ── WET FOOD ──
    # 13 oz cans — "7+ Senior" = Hill's "Mature Adult"
    "7-senior-wet-dog-food---beef-and-barley-13-oz-91864": "science-diet-mature-adult-beef-barley-canned",
    "7-senior-wet-dog-food---chicken-and-barley-13-oz-2737": "science-diet-mature-adult-chicken-canned",
    # 13 oz cans — Adult
    "adult-dog-wet-food---salmon-and-barley-entree-13-oz-82318": "science-diet-adult-salmon-canned",
    "adult-entree-dog-food---chicken-and-beef-83459": "science-diet-adult-chicken-beef-canned",
    "adult-wet-dog-food---beef-and-barley-13-oz-2731": "science-diet-adult-beef-barley-canned",
    "adult-wet-dog-food---chicken-and-barley-13-oz-91863": "science-diet-adult-chicken-canned",
    # 12.8 oz Savory Stew = Hill's "Chunks & Gravy"
    "savory-stew-7-senior-wet-dog-food---beef-and-vegetable-128-oz-2764": "science-diet-mature-adult-chunks-gravy-beef-vegetables-canned",
    "savory-stew-7-senior-wet-dog-food---chicken-and-vegetable-128-oz-91862": "science-diet-mature-adult-chunks-gravy-chicken-vegetables-canned",
    "savory-stew-adult-wet-dog-food---beef-and-vegetable-128-oz-91861": "science-diet-adult-chunks-gravy-beef-vegetables-canned",
    "savory-stew-adult-wet-dog-food---chicken-and-vegetable-128-oz-2762": "science-diet-adult-chunks-gravy-chicken-vegetable-canned",
    "savory-stew-puppy-wet-dog-food---chicken-and-vegetables-128-oz-34795": "science-diet-puppy-chunks-gravy-chicken-vegetables-canned",
    # 12.5 oz Healthy Cuisine
    "healthy-cuisine-adult-7-wet-dog-food---125-oz-77238": "science-diet-mature-adult-healthy-cuisine-beef-carrots-peas-stew-canned",
    "healthy-cuisine-adult-wet-dog-food---braised-beef-carrots-and-peas-125-oz-91865": "science-diet-adult-healthy-cuisine-beef-carrots-peas-canned",
    "healthy-cuisine-adult-wet-dog-food---roasted-chicken-carrots-and-spinach-125-oz-75577": "science-diet-adult-healthy-cuisine-chicken-carrots-spinach-stew-canned",
    # 12.5/12.8 oz Perfect Weight / Joint wet
    "adult-perfect-weight-wet-dog-food---chicken-and-vegetable-77237": "science-diet-adult-perfect-weight-vegetable-chicken-stew-canned",
    "perfect-weight-adult-dog-wet-food---hearty-vegetables-and-salmon-stew-125-oz-82322": "science-diet-adult-perfect-weight-veg-salmon-stew-canned",
    "perfect-weight-adult-wet-dog-food---vegetable-and-chicken-stew-125-oz-33939": "science-diet-adult-perfect-weight-vegetable-chicken-stew-canned",
    "perfect-weight-and-joint-support-adult-wet-dog-food---vegetable-and-tuna-125-oz-82321": "science-diet-adult-perfect-weight-joint-veg-tuna-stew-canned",
    # 12.5/12.8 oz Perfect Digestion wet
    "perfect-digestion-adult-wet-dog-food---chicken-vegetable-and-rice-stew-128-oz-75575": "science-diet-adult-perfect-digestion-chicken-vegetable-rice-stew-canned",
    "perfect-digestion-chicken-and-rice-entree-adult-dog-wet-food---128-oz-82352": "science-diet-adult-perfect-digestion-chicken-rice-entree-canned",
    # 12.5 oz Sensitive Stomach & Skin wet
    "sensitive-stomach-and-skin-adult-dog-wet-food---chicken-and-vegetable-stew-125-oz-82320": "science-diet-adult-sensitive-stomach-skin-chicken-veg-stew-canned",
    "sensitive-stomach-and-skin-adult-wet-dog-food---chicken-and-vegetable-128-oz-40162": "science-diet-adult-sensitive-stomach-skin-chicken-veg-stew-canned",
    "sensitive-stomach-and-skin-adult-wet-dog-food---salmon-and-vegetable-128-oz-91860": "science-diet-adult-sensitive-stomach-skin-chicken-veg-stew-canned",
    "sensitive-stomach-and-skin-adult-wet-dog-food---turkey-and-rice-125-oz-68835": "science-diet-adult-sensitive-stomach-skin-tender-turkey-rice-stew-canned",
    "sensitive-stomach-and-skin-puppy-wet-dog-food---salmon-and-vegetable-stew-125-oz-82319": "science-diet-puppy-sensitive-stomach-skin-salmon-vegetable-stew-canned",
    # Senior Vitality wet
    "senior-vitality-7-senior-wet-dog-food---chicken-and-vegetable-stew-125-oz-75576": "science-diet-adult-7-senior-vitality-chicken-vegetables-stew-lg-canned",
    # Puppy wet
    "puppy-wet-dog-food---chicken-and-barley-13-oz-2745": "science-diet-puppy-chicken-canned",
    "puppy-wet-dog-food---chicken-and-rice-stew-125-oz-76220": "science-diet-puppy-chicken-rice-stew-canned",
    # Toppers
    "healthy-cuisine-adult-wet-dog-food-topper---chicken-and-vegetable-28-oz-90508": "science-diet-adult-healthy-cuisine-chicken-vegetables-stew-pouch",
    "healthy-cuisine-senior-7-wet-dog-food-topper---chicken-and-vegetable-28-oz-90509": "science-diet-mature-adult-healthy-cuisine-chicken-vegetables-stew-pouch",
    "perfect-weight-adult-wet-dog-food-topper---vegetables-and-salmon-28-oz-90507": "science-diet-adult-perfect-weight-salmon-veg-stew-pouch",
    "sensitive-stomach-and-skin-adult-wet-dog-food-topper---turkey-and-vegetables-28-oz-90506": "science-diet-adult-sensitive-stomach-skin-turkey-stew-pouch",
    # ── DRY FOOD ──
    # 7+ / Senior / 11+
    "7-senior-dry-dog-food---chicken-barley-and-brown-rice-650": "science-diet-mature-adult-dry",
    "7-senior-dry-dog-food---chicken-barley-and-brown-rice-90027": "science-diet-mature-adult-dry",
    "small-and-mini-11-senior-dry-dog-food---chicken-and-brown-rice-18756": "science-diet-senior-11-small-paws-dry",
    "small-and-mini-11-senior-dry-dog-food---chicken-and-brown-rice-90485": "science-diet-senior-11-small-paws-dry",
    "small-and-mini-7-senior-dry-dog-food---chicken-and-brown-rice-655": "science-diet-mature-adult-small-paws-breed-dry",
    "small-and-mini-7-senior-dry-dog-food---chicken-and-brown-rice-90015": "science-diet-mature-adult-small-paws-breed-dry",
    "small-bites-7-senior-dry-dog-food---chicken-recipe-628": "science-diet-mature-adult-small-bites-dry",
    "small-bites-7-senior-dry-dog-food---chicken-recipe-90016": "science-diet-mature-adult-small-bites-dry",
    "large-breed-6-senior-dry-dog-food---chicken-recipe-90953": "science-diet-mature-adult-dry",
    # Adult standard
    "adult-dog-dry-food---salmon-and-brown-rice-recipe-82339": "science-diet-adult-salmon-brown-rice-dry",
    "adult-dog-dry-food---salmon-and-brown-rice-recipe-90469": "science-diet-adult-salmon-brown-rice-dry",
    "adult-dry-dog-food---chicken-and-barley-644": "science-diet-adult-original-dry",
    "adult-dry-dog-food---chicken-and-barley-90020": "science-diet-adult-original-dry",
    "adult-dry-dog-food---lamb-and-brown-rice-649": "science-diet-adult-lamb-rice-dry",
    "adult-dry-dog-food---lamb-and-brown-rice-90025": "science-diet-adult-lamb-rice-dry",
    "small-and-mini-adult-dry-dog-food---chicken-and-brown-rice-90471": "science-diet-adult-small-paws-breed-dry",
    "small-and-mini-adult-dry-dog-food---lamb-meal-and-brown-rice-90487": "science-diet-adult-small-paws-lamb-rice-dry",
    # Health Mobility
    "health-mobility-adult-dog-food-3380": "science-diet-adult-healthy-mobility-dry",
    "healthy-mobility-large-breed-adult-dry-dog-food---chicken-meal-rice-and-barley-651": "science-diet-adult-healthy-mobility-large-breed-dry",
    # Large Breed
    "large-breed-adult-dry-dog-food---chicken-and-barley-90023": "science-diet-adult-large-breed-dry",
    "large-breed-adult-dry-dog-food---lamb-and-brown-rice-90024": "science-diet-adult-lamb-rice-large-breed-dry",
    "large-breed-puppy-dry-dog-food---chicken-and-oat-90470": "science-diet-puppy-large-breed-dry",
    "large-breed-puppy-dry-dog-food---lamb-and-brown-rice-90472": "science-diet-puppy-lamb-rice-large-breed-dry",
    # Light
    "light-adult-dry-dog-food---chicken-and-barley-53091": "science-diet-adult-light-dry",
    "light-adult-dry-dog-food---chicken-and-barley-90022": "science-diet-adult-light-dry",
    "light-large-breed-adult-dry-dog-food---chicken-and-barley-53092": "science-diet-adult-light-large-breed-dry",
    "light-large-breed-adult-dry-dog-food---chicken-and-barley-90021": "science-diet-adult-light-large-breed-dry",
    "light-small-breed-adult-dry-dog-food---chicken-meal-and-barley-668": "science-diet-adult-light-small-paws-breed-dry",
    # Oral Care
    "oral-care-adult-dry-dog-food---chicken-brown-rice-and-barley-658": "science-diet-adult-oral-care-dry",
    "oral-care-adult-dry-dog-food---chicken-brown-rice-and-barley-90468": "science-diet-adult-oral-care-dry",
    "oral-care-adult-dry-dog-food---chicken-brown-rice-and-barley-90488": "science-diet-adult-oral-care-dry",
    "oral-care-small-and-mini-adult-dog-dry-food---chicken-rice-and-barley-76207": "science-diet-oral-adult-oral-care-small-mini-dry",
    # Perfect Digestion dry
    "perfect-digestion-7-senior-dry-dog-food---chicken-whole-oats-and-brown-rice-61512": "science-diet-mature-adult-7-perfect-digestion-dry",
    "perfect-digestion-7-senior-dry-dog-food---small-bites-chicken-61786": "science-diet-mature-adult-7-perfect-digestion-small-bites-dry",
    "perfect-digestion-adult-dry-dog-food---chicken-and-brown-rice-59971": "science-diet-adult-perfect-digestion-chicken-rice-oats-dry",
    "perfect-digestion-adult-dry-dog-food---salmon-brown-rice-and-whole-oats-61516": "science-diet-adult-perfect-digestion-salmon-oats-rice-dry",
    "perfect-digestion-large-breed-adult-dry-dog-food---chicken-and-brown-rice-61514": "science-diet-adult-perfect-digestion-large-breed-dry",
    "perfect-digestion-small-and-mini-adult-dog-dry-food---chicken-and-brown-rice-recipe-82349": "science-diet-adult-perfect-digestion-small-mini-chicken-brown-rice-dry",
    "perfect-digestion-small-bites-adult-dry-dog-food---chicken-whole-oats-and-rice-61773": "science-diet-adult-perfect-digestion-small-bites-dry",
    # Perfect Weight dry
    "perfect-weight-adult-dry-dog-food---chicken-21059": "science-diet-adult-perfect-weight-dry",
    "perfect-weight-and-joint-support-adult-dry-dog-food---chicken-and-brown-rice-76218": "science-diet-adult-perfect-weight-joint-support-dry",
    "perfect-weight-and-joint-support-large-breed-adult-dry-dog-food---chicken-and-rice-76219": "science-diet-adult-perfect-weight-joint-support-large-breed-dry",
    "perfect-weight-large-breed-adult-dry-dog-food---chicken-57936": "science-diet-adult-perfect-weight-large-breed-dry",
    # Senior Vitality dry
    "senior-vitality-adult-7-dry-dog-food---chicken-and-rice-43163": "science-diet-adult-7-senior-vitality-chicken-rice-dry",
    "senior-vitality-small-and-mini-7-senior-dry-dog-food---chicken-and-rice-90480": "science-diet-adult-7-senior-vitality-small-paws-chicken-rice-dry",
    "senior-vitality-small-and-mini-adult-7-dry-dog-food---chicken-and-rice-43162": "science-diet-adult-7-senior-vitality-small-paws-chicken-rice-dry",
    # Sensitive Stomach & Skin dry
    "sensitive-stomach-and-skin-adult-dry-dog-food---alaskan-pollock-76217": "science-diet-adult-sensitive-stomach-skin-pollock-insect-dry",
    "sensitive-stomach-and-skin-adult-dry-dog-food---alaskan-pollock-90478": "science-diet-adult-sensitive-stomach-skin-pollock-insect-dry",
    "sensitive-stomach-and-skin-adult-dry-dog-food---chicken-and-barley-570": "science-diet-adult-sensitive-stomach-skin-dry",
    "sensitive-stomach-and-skin-adult-dry-dog-food---chicken-and-barley-90474": "science-diet-adult-sensitive-stomach-skin-dry",
    "sensitive-stomach-and-skin-adult-dry-dog-food---grain-free-chicken-and-potato-52376": "science-diet-adult-grain-free-dry",
    "sensitive-stomach-and-skin-large-breed-adult-dry-dog-food---chicken-and-barley-57937": "science-diet-adult-sensitive-stomach-skin-large-breed-dry",
    "sensitive-stomach-and-skin-puppy-dry-dog-food---salmon-and-brown-rice-82342": "science-diet-puppy-sensitive-stomach-skin-salmon-brown-rice-dry",
    "sensitive-stomach-and-skin-puppy-dry-dog-food---salmon-and-brown-rice-90475": "science-diet-puppy-sensitive-stomach-skin-salmon-brown-rice-dry",
    "sensitive-stomach-and-skin-small-and-mini-adult-dog-dry-food---chicken-and-rice-34696": "science-diet-adult-sensitive-stomach-skin-small-bites-dry",
    # Puppy dry
    "puppy-dry-dog-food---chicken-and-brown-rice-626": "science-diet-puppy-original-dry",
    "puppy-dry-dog-food---lamb-meal-and-brown-rice-76215": "science-diet-puppy-lamb-meal-rice-dry",
    "small-and-mini-puppy-dry-dog-food---chicken-and-brown-rice-618": "science-diet-puppy-small-paws-breed-dry",
    "small-and-mini-puppy-dry-dog-food---chicken-and-brown-rice-90473": "science-diet-puppy-small-paws-breed-dry",
    # ── TREATS ──
    "soft-baked-dog-treat---natural-grain-free-beef-and-sweet-potato-18789": "hills-grain-free-soft-baked-naturals-beef-sweet-potatoes-adult-treats",
    "soft-baked-dog-treat---natural-grain-free-duck-and-pumpkin-66467": "hills-grain-free-soft-baked-naturals-duck-pumpkin-adult-treats",
    "soft-baked-naturals-dog-treat---grain-free-chicken-and-carrots-59942": "hills-grain-free-soft-baked-naturals-chicken-carrots-adult-treats",
    "jerky-strips-dog-treat---71-oz-2609": "hills-natural-jerky-strips-real-beef-adult-treats",
    "mini-jerky-strips-dog-treat---71-oz-2636": "hills-natural-jerky-mini-strips-real-beef-adult-treats",
    "flexi-stix-jerky-dog-treat---natural-beef-31421": "hills-natural-flexi-stix-beef-jerky-adult-treats",
    "flexi-stix-jerky-dog-treat---natural-turkey-30860": "hills-natural-flexi-stix-turkey-jerky-adult-treats",
    "soft-savories-dog-treat---natural-peanut-butter-and-banana-66469": "hills-natural-soft-savories-peanut-butter-banana-adult-treats",
    "soft-and-chewy-training-treats---chicken-78336": "hills-natural-trainings-soft-and-chewy-real-chicken-adult-treats",
}


def _supplement_from_hills_ca(products: list[Product]) -> int:
    """Fill missing GA/calories/ingredients from hillspet.ca for retail products.

    Uses explicit _PETSMART_TO_HILLS_CA mapping to find the corresponding
    Hill's CA product page. GA from Hill's is dry-matter basis.

    Returns number of products supplemented.
    """
    from .hills_common import (
        parse_calorie_content as _parse_calorie_content,
        parse_ga as _parse_ga,
        parse_ingredients as _parse_ingredients,
    )

    needs_supplement = [
        p for p in products
        if not p.get("guaranteed_analysis") or not p.get("calorie_content")
    ]
    if not needs_supplement:
        return 0

    logger.info(f"  Hill's CA: checking {len(needs_supplement)} products with missing data...")
    supplemented = 0

    with SyncSession(rate_limit=1.0) as session:
        for product in needs_supplement:
            ps_url = product.get("url", "")

            # Find matching Hill's CA URL from explicit map
            hills_slug = None
            for ps_pattern, slug in _PETSMART_TO_HILLS_CA.items():
                if ps_pattern in ps_url:
                    hills_slug = slug
                    break

            if not hills_slug:
                logger.warning(f"  Hill's CA: no mapping for {product['name'][:60]}")
                continue

            hills_url = HILLS_CA_BASE + hills_slug
            resp = session.get(hills_url)
            if not resp.ok:
                logger.warning(f"  Hill's CA: {resp.status_code} for {hills_slug}")
                continue

            soup = BeautifulSoup(resp.text, "lxml")
            filled = False

            if not product.get("guaranteed_analysis"):
                ga = _parse_ga(soup)
                if ga:
                    product["guaranteed_analysis"] = ga
                    product["guaranteed_analysis_basis"] = "dry-matter"
                    filled = True
                    logger.info(f"  Hill's CA: GA (DMB) for {product['name'][:50]}")

            if not product.get("calorie_content"):
                cal = _parse_calorie_content(soup)
                if cal:
                    product["calorie_content"] = cal
                    filled = True
                    logger.info(f"  Hill's CA: calories for {product['name'][:50]}")

            if not product.get("ingredients_raw"):
                ing = _parse_ingredients(soup)
                if ing:
                    product["ingredients_raw"] = ing
                    filled = True
                    logger.info(f"  Hill's CA: ingredients for {product['name'][:50]}")

            if filled:
                supplemented += 1

    # Apply manual fallback data for products still missing after Hill's CA
    manual_filled = 0
    for product in products:
        if product.get("guaranteed_analysis") and product.get("calorie_content"):
            continue
        ps_url = product.get("url", "")
        for ps_pattern, fields in _MANUAL_PRODUCT_DATA.items():
            if ps_pattern in ps_url:
                filled = False
                if fields.get("guaranteed_analysis") and not product.get("guaranteed_analysis"):
                    product["guaranteed_analysis"] = fields["guaranteed_analysis"]
                    product["guaranteed_analysis_basis"] = fields.get(
                        "guaranteed_analysis_basis", "as-fed"
                    )
                    filled = True
                if fields.get("calorie_content") and not product.get("calorie_content"):
                    product["calorie_content"] = fields["calorie_content"]
                    filled = True
                if filled:
                    supplemented += 1
                    manual_filled += 1
                    logger.info(f"  Manual: filled {product['name'][:50]}")
                break
    if manual_filled:
        logger.info(f"  Manual fallback filled {manual_filled} products")

    if supplemented:
        logger.info(f"  Total supplemented: {supplemented} products")
    return supplemented


def scrape_hills_retail(output_dir: Path) -> int:
    """Scrape Hill's Science Diet (retail) products from PetSmart. Returns product count."""
    count = scrape_petsmart_brand(
        output_dir,
        brand_name="Hill's",
        slug="hills_retail",
        brand_slug="hills-science-diet",
        brand_pattern=r"Hill(?:'|&#x27;|')?s",
        detect_sub_brand=lambda name: "Science Diet",
    )

    # Supplement missing GA/calories from hillspet.ca
    json_path = output_dir / "hills_retail.json"
    if json_path.exists():
        data = json.loads(json_path.read_text())
        products = data["products"]

        supplemented = _supplement_from_hills_ca(products)

        if supplemented:
            has_ga = sum(1 for p in products if p.get("guaranteed_analysis"))
            has_cal = sum(1 for p in products if p.get("calorie_content"))
            logger.info(
                f"  After Hill's CA: {has_ga}/{len(products)} GA, "
                f"{has_cal}/{len(products)} calories"
            )
            data["products"] = products
            json_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))

    return count
