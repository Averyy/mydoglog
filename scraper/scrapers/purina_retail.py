"""Purina retail scraper (via PetSmart.ca).

Retail Purina products are scraped from PetSmart because purina.ca's Gatsby API
stores ingredients as incomplete taxonomy terms (missing mineral/vitamin groups).

Single scrape using PetSmart's multi-brand filter URL covering all Purina sub-brands:
Beggin' Strips, Beyond, DentaLife, Purina Dog Chow, Purina ONE, Purina Pro Plan,
Purina Puppy Chow.
"""

import logging
from pathlib import Path

from .petsmart import scrape_petsmart_brand

logger = logging.getLogger(__name__)

# PetSmart brand filter URL with all Purina sub-brands pre-selected
_LISTING_URL = (
    "https://www.petsmart.ca/dog/f/brand/"
    "beggin%27%20strips+beyond+dentalife+purina%20dog%20chow"
    "+purina%20one+purina%20pro%20plan+purina%20puppy%20chow"
)


def _detect_sub_brand(name: str) -> str | None:
    """Detect Purina sub-brand from product name."""
    name_lower = name.lower()
    if "pro plan" in name_lower:
        return "Pro Plan"
    if "purina one" in name_lower or name_lower.startswith("one "):
        return "Purina ONE"
    if "dog chow" in name_lower:
        return "Dog Chow"
    if "puppy chow" in name_lower:
        return "Puppy Chow"
    if "beyond" in name_lower:
        return "Beyond"
    if "beneful" in name_lower:
        return "Beneful"
    if "dentalife" in name_lower or "denta life" in name_lower:
        return "DentaLife"
    if "beggin" in name_lower:
        return "Beggin'"
    return None


_MANUAL_PRODUCT_DATA: dict[str, dict] = {
    "beggin-chew-rific-dog-treat---bacon-and-cheese-86838": {
        "calorie_content": "2708 kcal/kg, 40 kcal/piece",
    },
}


def scrape_purina_retail(output_dir: Path) -> int:
    """Scrape all retail Purina dog products from PetSmart. Returns product count."""
    return scrape_petsmart_brand(
        output_dir,
        brand_name="Purina",
        slug="purina_retail",
        listing_url=_LISTING_URL,
        brand_pattern=r"(?:Purina|Beneful|Beyond|DentaLife|Denta\s*Life|Beggin)",
        detect_sub_brand=_detect_sub_brand,
        manual_product_data=_MANUAL_PRODUCT_DATA,
    )
