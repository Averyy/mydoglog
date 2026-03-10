"""Eukanuba scraper (via PetSmart.ca).

Manufacturer site (eukanuba.com/ca) has ingredients/GA in HTML, but PetSmart
provides consistent RSC format. Uses search discovery (no featured-brands page).
~8 dog products.

Note: PetSmart mislabels fiber/moisture as (min.) for the Lamb & Rice wet food.
Manual override with correct data from eukanuba.com/ca.
"""

import logging
from pathlib import Path

from .petsmart import scrape_petsmart_brand

logger = logging.getLogger(__name__)

# PetSmart has wrong min/max labels and missing kcal/kg for this product.
# Corrected from eukanuba.com/ca (Mar 2026).
_MANUAL_PRODUCT_DATA: dict[str, dict] = {
    "41718.html": {
        # Lamb & Rice Loaf in Gravy — PetSmart says (min.) for fiber/moisture
        "guaranteed_analysis": {
            "crude_protein_min": 8.0,
            "crude_fat_min": 4.0,
            "crude_fiber_max": 1.5,
            "moisture_max": 78.0,
        },
        "guaranteed_analysis_basis": "as-fed",
        "calorie_content": "1086 kcal/kg, 407 kcal/can",
    },
}


def scrape_eukanuba(output_dir: Path) -> int:
    """Scrape all Eukanuba dog products from PetSmart. Returns product count."""
    return scrape_petsmart_brand(
        output_dir,
        brand_name="Eukanuba",
        slug="eukanuba",
        brand_slug=None,
        search_query="Eukanuba",
        manual_product_data=_MANUAL_PRODUCT_DATA,
    )
