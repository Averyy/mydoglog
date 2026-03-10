"""Kirkland Signature (Costco) dog food scraper.

Strategy:
1. Hardcoded CA product catalog (costco.ca is a JS SPA, can't scrape dynamically)
2. Fetch matching US (costco.com) product pages for ingredients/GA/calories
3. Manual nutrition overrides for products where US page lacks data (e.g. Biscuits)
4. Flag any remaining products for manual review

Note: US has repackaged from 35lb→25lb bags but ingredients are identical to CA.
Each country uses different item numbers, so US URLs are manually verified matches.
"""

import logging
import re
from pathlib import Path
from typing import TypedDict

from bs4 import BeautifulSoup
from wafer import SyncSession

from .common import (
    GuaranteedAnalysis,
    Product,
    clean_text,
    normalize_calorie_content,
    write_brand_json,
)

logger = logging.getLogger(__name__)

BRAND = "Kirkland Signature"
WEBSITE_URL = "https://www.costco.ca"

# Costco Brandfolder CDN base for product images
_IMG_BASE = "https://bfasset.costco-static.com/U447IH35/as"


class CatalogEntry(TypedDict, total=False):
    name: str
    ca_url: str
    ca_sku: str
    image_url: str
    product_type: str  # "food" or "treat"
    product_format: str  # "dry" or "wet"
    life_stage: str
    sub_brand: str  # "" or "Nature's Domain"


# ---------------------------------------------------------------------------
# CA product catalog — source of truth for what Costco Canada sells.
# Variety packs excluded per project rules.
# ---------------------------------------------------------------------------
CATALOG: list[CatalogEntry] = [
    {
        "name": "Kirkland Signature Chicken, Rice & Vegetables Adult Dog Food",
        "ca_url": "https://www.costco.ca/kirkland-signature-chicken%2c-rice-%2526-vegetables-adult-dog-food%2c-18.14-kg-40-lb..product.100380650.html",
        "ca_sku": "29506",
        "image_url": f"{_IMG_BASE}/3ssr354tf8c82rt44wrm5/29506-894__1?auto=webp&format=jpg&width=800",
        "product_type": "food",
        "product_format": "dry",
        "life_stage": "adult",
        "sub_brand": "",
    },
    {
        "name": "Kirkland Signature Lamb, Rice & Vegetables Adult Dog Food",
        "ca_url": "https://www.costco.ca/kirkland-signature-lamb%2c-rice-%2526-vegetables-adult-dog-food%2c-18.14-kg-40-lb..product.100380667.html",
        "ca_sku": "29504",
        "image_url": f"{_IMG_BASE}/qc27gpbj2cjs5p8b765jwk3/29504-894__1?auto=webp&format=jpg&width=800",
        "product_type": "food",
        "product_format": "dry",
        "life_stage": "adult",
        "sub_brand": "",
    },
    {
        "name": "Kirkland Signature Chicken, Rice and Egg Mature Dog Food",
        "ca_url": "https://www.costco.ca/kirkland-signature-chicken%2c-rice-and-egg-mature-dog-food%2c-18.1-kg-40-lb..product.100466284.html",
        "ca_sku": "779829",
        "image_url": f"{_IMG_BASE}/k4bvnkk8kxn4kstw58gx2zvv/779829-894__1?auto=webp&format=jpg&width=800",
        "product_type": "food",
        "product_format": "dry",
        "life_stage": "senior",
        "sub_brand": "",
    },
    {
        "name": "Kirkland Signature Healthy Weight Dog Food",
        "ca_url": "https://www.costco.ca/kirkland-signature-healthy-weight-dog-food%2c-18.14-kg-40-lb..product.100380664.html",
        "ca_sku": "430541",
        "image_url": f"{_IMG_BASE}/9wk7b9fw7vqr3jrwrzhg/430541-894__1?auto=webp&format=jpg&width=800",
        "product_type": "food",
        "product_format": "dry",
        "life_stage": "adult",
        "sub_brand": "",
    },
    {
        "name": "Kirkland Signature Nature's Domain Salmon & Sweet Potato Dog Food",
        "ca_url": "https://www.costco.ca/kirkland-signature-nature%e2%80%99s-domain-salmon-%2526-sweet-potato-dog-food%2c-15.87-kg-35-lb.product.100380665.html",
        "ca_sku": "295700",
        "image_url": f"{_IMG_BASE}/bptc2hv9tqsw6wfwp4sn44t/295700-894__1?auto=webp&format=jpg&width=800",
        "product_type": "food",
        "product_format": "dry",
        "life_stage": "all",
        "sub_brand": "Nature's Domain",
    },
    {
        "name": "Kirkland Signature Nature's Domain Turkey & Ancient Grains Dog Food",
        "ca_url": "https://www.costco.ca/kirkland-signature-nature%e2%80%99s-domain-turkey-%2526-ancient-grains-formula%2c-food-for-dogs%2c-15.87-kg-35-lb..product.4000175612.html",
        "ca_sku": "1538725",
        "image_url": f"{_IMG_BASE}/v9cxrg5b7wrfgzrcnqs7gnbg/1538725-894__1?auto=webp&format=jpg&width=800",
        "product_type": "food",
        "product_format": "dry",
        "life_stage": "all",
        "sub_brand": "Nature's Domain",
    },
    {
        "name": "Kirkland Signature Nature's Domain Puppy Chicken & Pea Dog Food",
        "ca_url": "https://www.costco.ca/kirkland-signature-nature%e2%80%99s-domain-puppy-chicken-%2526-pea-formula%2c-food-for-dogs%2c-9.07-kg-19.9-lb..product.4000135745.html",
        "ca_sku": "1101794",
        "image_url": f"{_IMG_BASE}/374xpf3k2tqx9cctc4kj69c7/1101794-894__1?auto=webp&format=jpg&width=800",
        "product_type": "food",
        "product_format": "dry",
        "life_stage": "puppy",
        "sub_brand": "Nature's Domain",
    },
    {
        "name": "Kirkland Signature Nature's Domain Small Breed Salmon & Lentils Dog Food",
        "ca_url": "https://www.costco.ca/kirkland-signature-nature%e2%80%99s-domain-small-dog-breed-salmon-%2526-lentils-formula%2c-9.07-kg-19.9-lb..product.4000135778.html",
        "ca_sku": "1193179",
        "image_url": f"{_IMG_BASE}/pk6mhpqrrjv7bmws9b265kng/1193179-847__1?auto=webp&format=jpg&width=800",
        "product_type": "food",
        "product_format": "dry",
        "life_stage": "adult",
        "sub_brand": "Nature's Domain",
    },
    {
        "name": "Kirkland Signature Dental Chews Dog Treats",
        "ca_url": "https://www.costco.ca/kirkland-signature-dental-chews-dog-treats%2c-72-count-1.9-kg.product.100504435.html",
        "ca_sku": "971832",
        "image_url": f"{_IMG_BASE}/kb8w78pgs9gz7xqhwvx849tt/971832-847__1?auto=webp&format=jpg&width=800",
        "product_type": "treat",
        "product_format": "dry",
        "life_stage": "adult",
        "sub_brand": "",
    },
    {
        "name": "Kirkland Signature Chicken Meal & Rice Formula Dog Biscuits",
        "ca_url": "https://www.costco.ca/kirkland-signature-chicken-meal-%2526-rice-formula-dog-biscuits.product.100479891.html",
        "ca_sku": "1104304",
        "image_url": f"{_IMG_BASE}/kp9gpcnz5p8z4jnhjs7g3kwt/1104304-894__1?auto=webp&format=jpg&width=800",
        "product_type": "treat",
        "product_format": "dry",
        "life_stage": "adult",
        "sub_brand": "",
    },
]

# ---------------------------------------------------------------------------
# US product page URLs keyed by CA SKU.
# Costco uses different item numbers per country for the same products, so
# these are manually verified matches (not same-SKU lookups).
# ---------------------------------------------------------------------------
_US_URLS: dict[str, str] = {
    # All CA products mapped to their US equivalents. Ingredients verified identical
    # across US/AU/CA — the US "reformulation" (35lb→25lb) is repackaging only.
    # US pages have full nutrition data (ingredients, GA, calories).
    "29506": "https://www.costco.com/p/-/kirkland-signature-adult-formula-chicken-rice-and-vegetable-dog-food-25-lbs/4000399008",
    "29504": "https://www.costco.com/p/-/kirkland-signature-adult-formula-lamb-rice-and-vegetable-dog-food-25-lbs/4000398961",
    "779829": "https://www.costco.com/p/-/kirkland-signature-mature-formula-chicken-rice-and-egg-dog-food-25-lbs/4000398982",
    "430541": "https://www.costco.com/p/-/kirkland-signature-healthy-weight-formula-chicken-and-vegetable-dog-food-25-lbs/4000398981",
    "295700": "https://www.costco.com/p/-/kirkland-signature-natures-domain-salmon-and-sweet-potato-formula-dog-food-25-lbs/4000399020",
    "1538725": "https://www.costco.com/p/-/kirkland-signature-natures-domain-turkey-and-ancient-grains-dog-food-25-lbs/4000399034",
    "1101794": "https://www.costco.com/p/-/kirkland-signature-natures-domain-puppy-formula-chicken-pea-dog-food-20-lb/100354281",
    "1193179": "https://www.costco.com/p/-/kirkland-signature-natures-domain-small-breed-salmon-lentil-20-lbs/100415351",
    "971832": "https://www.costco.com/p/-/kirkland-signature-dental-chews-72-count/100234581",
    # 1104304 (Biscuits) exists on US but has no nutrition data — uses manual entry
}

# ---------------------------------------------------------------------------
# Manual nutrition data for products with no online source.
# Biscuit data transcribed from packaging photo.
# ---------------------------------------------------------------------------
_MANUAL_NUTRITION: dict[str, dict] = {
    "971832": {
        # Dental Chews — US page has GA but no calories. Calorie data from CA packaging.
        "calorie_content": "3235 kcal/kg, 91 kcal/chew",
    },
    "1104304": {
        "ingredients_raw": "Whole Wheat Flour, Chicken Meal, Brewers Rice, Brewers Dried Yeast, Beet Pulp, Chicken Fat, Vitamin Mix (Pea Fibre, Calcium Carbonate, Vitamin E Supplement, Niacin Supplement, D-Calcium Pantothenate, Riboflavin Supplement, Vitamin A Supplement, Thiamine Mononitrate, Pyridoxine Hydrochloride, Vitamin B12 Supplement, Vitamin D3 Supplement, Folic Acid), Ground Limestone, Potassium Chloride, Choline Chloride, DL-Methionine, Mineral Mix (Ferrous Sulfate, Zinc Proteinate, Zinc Sulfate, Iron Proteinate, Copper Sulfate, Potassium Chloride, Sodium Selenite, Copper Proteinate, Manganese Sulfate, Manganese Proteinate, Mineral Oil, Calcium Iodate), Glucosamine Hydrochloride, Chondroitin Sulfate.",
        "guaranteed_analysis": {
            "crude_protein_min": 23.0,
            "crude_fat_min": 4.5,
            "crude_fiber_max": 3.5,
            "moisture_max": 11.0,
            "calcium_min": 1.3,
            "phosphorus_min": 1.0,
            "glucosamine_min": 375.0,
            "chondroitin_min": 35.0,
        },
        "calorie_content": "3201 kcal/kg, 104 kcal/treat",
    },
}


# ---------------------------------------------------------------------------
# GA field mapping for Costco's text format
# ---------------------------------------------------------------------------
_GA_LABEL_MAP: dict[str, str] = {
    "crude protein": "crude_protein",
    "crude fat": "crude_fat",
    "crude fiber": "crude_fiber",
    "crude fibre": "crude_fiber",
    "moisture": "moisture",
    "calcium": "calcium",
    "phosphorus": "phosphorus",
    "omega-6 fatty acids": "omega_6",
    "omega-3 fatty acids": "omega_3",
    "glucosamine": "glucosamine",
    "chondroitin sulfate": "chondroitin",
    "chondroitin": "chondroitin",
    "l-carnitine": "l_carnitine",
    "taurine": "taurine",
    "dha": "dha",
    "dha (docosahexaenoic acid)": "dha",
    "docosahexaenoic acid (dha)": "dha",
    "docosahexaenoic acid": "dha",
}

_MAX_BY_DEFAULT = {"crude_fiber", "moisture", "ash"}

# Fields stored in mg/kg (not percentages)
_MG_KG_FIELDS = {"glucosamine", "chondroitin", "l_carnitine"}


def _parse_ga_line(line: str) -> tuple[str, float] | None:
    """Parse a single GA line like 'Crude Protein 26% Minimum'.

    Returns (field_name_with_suffix, value) or None.
    """
    line = line.strip()
    lower = line.lower()

    # Skip non-GA lines
    if "microorganism" in lower or "cfu" in lower:
        return None
    if lower.startswith("("):
        return None

    is_max = "maximum" in lower or "max" in lower.split()
    is_min = "minimum" in lower or "min" in lower.split()
    is_mg_kg = "mg/kg" in lower

    # Extract numeric value
    num_match = re.search(r"([\d,]+\.?\d*)\s*(?:%|mg)", line)
    if not num_match:
        num_match = re.search(r"([\d,]+\.?\d*)", line)
    if not num_match:
        return None

    value = float(num_match.group(1).replace(",", ""))

    # Extract label by splitting on the first numeric GA value
    label = re.split(r"\s+[\d,]+\.?\d*\s*(?:%|mg|iu)", lower)[0]
    label = re.sub(r"\b(?:minimum|maximum|min|max|not less than)\b", "", label)
    label = label.strip(" .*")

    field_base = None
    for known_label, field in _GA_LABEL_MAP.items():
        if known_label in label or label in known_label:
            field_base = field
            break

    if not field_base:
        return None

    if is_max:
        suffix = "_max"
    elif is_min:
        suffix = "_min"
    elif field_base in _MAX_BY_DEFAULT:
        suffix = "_max"
    else:
        suffix = "_min"

    if is_mg_kg and field_base not in _MG_KG_FIELDS:
        value = round(value / 10000, 4)

    return (f"{field_base}{suffix}", value)


def _parse_ga_semicolons(text: str) -> GuaranteedAnalysis:
    """Parse GA from semicolon-separated format (used by Dental Chews)."""
    ga: dict[str, float] = {}
    for part in text.split(";"):
        part = part.strip()
        if not part:
            continue
        cleaned = (
            part.replace("(Min)", "Minimum")
            .replace("(Max)", "Maximum")
            .replace("(min)", "Minimum")
            .replace("(max)", "Maximum")
        )
        result = _parse_ga_line(cleaned)
        if result:
            field, value = result
            ga[field] = value
    return ga  # type: ignore[return-value]


def _parse_us_product_page(html: str) -> dict:
    """Parse nutrition data from a costco.com product detail page.

    Returns dict with keys: ingredients_raw, guaranteed_analysis,
    calorie_content (each None if not found).
    """
    soup = BeautifulSoup(html, "lxml")
    result: dict = {
        "ingredients_raw": None,
        "guaranteed_analysis": None,
        "calorie_content": None,
    }

    body_text = soup.get_text(separator="\n")
    # Collapse empty lines for easier regex matching
    body_text = re.sub(r"\n[ \t]*\n", "\n", body_text)

    # --- Ingredients ---
    ing_match = re.search(
        r"Ingredients\s*:?\s*\n(.*?)(?:\n\*|Guaranteed Analysis)",
        body_text,
        re.DOTALL | re.IGNORECASE,
    )
    if ing_match:
        raw = ing_match.group(1).strip()
        raw = re.sub(r"\s*\n\s*", " ", raw)
        result["ingredients_raw"] = clean_text(raw)

    # --- Guaranteed Analysis ---
    ga_match = re.search(
        r"Guaranteed Analysis\s*:?\s*\n(.*?)(?:Calorie Content|Feeding|Changing your|AAFCO)",
        body_text,
        re.DOTALL | re.IGNORECASE,
    )
    if ga_match:
        ga_text = ga_match.group(1).strip()

        if ";" in ga_text and "%" in ga_text:
            ga = _parse_ga_semicolons(ga_text)
        else:
            ga: dict[str, float] = {}
            for ga_line in ga_text.split("\n"):
                ga_line = ga_line.strip().lstrip("-•● ")
                if not ga_line:
                    continue
                parsed = _parse_ga_line(ga_line)
                if parsed:
                    field, value = parsed
                    ga[field] = value

        if ga:
            result["guaranteed_analysis"] = ga

    # --- Calorie Content ---
    cal_match = re.search(
        r"Calorie Content\s*:?\s*\n(.*?)(?:Changing|Feeding|AAFCO|Specifications)",
        body_text,
        re.DOTALL | re.IGNORECASE,
    )
    if cal_match:
        cal_text = cal_match.group(1).strip()
        cal_line = cal_text.split("\n")[0].strip().lstrip("-•● ")
        normalized = normalize_calorie_content(cal_line)
        if normalized:
            result["calorie_content"] = normalized

    return result


def scrape_kirkland(output_dir: Path) -> int:
    """Scrape Kirkland Signature dog food products.

    Uses CA catalog as source of truth. Backfills nutrition from:
    1. Manual data overrides (packaging photos)
    2. US (costco.com) — ingredients, GA, and calories
    3. Flags remaining products for manual review
    """
    session = SyncSession(rate_limit=2.0)
    products: list[Product] = []
    flagged: list[str] = []

    for entry in CATALOG:
        sku = entry["ca_sku"]
        logger.info(f"Processing: {entry['name']} (SKU {sku})")

        nutrition: dict = {
            "ingredients_raw": None,
            "guaranteed_analysis": None,
            "calorie_content": None,
        }

        source = "none"

        # 1. Try US page first
        if sku in _US_URLS:
            us_url = _US_URLS[sku]
            try:
                resp = session.get(us_url)
                if resp.ok:
                    nutrition = _parse_us_product_page(resp.text)
                    if nutrition["ingredients_raw"]:
                        source = "us"
                    else:
                        logger.warning(f"  → US page returned no ingredients: {us_url}")
                else:
                    logger.warning(f"  → US page returned {resp.status_code}: {us_url}")
            except Exception as e:
                logger.error(f"  → US fetch failed: {e}")

        # 2. Apply manual overrides (fill missing or correct bad data)
        if sku in _MANUAL_NUTRITION:
            manual = _MANUAL_NUTRITION[sku]
            for key in ("ingredients_raw", "guaranteed_analysis", "calorie_content"):
                if manual.get(key):
                    nutrition[key] = manual[key]
                    logger.info(f"  → applied manual {key}")
            if source == "none":
                source = "manual"

        # 3. Flag for manual review if no nutrition data
        if source == "none":
            flagged.append(f"{entry['name']} (SKU {sku})")
            logger.warning(f"  → FLAGGED: no same-SKU match on US or AU — needs manual review")

        # Build product
        product: Product = {
            "name": entry["name"],
            "brand": BRAND,
            "url": entry["ca_url"],
            "channel": "retail",
            "product_type": entry["product_type"],
            "product_format": entry["product_format"],
            "life_stage": entry["life_stage"],
            "images": [entry["image_url"]],
        }

        if entry.get("sub_brand"):
            product["sub_brand"] = entry["sub_brand"]

        if nutrition["ingredients_raw"]:
            product["ingredients_raw"] = nutrition["ingredients_raw"]
        if nutrition["guaranteed_analysis"]:
            product["guaranteed_analysis"] = nutrition["guaranteed_analysis"]
            product["guaranteed_analysis_basis"] = "as-fed"
        if nutrition["calorie_content"]:
            product["calorie_content"] = nutrition["calorie_content"]

        products.append(product)
        logger.info(
            f"  → source={source}, "
            f"ingredients={'yes' if nutrition['ingredients_raw'] else 'no'}, "
            f"GA={'yes' if nutrition['guaranteed_analysis'] else 'no'}, "
            f"calories={'yes' if nutrition['calorie_content'] else 'no'}"
        )

    # Summary
    if flagged:
        logger.warning(
            f"\n{'='*60}\n"
            f"MANUAL REVIEW NEEDED — {len(flagged)} products without nutrition data:\n"
            + "\n".join(f"  - {name}" for name in flagged)
            + f"\n{'='*60}"
        )

    write_brand_json(BRAND, WEBSITE_URL, products, output_dir, slug="kirkland")
    return len(products)
