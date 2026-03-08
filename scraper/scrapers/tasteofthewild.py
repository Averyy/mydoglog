"""Taste of the Wild scraper.

Data source: WordPress HTML.
- Listing: Recipe finder page with Search & Filter Pro plugin (?_sfm_species=canine)
- Detail: HTML page parse — GA table, calories, AAFCO in page content
- Sub-brands: taste-of-the-wild (grain-free), ancient-grains, prey (limited ingredient)

Key notes:
- Ingredients may be in expandable sections — check multiple selectors
- GA is in HTML table format
- AAFCO statement present in page
- All products are retail channel
- 21 canine products as of 2026-03
"""

import logging
import re
from pathlib import Path

from bs4 import BeautifulSoup, Tag
from wafer import SyncSession

from .common import (
    GuaranteedAnalysis,
    Product,
    clean_text,
    normalize_calorie_content,
    parse_ga_html_table,
    write_brand_json,
)

logger = logging.getLogger(__name__)

WEBSITE_URL = "https://www.tasteofthewildpetfood.com"

# Recipe finder filtered to canine products (Search & Filter Pro plugin)
_RECIPE_FINDER_URL = f"{WEBSITE_URL}/recipe-finder?_sfm_species=canine"

# Sub-brand detection from URL
_SUB_BRAND_MAP: dict[str, str] = {
    "/taste-of-the-wild/": "Taste of the Wild",
    "/ancient-grains/": "Ancient Grains",
    "/prey/": "PREY",
    "/grain-free/": "Taste of the Wild",
}


def _fetch_product_urls(session: SyncSession) -> list[str]:
    """Discover product URLs from the recipe finder page filtered to canine."""
    urls: set[str] = set()

    resp = session.get(_RECIPE_FINDER_URL)
    if not resp.ok:
        logger.warning(f"Failed to fetch recipe finder: {resp.status_code}")
        return []

    soup = BeautifulSoup(resp.text, "lxml")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        # Product links contain /dog/ and a sub-brand path
        if "/dog/" in href and href.count("/") >= 5:
            if not href.startswith("http"):
                href = f"{WEBSITE_URL}{href}"
            if "/where-to-buy" in href or "#" in href:
                continue
            urls.add(href.rstrip("/"))

    logger.info(f"Found {len(urls)} product URLs")
    return sorted(urls)


def _detect_sub_brand(url: str) -> str | None:
    """Detect sub-brand from URL path."""
    for pattern, sub_brand in _SUB_BRAND_MAP.items():
        if pattern in url:
            return sub_brand
    return None


def _detect_type(url: str, title: str) -> str:
    """Detect product type: food, treat, or supplement."""
    combined = f"{url} {title}".lower()
    if "treat" in combined:
        return "treat"
    if "topper" in combined:
        return "supplement"
    return "food"


def _detect_format(url: str, title: str) -> str:
    """Detect product format: dry or wet."""
    combined = f"{url} {title}".lower()
    if "canned" in combined or "gravy" in combined or "stew" in combined:
        return "wet"
    # Use word boundary for "wet" so "Wetlands" doesn't match
    if re.search(r"\bwet\b", combined):
        return "wet"
    # Check for "can" but not "canine"
    if re.search(r"\bcan\b", combined) and "canine" not in combined:
        return "wet"
    return "dry"


def _parse_ingredients(soup: BeautifulSoup) -> str | None:
    """Extract the clean AAFCO ingredient list from the 'All Ingredients' accordion.

    The TOTW product pages have two ingredient sections:
    - "Featured Ingredients": marketing descriptions with icons (NOT what we want)
    - "All Ingredients": the actual AAFCO ingredient list in a <ul id="all-ingred-pills-list">
      inside <div id="collapseIngredients">, with each ingredient as an <a class="nav-link">

    We extract only from the "All Ingredients" list and join with ", " to produce
    a clean comma-separated AAFCO-style ingredient string.
    """
    # Primary: target the All Ingredients list by its specific ID
    all_ingred_list = soup.find("ul", id="all-ingred-pills-list")
    if all_ingred_list and isinstance(all_ingred_list, Tag):
        ingredients: list[str] = []
        for a_tag in all_ingred_list.find_all("a", class_="nav-link"):
            name = a_tag.get_text(strip=True)
            if name:
                ingredients.append(clean_text(name))
        if ingredients:
            return ", ".join(ingredients)

    # Fallback: target the collapseIngredients accordion div
    collapse_div = soup.find("div", id="collapseIngredients")
    if collapse_div and isinstance(collapse_div, Tag):
        ingredients = []
        for li in collapse_div.find_all("li", class_="nav-item"):
            a_tag = li.find("a")
            if a_tag:
                name = a_tag.get_text(strip=True)
                if name:
                    ingredients.append(clean_text(name))
        if ingredients:
            return ", ".join(ingredients)

    return None


def _parse_ga(soup: BeautifulSoup) -> GuaranteedAnalysis | None:
    """Parse GA from HTML table."""
    # Find tables and check for GA content
    for table in soup.find_all("table"):
        table_text = table.get_text().lower()
        if "crude protein" in table_text or "crude fat" in table_text:
            return parse_ga_html_table(str(table))
    return None


def _parse_calorie_content(soup: BeautifulSoup) -> str | None:
    """Extract calorie content from page text."""
    text = soup.get_text(separator=" ")
    # Look for calorie pattern
    cal_match = re.search(
        r"(\d[\d,]*)\s*kcal/kg.*?(\d+)\s*kcal/(?:cup|can)",
        text,
        re.IGNORECASE,
    )
    if cal_match:
        return normalize_calorie_content(cal_match.group(0))

    # Try broader search
    for pattern in [
        r"\d[\d,]*\s*kcal/kg",
        r"\d+\s*kcal\s*/\s*cup",
    ]:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            # Get surrounding context
            start = max(0, match.start() - 50)
            end = min(len(text), match.end() + 50)
            return normalize_calorie_content(text[start:end])

    return None


def _parse_aafco(soup: BeautifulSoup) -> str | None:
    """Extract AAFCO statement from the dedicated tab pane.

    The AAFCO statement lives in <div id="aafco-tab-pane"> under an
    <h3>AAFCO Statement</h3> heading, followed by a <p> with the statement text.
    Targeting the specific element avoids pulling in nav/menu/sidebar junk.
    """
    # Primary: target the AAFCO tab pane by its ID
    aafco_pane = soup.find("div", id="aafco-tab-pane")
    if aafco_pane and isinstance(aafco_pane, Tag):
        # Find the <h3>AAFCO Statement</h3> heading and grab the next <p>
        h3 = aafco_pane.find("h3", string=re.compile(r"AAFCO\s+Statement", re.IGNORECASE))
        if h3:
            # The statement is in the next <p> sibling (may be nested in a parent div)
            p = h3.find_next("p")
            if p:
                statement = clean_text(p.get_text(separator=" "))
                if len(statement) > 20:
                    return statement

    # Fallback: search for any heading with "AAFCO Statement" and grab the next <p>
    for heading in soup.find_all(["h2", "h3", "h4"]):
        if re.search(r"AAFCO\s+Statement", heading.get_text(), re.IGNORECASE):
            p = heading.find_next("p")
            if p:
                statement = clean_text(p.get_text(separator=" "))
                if len(statement) > 20:
                    return statement

    # Last resort: regex on page text (scoped to avoid nav junk)
    main = soup.find("main") or soup.find("article") or soup
    text = main.get_text(separator=" ")
    match = re.search(
        r"((?:Taste of the Wild|This)[^.]*?(?:AAFCO|Association of American Feed Control)[^.]*\.)",
        text,
        re.IGNORECASE,
    )
    if match:
        statement = clean_text(match.group(1))
        if len(statement) > 20:
            return statement

    return None


def _detect_life_stage(name: str, aafco: str | None) -> str | None:
    """Detect life stage from product name and AAFCO statement.

    AAFCO statements specify the nutrient profile:
    - "for maintenance" → Adult
    - "for all life stages" or "for growth and maintenance" → All Life Stages
    - "for growth" (alone) → Puppy
    Product name "puppy" overrides to Puppy if present.
    """
    name_lower = name.lower()

    # Product name takes priority for puppy detection
    if "puppy" in name_lower:
        return "puppy"
    if "senior" in name_lower:
        return "senior"

    # Parse from AAFCO statement
    if aafco:
        aafco_lower = aafco.lower()
        if "all life stages" in aafco_lower:
            return "all life stages"
        if "growth and maintenance" in aafco_lower or "growth & maintenance" in aafco_lower:
            return "all life stages"
        if "growth" in aafco_lower:
            return "puppy"
        if "maintenance" in aafco_lower:
            return "adult"

    # Fallback from name
    if "adult" in name_lower:
        return "adult"

    return None


def _parse_images(soup: BeautifulSoup) -> list[str]:
    """Extract product images."""
    images: list[str] = []

    # og:image
    og_img = soup.find("meta", property="og:image")
    if og_img and isinstance(og_img, Tag):
        src = og_img.get("content", "")
        if src and isinstance(src, str) and src.startswith("http"):
            images.append(src)

    return images


def _parse_product(url: str, html: str) -> Product | None:
    """Parse a TOTW product page."""
    soup = BeautifulSoup(html, "lxml")

    # Get product name from h1
    h1 = soup.find("h1")
    if not h1:
        return None
    name = clean_text(h1.get_text())
    if not name or len(name) < 3:
        return None

    product: Product = {
        "name": name,
        "brand": "Taste of the Wild",
        "url": url,
        "channel": "retail",
        "product_type": _detect_type(url, name),
        "product_format": _detect_format(url, name),
    }

    sub_brand = _detect_sub_brand(url)
    if sub_brand:
        product["sub_brand"] = sub_brand

    ingredients = _parse_ingredients(soup)
    if ingredients:
        product["ingredients_raw"] = ingredients

    ga = _parse_ga(soup)
    if ga:
        product["guaranteed_analysis"] = ga
        product["guaranteed_analysis_basis"] = "as-fed"

    cal = _parse_calorie_content(soup)
    if cal:
        product["calorie_content"] = cal

    aafco = _parse_aafco(soup)
    if aafco:
        product["aafco_statement"] = aafco

    life_stage = _detect_life_stage(name, aafco)
    if life_stage:
        product["life_stage"] = life_stage

    images = _parse_images(soup)
    if images:
        product["images"] = images

    return product


def scrape_tasteofthewild(output_dir: Path) -> int:
    """Scrape all Taste of the Wild dog food products. Returns product count."""
    with SyncSession(rate_limit=1.0) as session:
        urls = _fetch_product_urls(session)

        products: list[Product] = []
        for i, url in enumerate(urls):
            logger.info(f"  [{i + 1}/{len(urls)}] {url}")
            resp = session.get(url)
            if not resp.ok:
                logger.warning(f"Failed to fetch {url}: {resp.status_code}")
                continue

            product = _parse_product(url, resp.text)
            if product:
                products.append(product)
            else:
                logger.warning(f"Failed to parse: {url}")

    write_brand_json(
        "Taste of the Wild", WEBSITE_URL, products, output_dir, slug="tasteofthewild"
    )
    return len(products)
