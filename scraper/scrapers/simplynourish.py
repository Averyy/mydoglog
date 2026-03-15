"""Simply Nourish scraper (via PetSmart.ca).

PetSmart private label — no manufacturer site exists.
59 dog products (food + toppers). No treats on PetSmart.ca.
Sub-brands: Original, Limited Ingredient Diet, Source, Natural Solutions
"""

import logging
from pathlib import Path

from .petsmart import scrape_petsmart_brand

logger = logging.getLogger(__name__)

# Brand-specific ingredient overrides for PetSmart source data errors
_INGREDIENT_OVERRIDES: dict[str, str] = {
    "Flaxseed Peas": "Flaxseed, Peas",
    # Hip & Joint product has extra ) after L-Ascorbyl-2-Polyphosphate
    "L-Ascorbyl-2-Polyphosphate)": "L-Ascorbyl-2-Polyphosphate",
    # OCR mangled "(A" → "9a" in preservative annotation
    "Citric Acid 9a Preservative)": "Citric Acid (A Preservative)",
    # Empty parens artifact on Vitamin D3 Supplement
    "Supplement()": "Supplement",
    # Premature Vitamins block close (Source Puppy)
    "Riboflavin Supplement), Thiamine": "Riboflavin Supplement, Thiamine",
}


def _detect_sub_brand(name: str) -> str | None:
    """Detect Simply Nourish sub-brand from product name."""
    name_lower = name.lower()
    if "limited ingredient" in name_lower:
        return "Limited Ingredient Diet"
    if "source" in name_lower:
        return "Source"
    if "natural solution" in name_lower:
        return "Natural Solutions"
    if "original" in name_lower:
        return "Original"
    return None


def scrape_simplynourish(output_dir: Path) -> int:
    """Scrape all Simply Nourish dog products from PetSmart. Returns product count."""
    return scrape_petsmart_brand(
        output_dir,
        brand_name="Simply Nourish",
        slug="simplynourish",
        brand_slug="simply-nourish",
        ingredient_overrides=_INGREDIENT_OVERRIDES,
        detect_sub_brand=_detect_sub_brand,
    )
