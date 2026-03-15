"""Fromm scraper (frommfamily.com).

Data source: Umbraco CMS, server-rendered HTML.
- Discovery: GET /sitemap → HTML page with all product URLs organized by line/format
- Detail: GET /products/dog/{line}/{type}/{slug}/ → plain HTML
  - Product name: h1.text-uppercase (HTML entities need decoding)
  - Ingredients: div.mt-5.ingredients (mixed <a> links and plain text, HTML comments to strip)
  - GA: ul li items after "Guaranteed Analysis" h3 (format: "Name Value% MIN|MAX")
  - Calories: div.content-list.calories ul li (dry: kcal/kg+lb+cup, can: kcal/kg+can, treat: per-treat)
  - Image: #mainCarousel .carousel__slide data-src or img src

Key notes:
- ~90+ dog products across 12 product lines (Gold, Four-Star, Classic, Diner, etc.)
- No anti-bot protection, plain HTML parsing
- Vitamin/mineral ingredients use bracket notation: Vitamins [...], Minerals [...]
- HTML comments interspersed in ingredient markup must be stripped
- Treats have per-treat calorie format instead of kcal/kg
"""

import logging
import re
from pathlib import Path

from bs4 import BeautifulSoup, Comment
from wafer import SyncSession

from .common import (
    GuaranteedAnalysis,
    Product,
    clean_text,
    normalize_calorie_content,
    write_brand_json,
)

logger = logging.getLogger(__name__)

WEBSITE_URL = "https://frommfamily.com"

_INGREDIENT_OVERRIDES: dict[str, str] = {
    "Chickpea Pasta, (Chickpea Flour": "Chickpea Pasta, Chickpea Flour",
    "Minerals, Minerals [": "Minerals [",
    "Vitamins, Vitamins [": "Vitamins [",
}
_SITEMAP_URL = f"{WEBSITE_URL}/sitemap"

# Product lines → sub-brand display names
_LINE_DISPLAY: dict[str, str] = {
    "gold": "Gold",
    "four-star": "Four-Star",
    "classic": "Classic",
    "diner": "Diner",
    "frommbalaya": "Frommbalaya",
    "frommbo-gumbo": "Frommbo Gumbo",
    "pate": "Pâté",
    "crunchy-os": "Crunchy Os",
    "popetts": "Popetts",
    "tenderollies": "Tenderollies",
    "nutritionals": "Nutritionals",
    "bonnihill-farms": "Bonnihill Farms",
}


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


def _discover_product_urls(session: SyncSession) -> list[str]:
    """Discover all dog product URLs from the sitemap page."""
    resp = session.get(_SITEMAP_URL)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "lxml")
    urls: list[str] = []

    for a in soup.find_all("a", href=True):
        href: str = a["href"]
        if not href.startswith("/products/dog/"):
            continue

        # Product URLs: /products/dog/{line}/{type}/{slug}/ = 5 path components
        parts = [p for p in href.strip("/").split("/") if p]
        if len(parts) != 5:
            continue

        # Skip tag/filter pages
        if parts[2] == "product-tags":
            continue

        url = f"{WEBSITE_URL}{href}"
        if url not in urls:
            urls.append(url)

    return urls


# ---------------------------------------------------------------------------
# Product type / format detection
# ---------------------------------------------------------------------------


def _detect_product_type(type_slug: str, name: str) -> str:
    """Detect product type from URL type segment and product name."""
    if type_slug in ("treats", "cracker-snacks"):
        return "treat"
    if "supplement" in name.lower():
        return "supplement"
    return "food"


def _detect_product_format(type_slug: str) -> str:
    """Detect product format from URL type segment."""
    if type_slug in ("can", "frozen"):
        return "wet"
    return "dry"


def _detect_life_stage(name: str) -> str | None:
    """Detect life stage from product name."""
    name_lower = name.lower()
    if "puppy" in name_lower:
        return "puppy"
    if "senior" in name_lower or "mature" in name_lower:
        return "senior"
    return None


def _detect_breed_size(name: str) -> str | None:
    """Detect breed size from product name."""
    name_lower = name.lower()
    if "large breed" in name_lower or "large and giant" in name_lower:
        return "large"
    if "small breed" in name_lower:
        return "small"
    return None


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------


def _parse_name(soup: BeautifulSoup) -> str | None:
    """Extract product name from h1."""
    h1 = soup.find("h1", class_="text-uppercase")
    if not h1:
        return None
    return clean_text(h1.get_text())


def _parse_breadcrumbs(soup: BeautifulSoup) -> tuple[str, str] | None:
    """Extract (line_slug, type_slug) from breadcrumbs.

    Breadcrumb structure: Dog / {Line} / {Type}
    Returns None if breadcrumbs not found or incomplete.
    """
    bc = soup.find("p", class_="breadcrumbs")
    if not bc:
        return None
    links = bc.find_all("a")
    if len(links) < 3:
        return None
    # Extract slugs from hrefs (last path segment)
    line_slug = links[1].get("href", "").strip("/").split("/")[-1]
    type_slug = links[2].get("href", "").strip("/").split("/")[-1]
    return (line_slug, type_slug)


def _parse_ingredients(soup: BeautifulSoup) -> str | None:
    """Extract ingredients text from the ingredients div.

    Handles mixed <a> links and plain text nodes, strips HTML comments
    and the heading, preserves bracket notation for vitamins/minerals.
    """
    # Target div.mt-5.ingredients specifically — some pages have an empty
    # <div class="ingredients col-sm-7"> higher up that would match first.
    div = soup.select_one("div.mt-5.ingredients")
    if not div:
        return None

    # Work on a copy to avoid mutating the parsed tree
    div_copy = BeautifulSoup(str(div), "lxml")
    ing_div = div_copy.select_one("div.ingredients")
    if not ing_div:
        return None

    # Remove the h3 heading
    h3 = ing_div.find("h3")
    if h3:
        h3.decompose()

    # Remove HTML comments
    for comment in ing_div.find_all(string=lambda text: isinstance(text, Comment)):
        comment.extract()

    # Get text content — links and plain text merge naturally
    text = ing_div.get_text()

    # Clean up whitespace and encoding artifacts
    text = re.sub(r"\s+", " ", text).strip()
    # Ensure space after commas (linked ingredients have comma inside <a> tag)
    text = re.sub(r",(?!\s)", ", ", text)
    text = clean_text(text)

    # Strip trailing period (Fromm pages end ingredient lists with a period)
    if text and text.endswith("."):
        text = text[:-1].rstrip()

    return text if text else None


def _parse_ga(soup: BeautifulSoup) -> GuaranteedAnalysis | None:
    """Extract and parse guaranteed analysis.

    Format: ul > li items like "Crude Protein 25% MIN".
    """
    for h3 in soup.find_all("h3"):
        if "guaranteed analysis" not in h3.get_text(strip=True).lower():
            continue

        ul = h3.find_next_sibling("ul")
        if not ul:
            continue

        ga: dict[str, float] = {}

        label_map: dict[str, str] = {
            "crude protein": "crude_protein",
            "crude fat": "crude_fat",
            "crude fiber": "crude_fiber",
            "crude fibre": "crude_fiber",
            "moisture": "moisture",
            "ash": "ash",
            "calcium": "calcium",
            "phosphorus": "phosphorus",
            "omega-6 fatty acids": "omega_6",
            "omega-6": "omega_6",
            "omega-3 fatty acids": "omega_3",
            "omega-3": "omega_3",
            "glucosamine": "glucosamine",
            "chondroitin sulfate": "chondroitin",
            "chondroitin": "chondroitin",
            "taurine": "taurine",
            "l-carnitine": "l_carnitine",
            "dha": "dha",
            "epa": "epa",
        }

        for li in ul.find_all("li"):
            text = li.get_text(strip=True)
            # Format: "Crude Protein 25% MIN" or "Crude Fiber 5.5% MAX"
            m = re.match(
                r"(.+?)\s+(\d+\.?\d*)\s*%\s*(MIN|MAX)",
                text,
                re.IGNORECASE,
            )
            if not m:
                continue

            label_raw = m.group(1).strip().lower()
            value = float(m.group(2))
            suffix = "_max" if m.group(3).upper() == "MAX" else "_min"

            # Match to field name
            field_base: str | None = None
            for known_label, field in label_map.items():
                if known_label == label_raw or known_label in label_raw:
                    field_base = field
                    break

            if not field_base:
                logger.debug(f"  Unknown GA label: {label_raw}")
                continue

            ga[f"{field_base}{suffix}"] = value

        return ga if ga else None  # type: ignore[return-value]

    return None


def _parse_calories(soup: BeautifulSoup) -> str | None:
    """Extract and normalize calorie content from the calories section."""
    cal_div = soup.find("div", class_="calories")
    if not cal_div:
        return None

    ul = cal_div.find("ul")
    if ul:
        # Standard format: kcal/kg, kcal/lb, kcal/cup in separate li items
        parts = [li.get_text(strip=True) for li in ul.find_all("li")]
        if not parts:
            return None
        raw = ", ".join(parts)
    else:
        # Treat format: single <p> with e.g. "2 Calories per treat (approximate)"
        p = cal_div.find("p")
        if not p:
            return None
        raw = p.get_text(strip=True)
        if not raw:
            return None
    return normalize_calorie_content(raw)


def _parse_image(soup: BeautifulSoup) -> str | None:
    """Extract primary product image URL from the carousel."""
    carousel = soup.find("div", id="mainCarousel")
    if not carousel:
        return None

    slide = carousel.find("div", class_="carousel__slide")
    if not slide:
        return None

    # Prefer data-src, fall back to img src
    src = slide.get("data-src")
    if src:
        return src

    img = slide.find("img")
    if img and img.get("src"):
        return img["src"]

    return None


def _parse_aafco(soup: BeautifulSoup) -> str | None:
    """Extract AAFCO statement from the calories section."""
    cal_div = soup.find("div", class_="calories")
    if not cal_div:
        return None

    for span in cal_div.find_all("span"):
        style = span.get("style", "")
        if "font-size" in style:
            text = clean_text(span.get_text())
            if "AAFCO" in text:
                return text

    return None


# ---------------------------------------------------------------------------
# Product scraping
# ---------------------------------------------------------------------------


def _scrape_product(url: str, session: SyncSession) -> Product | None:
    """Scrape a single Fromm product page."""
    resp = session.get(url)
    if resp.status_code != 200:
        logger.warning(f"  Failed to fetch {url}: {resp.status_code}")
        return None

    soup = BeautifulSoup(resp.text, "lxml")

    # Name
    name = _parse_name(soup)
    if not name:
        logger.warning(f"  No product name found: {url}")
        return None

    # Breadcrumbs for line and type
    bc = _parse_breadcrumbs(soup)
    if not bc:
        logger.warning(f"  No breadcrumbs found: {url}")
        return None

    line_slug, type_slug = bc

    # Type and format
    product_type = _detect_product_type(type_slug, name)
    product_format = _detect_product_format(type_slug)

    product: Product = {
        "name": name,
        "brand": "Fromm",
        "url": url,
        "channel": "retail",
        "product_type": product_type,
        "product_format": product_format,
    }

    # Sub-brand from product line
    sub_brand = _LINE_DISPLAY.get(line_slug)
    if sub_brand:
        product["sub_brand"] = sub_brand

    # Life stage
    life_stage = _detect_life_stage(name)
    if life_stage:
        product["life_stage"] = life_stage

    # Breed size
    breed_size = _detect_breed_size(name)
    if breed_size:
        product["breed_size"] = breed_size

    # Ingredients
    ingredients = _parse_ingredients(soup)
    if ingredients:
        product["ingredients_raw"] = ingredients
    else:
        logger.warning(f"  Missing ingredients: {name}")

    # GA
    ga = _parse_ga(soup)
    if ga:
        product["guaranteed_analysis"] = ga
        product["guaranteed_analysis_basis"] = "as-fed"
    else:
        logger.warning(f"  Missing GA: {name}")

    # Calories
    calories = _parse_calories(soup)
    if calories:
        product["calorie_content"] = calories
    else:
        logger.warning(f"  Missing calories: {name}")

    # AAFCO
    aafco = _parse_aafco(soup)
    if aafco:
        product["aafco_statement"] = aafco

    # Image
    image = _parse_image(soup)
    if image:
        product["images"] = [image]

    return product


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def scrape_fromm(output_dir: Path) -> int:
    """Scrape all Fromm dog products. Returns product count."""
    with SyncSession(rate_limit=2.0) as session:
        # Step 1: Discover product URLs
        logger.info("Discovering products from sitemap...")
        product_urls = _discover_product_urls(session)
        logger.info(f"Found {len(product_urls)} product URLs")

        # Step 2: Scrape each product
        products: list[Product] = []
        for i, url in enumerate(product_urls):
            slug = url.rstrip("/").split("/")[-1]
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

    write_brand_json(
        "Fromm", WEBSITE_URL, products, output_dir,
        slug="fromm", ingredient_overrides=_INGREDIENT_OVERRIDES,
    )
    return len(products)
