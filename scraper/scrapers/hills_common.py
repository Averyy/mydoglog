"""Shared Hill's parsing utilities used by both hills_vet and hills_retail scrapers.

Extracts accordion-based content (ingredients, GA, calories) from hillspet.ca
product pages. Hill's uses AEM accordion components with aria-controls.
"""

import logging
import re

from bs4 import BeautifulSoup

from .common import (
    GuaranteedAnalysis,
    clean_text,
    normalize_calorie_content,
    parse_ga_html_table,
)

logger = logging.getLogger(__name__)

# Hill's nutrient table uses short labels → map to our GA fields
HILLS_GA_MAP: dict[str, str] = {
    "protein": "crude_protein_min",
    "crude protein": "crude_protein_min",
    "fat": "crude_fat_min",
    "crude fat": "crude_fat_min",
    "crude fiber": "crude_fiber_max",
    "crude fibre": "crude_fiber_max",
    "fiber": "crude_fiber_max",
    "fibre": "crude_fiber_max",
    "moisture": "moisture_max",
    "ash": "ash_max",
    "calcium": "calcium_min",
    "phosphorus": "phosphorus_min",
    "omega-6 fatty acids": "omega_6_min",
    "omega-3 fatty acids": "omega_3_min",
    "total omega-6 fa": "omega_6_min",
    "total omega-3 fa": "omega_3_min",
    "taurine": "taurine_min",
    "epa": "epa_min",
    "dha": "dha_min",
    "l-carnitine": "l_carnitine_min",
    "carnitine": "l_carnitine_min",
    "glucosamine": "glucosamine_min",
    "chondroitin sulfate": "chondroitin_min",
}

_PCT_FIELDS = frozenset({
    "crude_protein", "crude_fat", "crude_fiber", "moisture", "ash",
    "calcium", "phosphorus", "omega_6", "omega_3", "epa", "dha",
    "taurine", "potassium", "sodium", "copper",
})


def find_accordion_content(soup: BeautifulSoup, heading_text: str) -> str | None:
    """Find accordion panel content by its heading text."""
    heading_lower = heading_text.lower()

    # Strategy 1: AEM accordion — button with aria-controls → panel by ID
    for btn in soup.find_all("button", class_="cmp-accordion__button"):
        btn_text = btn.get_text(strip=True).lower()
        if heading_lower in btn_text:
            panel_id = btn.get("aria-controls", "")
            if panel_id:
                panel = soup.find(id=panel_id)
                if panel:
                    return str(panel)

    # Strategy 2: any button/heading with aria-controls
    for tag in soup.find_all(["button", "h2", "h3", "h4", "summary"]):
        tag_text = tag.get_text(strip=True).lower()
        if heading_lower in tag_text:
            panel_id = tag.get("aria-controls", "")
            if panel_id:
                panel = soup.find(id=panel_id)
                if panel:
                    return str(panel)
            parent = tag.parent
            if parent and parent.name in ("h2", "h3", "h4"):
                panel = parent.find_next_sibling()
                if panel:
                    return str(panel)

    return None


def parse_ingredients(soup: BeautifulSoup) -> str | None:
    """Extract ingredients from the Ingredients accordion panel."""
    content = find_accordion_content(soup, "Ingredients")
    if not content:
        return None

    content_soup = BeautifulSoup(content, "lxml")
    text = content_soup.get_text(separator=" ")
    text = clean_text(text)

    text = re.sub(r"^ingredients?\s*:?\s*", "", text, flags=re.IGNORECASE).strip()

    return text if len(text) > 10 else None


def parse_ga(soup: BeautifulSoup) -> GuaranteedAnalysis | None:
    """Extract GA from the Nutrient Content accordion panel.

    Hill's tables use simplified labels ("Protein", "Fat", "Crude Fiber")
    without min/max designators. We map these to standard fields.
    """
    content = find_accordion_content(soup, "Nutrient")
    if not content:
        content = find_accordion_content(soup, "Guaranteed Analysis")
    if not content:
        return None

    if "<table" not in content.lower():
        return None

    ga = parse_ga_html_table(content)

    ga = ga or {}
    content_soup = BeautifulSoup(content, "lxml")
    for row in content_soup.find_all("tr"):
        cells = [c.get_text(strip=True) for c in row.find_all(["td", "th"])]
        if len(cells) < 2:
            continue
        label = cells[0].lower().strip()
        value_text = cells[1]
        m = re.search(r"(\d+\.?\d*)\s*%?", value_text)
        if not m:
            continue
        value = float(m.group(1))
        field = HILLS_GA_MAP.get(label)
        if field and field not in ga:
            ga[field] = value

    # Sanity check: drop percentage fields >100%
    if ga:
        bad_keys = [
            k for k, v in ga.items()
            if any(k.startswith(f) for f in _PCT_FIELDS) and v > 100
        ]
        for k in bad_keys:
            logger.warning(f"Hills GA sanity check: dropping {k}={ga[k]} (>100%)")
            del ga[k]

    return ga if ga else None


def parse_calorie_content(soup: BeautifulSoup) -> str | None:
    """Extract calorie content from nutrient panel or page text."""
    content = find_accordion_content(soup, "Nutrient")
    if not content:
        content = find_accordion_content(soup, "Caloric")
    if not content:
        return None

    content_soup = BeautifulSoup(content, "lxml")
    text = clean_text(content_soup.get_text(separator=" "))

    # Wet food format: "{kcal} kcal / {size} {unit} ({grams} g) can"
    m = re.search(
        r"(\d[\d,]*\.?\d*)\s*kcal\s*/\s*(\d+\.?\d*)\s*(oz|g)\b",
        text,
        re.IGNORECASE,
    )
    if m:
        kcal = m.group(1).replace(",", "")
        return f"{int(float(kcal))} kcal/can"

    # French calorie text: "{kcal} kcal par conserve de {size} g ({oz} oz)"
    m = re.search(
        r"(\d[\d,]*\.?\d*)\s*kcal\s+par\s+conserve",
        text,
        re.IGNORECASE,
    )
    if m:
        kcal = m.group(1).replace(",", "")
        return f"{int(float(kcal))} kcal/can"

    # Dry food format: kcal/kg + kcal/cup — only the calorie-specific line
    cal_line = re.search(
        r"(\d[\d,]*\.?\d*\s*kcal\s*/\s*kg[^\n]*)",
        text,
        re.IGNORECASE,
    )
    if cal_line:
        result = normalize_calorie_content(cal_line.group(1))
        if result and "kcal/" in result and len(result) < 60:
            return result

    return None
