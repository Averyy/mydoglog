"""Canidae scraper (via PetSmart.ca).

Manufacturer site (canidae.com) uses BigCommerce with Vue.js client-side rendering —
ingredients/GA load via JavaScript, not in initial HTML. Not on Chewy CA.
PetSmart is the only viable source. ~17 dog products.

Note: PetSmart RSC is missing calorie data for one product — sourced from retailer sites.
"""

import logging
from pathlib import Path

from .petsmart import scrape_petsmart_brand

logger = logging.getLogger(__name__)

# PetSmart RSC is missing calorie data for this product.
# Sourced from retailer sites (Mar 2026).
_MANUAL_PRODUCT_DATA: dict[str, dict] = {
    "86011.html": {
        # All Life Stages Salmon & Ancient Grains — missing calories
        "calorie_content": "3370 kcal/kg, 460 kcal/cup",
    },
}

# Different bag sizes of the same product
_SKIP_URLS: set[str] = {
    "78529.html",  # Dupe of 57819 (Pure Lamb & Brown Rice, 22 lbs vs 4 lbs)
    "52922.html",  # Dupe of 78511 (Pure Salmon & Sweet Potato, no size vs 22 lbs)
}


def _detect_sub_brand(name: str) -> str | None:
    """Detect Canidae sub-brand from product name."""
    name_lower = name.lower()
    if "pure" in name_lower:
        return "Pure"
    if "all life stages" in name_lower or "multi-protein" in name_lower:
        return "All Life Stages"
    if "sustain" in name_lower:
        return "Sustain"
    return None


def scrape_canidae(output_dir: Path) -> int:
    """Scrape all Canidae dog products from PetSmart. Returns product count."""
    return scrape_petsmart_brand(
        output_dir,
        brand_name="Canidae",
        slug="canidae",
        brand_slug="canidae",
        detect_sub_brand=_detect_sub_brand,
        manual_product_data=_MANUAL_PRODUCT_DATA,
        skip_url_patterns=_SKIP_URLS,
    )
