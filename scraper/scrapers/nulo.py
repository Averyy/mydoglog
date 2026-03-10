"""Nulo scraper (via PetSmart.ca).

Manufacturer site (nulo.com) is Shopify with ~328 products, but PetSmart has
the Canadian subset with RSC data. ~33 dog products.

Note: PetSmart RSC is missing GA for 2 Baked & Coated Large Breed products
and calories for 1 Grain-Free Large Breed product — data sourced from nulo.com.
"""

import logging
from pathlib import Path

from .petsmart import scrape_petsmart_brand

logger = logging.getLogger(__name__)

# PetSmart RSC is missing data for these products.
# Sourced from nulo.com product pages (Mar 2026).
_MANUAL_PRODUCT_DATA: dict[str, dict] = {
    "77478.html": {
        # Baked & Coated Large Breed Chicken, Turkey & Duck — missing GA
        "guaranteed_analysis": {
            "crude_protein_min": 30.0,
            "crude_fat_min": 15.0,
            "crude_fiber_max": 4.5,
            "moisture_max": 10.0,
            "calcium_min": 1.0,
            "phosphorus_min": 0.9,
            "taurine_min": 0.1,
            "omega_6_min": 3.25,
            "omega_3_min": 0.5,
        },
        "guaranteed_analysis_basis": "as-fed",
        "calorie_content": "3550 kcal/kg, 419 kcal/cup",
    },
    "77479.html": {
        # Baked & Coated Large Breed Whitefish, Chicken & Turkey — missing GA
        "guaranteed_analysis": {
            "crude_protein_min": 30.0,
            "crude_fat_min": 14.0,
            "crude_fiber_max": 4.5,
            "moisture_max": 10.0,
            "calcium_min": 1.0,
            "phosphorus_min": 0.9,
            "taurine_min": 0.1,
            "omega_6_min": 3.25,
            "omega_3_min": 0.5,
        },
        "guaranteed_analysis_basis": "as-fed",
        "calorie_content": "3550 kcal/kg, 419 kcal/cup",
    },
    "22920.html": {
        # Large Breed Grain-Free Turkey & Peas — missing calories
        "calorie_content": "3523 kcal/kg, 416 kcal/cup",
    },
}


def _detect_sub_brand(name: str) -> str | None:
    """Detect Nulo sub-brand from product name."""
    name_lower = name.lower()
    if "freestyle" in name_lower:
        return "FreeStyle"
    if "frontrunner" in name_lower:
        return "FrontRunner"
    if "medalser" in name_lower or "medal series" in name_lower:
        return "MedalSeries"
    return None


def scrape_nulo(output_dir: Path) -> int:
    """Scrape all Nulo dog products from PetSmart. Returns product count."""
    return scrape_petsmart_brand(
        output_dir,
        brand_name="Nulo",
        slug="nulo",
        brand_slug="nulo",
        detect_sub_brand=_detect_sub_brand,
        manual_product_data=_MANUAL_PRODUCT_DATA,
    )
