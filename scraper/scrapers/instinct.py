"""Instinct (Nature's Variety) scraper (via PetSmart.ca).

Manufacturer site (instinctpetfood.com) has ~104 products but ingredients as images.
PetSmart has the Canadian subset with RSC data.
~46 dog products.
"""

import logging
from pathlib import Path

from .petsmart import scrape_petsmart_brand

logger = logging.getLogger(__name__)


def _detect_sub_brand(name: str) -> str | None:
    """Detect Instinct sub-brand from product name."""
    name_lower = name.lower()
    if "raw boost" in name_lower:
        return "Raw Boost"
    if "raw longevity" in name_lower:
        return "Raw Longevity"
    if "original" in name_lower:
        return "Original"
    if "limited ingredient" in name_lower:
        return "Limited Ingredient Diet"
    if "be natural" in name_lower:
        return "Be Natural"
    return None


def scrape_instinct(output_dir: Path) -> int:
    """Scrape all Instinct dog products from PetSmart. Returns product count."""
    return scrape_petsmart_brand(
        output_dir,
        brand_name="Instinct",
        slug="instinct",
        brand_slug="instinct",
        brand_pattern=r"instinct|nature'?s?\s+variety",
        detect_sub_brand=_detect_sub_brand,
    )
