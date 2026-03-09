"""Farmina Vet Life scraper (farmina.com/ca).

Data source: PHP SSR with AJAX product listing.
- Discovery: POST to a_prodotti_eshop.php with form params (idlinea=74 for Vet Life)
  Returns HTML fragment with product cards. Needs Referer + X-Requested-With headers.
- Detail: GET /ca/eshop/dog-food/farmina-vet-life-canine/{id}-{slug}.html
  - Product name: h1.product-title > span.product-title
  - Ingredients: div.composizione > p.comp (after span.titoletto "ingredients")
  - GA: div.text2 > p.comp (after span.titoletto "guaranteed analysis")
  - Calories: embedded at end of GA text after "Calorie Content"
  - Image: #sacco > img src

Key notes:
- 15 products (8 dry, 7 wet) — all vet channel therapeutic diets
- No anti-bot protection beyond requiring X-Requested-With header
- GA and calorie content share the same paragraph, split on "Calorie Content"
- Some ingredient text has <br> tags that need stripping
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
    write_brand_json,
)

logger = logging.getLogger(__name__)

WEBSITE_URL = "https://www.farmina.com"
_LISTING_URL = f"{WEBSITE_URL}/a_prodotti_eshop.php"
_VET_LIFE_LINE_PAGE = (
    f"{WEBSITE_URL}/ca/eshop-dog/Dog-food/74-Farmina-Vet-Life-canine.html"
)

# Form params for Vet Life canine listing
_LISTING_FORM = {
    "prima": "si",
    "idpagina": "4196",
    "idlingua": "58",
    "idlinea": "74",
    "specie": "d",
}


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


def _fetch_product_urls(session: SyncSession) -> list[str]:
    """Discover all Vet Life canine product URLs from the AJAX listing."""
    resp = session.post(
        _LISTING_URL,
        form=_LISTING_FORM,
        headers={
            "Referer": _VET_LIFE_LINE_PAGE,
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    if not resp.ok:
        logger.error(f"Listing request failed: {resp.status_code}")
        return []

    soup = BeautifulSoup(resp.text, "lxml")
    urls: list[str] = []

    for div in soup.find_all("div", class_="hoverbox"):
        onclick = div.get("onclick", "")
        # Extract URL from onclick="location.href='...'"
        m = re.search(r"location\.href='([^']+)'", onclick)
        if m:
            url = m.group(1)
            if url not in urls:
                urls.append(url)

    return urls


# ---------------------------------------------------------------------------
# Product type / format detection
# ---------------------------------------------------------------------------


def _detect_format(name: str) -> str:
    """Detect product format from product name."""
    if "wet food" in name.lower() or "wet" in name.lower():
        return "wet"
    return "dry"


def _detect_health_tags(name: str) -> list[str]:
    """Extract health condition tags from product name."""
    tags: list[str] = []
    name_lower = name.lower()

    tag_map = {
        "gastrointestinal": "gastrointestinal",
        "urinary": "urinary",
        "renal": "renal",
        "derma": "dermatology",
        "caloric control": "weight-management",
        "recoup": "recovery",
    }

    for keyword, tag in tag_map.items():
        if keyword in name_lower:
            tags.append(tag)
            break  # one tag per product

    return tags


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------


def _parse_name(soup: BeautifulSoup) -> str | None:
    """Extract product name from page."""
    h1 = soup.find("h1", class_="product-title")
    if h1:
        span = h1.find("span", class_="product-title")
        if span:
            return clean_text(span.get_text())
    return None


def _parse_image(soup: BeautifulSoup) -> str | None:
    """Extract product image URL."""
    sacco = soup.find("div", id="sacco")
    if sacco:
        img = sacco.find("img")
        if img and img.get("src"):
            return img["src"]
    return None


def _parse_ingredients(soup: BeautifulSoup) -> str | None:
    """Extract ingredients text."""
    comp_div = soup.find("div", class_="composizione")
    if not comp_div:
        return None

    # Find p.comp after the "ingredients" heading
    for span in comp_div.find_all("span", class_="titoletto"):
        if "ingredients" in span.get_text(strip=True).lower():
            p = span.find_next_sibling("p", class_="comp")
            if p:
                return clean_text(p.get_text(" ", strip=True))
    return None


def _parse_ga_and_calories(
    soup: BeautifulSoup,
) -> tuple[GuaranteedAnalysis | None, str | None]:
    """Extract guaranteed analysis and calorie content.

    Both are in the same paragraph in div.text2, with calorie content
    appended after the GA data.
    """
    # GA can be in div.text2 or div.etichetta depending on the product
    ga_text: str | None = None
    ga_container: Tag | None = None

    for container_class in ("text2", "text1", "etichetta"):
        container = soup.find("div", class_=container_class)
        if not container:
            continue
        for span in container.find_all("span", class_="titoletto"):
            if "guaranteed analysis" in span.get_text(strip=True).lower():
                p = span.find_next_sibling("p", class_="comp")
                if p:
                    ga_text = clean_text(p.get_text(" ", strip=True))
                    ga_container = container
                break
        if ga_text:
            break

    if not ga_text:
        return None, None

    # Split GA from calorie content
    calorie_raw: str | None = None
    ga_only = ga_text

    cal_match = re.search(r"calorie\s+content", ga_text, re.IGNORECASE)
    if cal_match:
        ga_only = ga_text[: cal_match.start()].rstrip(" .;,")
        calorie_raw = ga_text[cal_match.start() :]

    ga = _parse_ga_text(ga_only)
    calories = normalize_calorie_content(calorie_raw) if calorie_raw else None

    # Fallback: check "energy value" section for calories (may be in text2 or same container)
    if not calories:
        search_containers = []
        if ga_container:
            search_containers.append(ga_container)
        text2 = soup.find("div", class_="text2")
        if text2 and text2 not in search_containers:
            search_containers.append(text2)

        for container in search_containers:
            for span in container.find_all("span", class_="titoletto"):
                if "energy value" in span.get_text(strip=True).lower():
                    p = span.find_next_sibling("p", class_="comp")
                    if p:
                        energy_text = clean_text(p.get_text(" ", strip=True))
                        # Try normalize_calorie_content first (handles kcal/cup)
                        calories = normalize_calorie_content(energy_text)
                        if not calories:
                            # Fallback: "EM Kcal/lb 637 - Mj/lb 2.66"
                            lb_match = re.search(
                                r"(\d+\.?\d*)\s*(?:kcal/lb|Kcal/lb)",
                                energy_text,
                                re.IGNORECASE,
                            )
                            if lb_match:
                                kcal_lb = float(lb_match.group(1))
                                kcal_kg = round(kcal_lb / 0.453592)
                                calories = f"{kcal_kg} kcal/kg"
                    break
            if calories:
                break

    return ga if ga else None, calories


def _parse_ga_text(text: str) -> GuaranteedAnalysis:
    """Parse GA from Farmina's inline format.

    Handles:
    - "Crude protein (min) 6.50%; crude fats (min) 7.50%; ..."
    - "crude protein 8.5%; crude fibre 1%; crude ash 2.5%; moisture 78%"
    """
    ga: dict[str, float] = {}

    label_map: dict[str, str] = {
        "crude protein": "crude_protein",
        "crude fat": "crude_fat",
        "crude fats": "crude_fat",
        "crude oils and fats": "crude_fat",
        "crude fiber": "crude_fiber",
        "crude fibre": "crude_fiber",
        "moisture": "moisture",
        "crude ash": "ash",
        "ash": "ash",
        "calcium": "calcium",
        "phosphorus": "phosphorus",
        "sodium": "sodium",
        "potassium": "potassium",
        "omega-6 fatty acids": "omega_6",
        "omega 6 fatty acids": "omega_6",
        "omega-6": "omega_6",
        "omega-3 fatty acids": "omega_3",
        "omega 3 fatty acids": "omega_3",
        "omega-3": "omega_3",
        "epa": "epa",
        "dha": "dha",
        "taurine": "taurine",
        "l-carnitine": "l_carnitine",
    }

    _MAX_BY_DEFAULT = {"ash", "crude_fiber", "moisture"}

    for m in re.finditer(
        r"([A-Za-z][A-Za-z0-9\s\-*/()]+?)\s+"
        r"(\d+\.?\d*)\s*%",
        text,
    ):
        label_raw = m.group(1).strip().lower()
        value = float(m.group(2))

        # Determine min/max from label
        explicit_suffix: str | None = None
        max_match = re.search(r"\(max\.?\)", label_raw)
        min_match = re.search(r"\(min\.?\)", label_raw)
        if max_match:
            explicit_suffix = "_max"
            label_raw = label_raw[: max_match.start()].strip()
        elif min_match:
            explicit_suffix = "_min"
            label_raw = label_raw[: min_match.start()].strip()

        label_raw = label_raw.strip("* .")

        field_base: str | None = None
        for known_label, field in label_map.items():
            if known_label == label_raw or known_label in label_raw:
                field_base = field
                break

        if not field_base:
            continue

        if explicit_suffix:
            suffix = explicit_suffix
        elif field_base in _MAX_BY_DEFAULT:
            suffix = "_max"
        else:
            suffix = "_min"

        ga[f"{field_base}{suffix}"] = value

    return ga  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Product scraping
# ---------------------------------------------------------------------------


def _scrape_product(url: str, session: SyncSession) -> Product | None:
    """Scrape a single Vet Life product page."""
    resp = session.get(url)
    if not resp.ok:
        logger.warning(f"  Failed to fetch {url}: {resp.status_code}")
        return None

    soup = BeautifulSoup(resp.text, "lxml")

    name = _parse_name(soup)
    if not name:
        logger.warning(f"  No product name found: {url}")
        return None

    product_format = _detect_format(name)
    health_tags = _detect_health_tags(name)

    product: Product = {
        "name": name,
        "brand": "Farmina",
        "sub_brand": "Vet Life",
        "url": url,
        "channel": "vet",
        "product_type": "food",
        "product_format": product_format,
    }

    if health_tags:
        product["health_tags"] = health_tags

    # Ingredients
    ingredients = _parse_ingredients(soup)
    if ingredients:
        product["ingredients_raw"] = ingredients
    else:
        logger.warning(f"  Missing ingredients: {name}")

    # GA + Calories
    ga, calories = _parse_ga_and_calories(soup)
    if ga:
        product["guaranteed_analysis"] = ga
        product["guaranteed_analysis_basis"] = "as-fed"
    else:
        logger.warning(f"  Missing GA: {name}")

    if calories:
        product["calorie_content"] = calories
    else:
        logger.warning(f"  Missing calories: {name}")

    # Image
    image = _parse_image(soup)
    if image:
        product["images"] = [image]

    return product


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def scrape_farmina(output_dir: Path) -> int:
    """Scrape all Farmina Vet Life canine products. Returns product count."""
    with SyncSession(rate_limit=1.0) as session:
        # Step 1: Discover product URLs
        logger.info("Discovering Vet Life canine products...")
        product_urls = _fetch_product_urls(session)
        logger.info(f"Found {len(product_urls)} product URLs")

        # Step 2: Scrape each product
        products: list[Product] = []
        for i, url in enumerate(product_urls):
            slug = url.split("/")[-1].replace(".html", "")
            logger.info(f"  [{i + 1}/{len(product_urls)}] {slug}")
            product = _scrape_product(url, session)
            if product:
                products.append(product)

    # Log completeness
    has_ingredients = sum(1 for p in products if p.get("ingredients_raw"))
    has_ga = sum(1 for p in products if p.get("guaranteed_analysis"))
    has_cal = sum(1 for p in products if p.get("calorie_content"))
    logger.info(
        f"Completeness: {has_ingredients}/{len(products)} ingredients, "
        f"{has_ga}/{len(products)} GA, {has_cal}/{len(products)} calories"
    )

    write_brand_json("Farmina", WEBSITE_URL, products, output_dir, slug="farmina")
    return len(products)
