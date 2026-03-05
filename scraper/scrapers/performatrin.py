"""Performatrin scraper (Pet Valu house brand).

Data source: petvalu.ca — server-rendered HTML (no __NEXT_DATA__).
- Discovery: Category listing pages (dog/dry-food, dog/wet-food, dog/treats)
- Detail: Product pages at petvalu.ca/product/{name}/{sku}
- Product detail tabs (Description, Ingredients, GA, Feeding) are rendered as
  hidden <div class="imported-html"> elements in tab order. No JS execution needed.

Key notes:
- Pet Valu house brand with sub-brands: Performatrin, Prime, Ultra, Naturel
- All retail channel
- Ingredients/GA/calorie data inside hidden tab divs with class "imported-html"
- GA is plain text with <br> separators, NOT HTML tables
- Calorie content appears at the bottom of the GA tab text

Known data gaps (verified 2026-03-01):
  The following 4 products lack calorie data on petvalu.ca AND petsupermarket.com
  (US equivalent). The manufacturer has not published calorie content for these
  recipes on any known source (DogFoodAdvisor, Amazon, retailer sites).
  - Performatrin Ultra Grain-Free Hillside Recipe Dog Food (FCM07191)
  - Performatrin Ultra Wholesome Grains Meadow Recipe Dog Food (FCM06327)
  - Performatrin Ultra Wholesome Grains Woodlands Recipe Dog Food (FCM06330)
  - Performatrin Ultra Wholesome Grains Woodlands Recipe Large Breed Adult (FCM06329)
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
    write_brand_json,
)

# GA label lookup — ordered with longer/more-specific patterns FIRST so that
# "omega-6 fatty acids" matches before "fat" does.
_GA_LABEL_MAP: list[tuple[str, str]] = [
    ("omega-6 fatty acid", "omega_6"),
    ("omega 6 fatty acid", "omega_6"),
    ("omega-6", "omega_6"),
    ("omega 6", "omega_6"),
    ("omega-3 fatty acid", "omega_3"),
    ("omega 3 fatty acid", "omega_3"),
    ("omega-3", "omega_3"),
    ("omega 3", "omega_3"),
    ("crude protein", "crude_protein"),
    ("crude fat", "crude_fat"),
    ("crude fiber", "crude_fiber"),
    ("crude fibre", "crude_fiber"),
    ("moisture", "moisture"),
    ("ash", "ash"),
    ("calcium", "calcium"),
    ("phosphorus", "phosphorus"),
    ("glucosamine", "glucosamine"),
    ("chondroitin", "chondroitin"),
    ("taurine", "taurine"),
    ("dha", "dha"),
    ("epa", "epa"),
    ("l-carnitine", "l_carnitine"),
]

logger = logging.getLogger(__name__)

WEBSITE_URL = "https://www.petvalu.ca"

_CATEGORY_URLS = [
    f"{WEBSITE_URL}/category/dog/dry-food/11001",
    f"{WEBSITE_URL}/category/dog/wet-food/11002",
    f"{WEBSITE_URL}/category/dog/treats/11003",
]


def _is_cat_product(url: str, title: str) -> bool:
    """Return True if this is a cat food product (should be excluded)."""
    combined = f"{url} {title}".lower()
    # Match "cat food" or "/cat-" in URL, but not "catch" or "catalog"
    if "cat food" in combined or "cat-food" in combined:
        return True
    if "/cat-" in url.lower() or "-cat-" in url.lower():
        return True
    # Check for "adult cat" or "kitten" patterns
    if re.search(r"\bcat\b", title, re.IGNORECASE):
        return True
    return False


def _fetch_product_urls(session: SyncSession) -> list[str]:
    """Discover Performatrin product URLs from PetValu category pages."""
    urls: set[str] = set()

    for cat_url in _CATEGORY_URLS:
        resp = session.get(cat_url)
        if not resp.ok:
            continue

        soup = BeautifulSoup(resp.text, "lxml")
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "/product/" in href and "performatrin" in href.lower():
                if not href.startswith("http"):
                    href = f"{WEBSITE_URL}{href}"
                urls.add(href.rstrip("/"))

            # Check link text for Performatrin
            link_text = a.get_text(strip=True).lower()
            if "performatrin" in link_text and "/product/" in href:
                if not href.startswith("http"):
                    href = f"{WEBSITE_URL}{href}"
                urls.add(href.rstrip("/"))

        # Try pagination
        for page_num in range(2, 20):
            page_url = f"{cat_url}?page={page_num}"
            resp = session.get(page_url)
            if not resp.ok:
                break

            has_new = False
            soup = BeautifulSoup(resp.text, "lxml")
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if "/product/" in href and "performatrin" in (href + a.get_text()).lower():
                    if not href.startswith("http"):
                        href = f"{WEBSITE_URL}{href}"
                    if href.rstrip("/") not in urls:
                        has_new = True
                    urls.add(href.rstrip("/"))

            if not has_new:
                break

    logger.info(f"Found {len(urls)} Performatrin product URLs")
    return sorted(urls)


def _detect_product_type(url: str, title: str) -> str:
    """Detect product type from URL and title keywords."""
    combined = f"{url} {title}".lower()
    wet_keywords = ["wet", "can", "stew", "pate", "paté", "gravy", "dinner"]
    if any(kw in combined for kw in wet_keywords):
        return "wet"
    if "treat" in combined:
        return "treats"
    return "dry"


def _detect_sub_brand(title: str) -> str | None:
    """Detect Performatrin sub-brand."""
    title_lower = title.lower()
    if "ultra" in title_lower:
        return "Performatrin Ultra"
    if "prime" in title_lower:
        return "Performatrin Prime"
    if "naturel" in title_lower or "naturals" in title_lower:
        return "Performatrin Naturals"
    return "Performatrin"


def _get_tab_content(soup: BeautifulSoup) -> dict[str, Tag]:
    """Map tab names to their corresponding imported-html content divs.

    PetValu renders product detail tabs as:
    - <nav> with <button> elements (tab names)
    - Sibling <div class="imported-html"> elements in matching order

    Returns dict like {"ingredients": Tag, "guaranteed analysis": Tag, ...}
    """
    tab_map: dict[str, Tag] = {}

    nav = soup.find("nav")
    if not nav:
        return tab_map

    buttons = nav.find_all("button")
    tab_names = [b.get_text(strip=True).lower() for b in buttons]

    imported_divs = soup.find_all("div", class_="imported-html")

    for i, name in enumerate(tab_names):
        if i < len(imported_divs):
            tab_map[name] = imported_divs[i]

    return tab_map


def _parse_ingredients(soup: BeautifulSoup) -> str | None:
    """Extract ingredients from the Ingredients tab content div."""
    tabs = _get_tab_content(soup)
    ing_div = tabs.get("ingredients")
    if not ing_div:
        return None

    ing_text = clean_text(ing_div.get_text(separator=" "))
    if len(ing_text) < 20:
        return None

    # Strip leading "Ingredients:" prefix if present
    ing_text = re.sub(
        r"^ingredients?\s*:?\s*", "", ing_text, flags=re.IGNORECASE
    ).strip()
    return ing_text


def _parse_ga(soup: BeautifulSoup) -> GuaranteedAnalysis | None:
    """Parse GA from the Guaranteed Analysis tab content div.

    PetValu renders GA as plain text lines separated by <br> tags inside <p>
    elements. Format examples:
        Crude Protein (min.) 25.0%
        Crude Fat (min.) 15.0%
        Crude Fibre (max.) 4.0%
        Moisture (max.) 10.0%
        Omega-6 Fatty Acids* (min.) 2.50%
    """
    tabs = _get_tab_content(soup)
    ga_div = tabs.get("guaranteed analysis")
    if not ga_div:
        return None

    # Get text with newline separators (respects <br> and <p> boundaries)
    text = ga_div.get_text(separator="\n")
    ga: dict[str, float] = {}

    # Pattern: "Label (min./max.) Value%" — handles asterisks, optional dots
    ga_line_re = re.compile(
        r"^([A-Za-z*()/ \-0-9]+?)\s*\(?(min\.?|max\.?)\)?\s+(\d+\.?\d*)\s*%",
        re.IGNORECASE,
    )

    for line in text.split("\n"):
        line = line.strip("* \t")
        if not line:
            continue

        m = ga_line_re.match(line)
        if not m:
            continue

        label_raw = m.group(1).strip("* ").lower()
        qualifier = m.group(2).lower().rstrip(".")  # "min" or "max"
        value = float(m.group(3))

        # Remove asterisks and extra whitespace from label
        label_raw = re.sub(r"\*", "", label_raw).strip()

        # Look up field base — ordered list ensures longer patterns match first
        field_base: str | None = None
        for pattern, field in _GA_LABEL_MAP:
            if pattern in label_raw:
                field_base = field
                break

        if not field_base:
            continue

        suffix = "_max" if qualifier == "max" else "_min"
        ga[f"{field_base}{suffix}"] = value

    return ga if ga else None  # type: ignore[return-value]


def _parse_calorie_content(soup: BeautifulSoup) -> str | None:
    """Extract calorie content from the Guaranteed Analysis tab.

    PetValu products may have:
    - "Calorie Content: 405 kcal/cup"  (dry food)
    - "Calorie Content: 319 kcal/can"  (wet food)
    - "3,456 kcal/kg; 345 kcal/cup"    (both formats)
    - Or just kcal/kg alone

    The calorie line appears at the bottom of the GA tab content div.
    """
    tabs = _get_tab_content(soup)
    ga_div = tabs.get("guaranteed analysis")
    if not ga_div:
        return None

    text = ga_div.get_text(separator="\n")

    # Look for calorie content line(s)
    parts: list[str] = []
    for line in text.split("\n"):
        line_lower = line.strip().lower()
        if "calorie" not in line_lower and "kcal" not in line_lower:
            continue

        # Try to extract kcal/kg
        kg_match = re.search(r"(\d[\d,]*)\s*kcal/kg", line, re.IGNORECASE)
        if kg_match:
            val = int(kg_match.group(1).replace(",", ""))
            parts.append(f"{val} kcal/kg")

        # Try to extract kcal/cup
        cup_match = re.search(r"(\d[\d,]*)\s*kcal/cup", line, re.IGNORECASE)
        if cup_match:
            val = int(cup_match.group(1).replace(",", ""))
            parts.append(f"{val} kcal/cup")

        # Try to extract kcal/can
        can_match = re.search(r"(\d[\d,]*)\s*kcal/can", line, re.IGNORECASE)
        if can_match:
            val = int(can_match.group(1).replace(",", ""))
            parts.append(f"{val} kcal/can")

    return ", ".join(parts) if parts else None


def _parse_images(soup: BeautifulSoup) -> list[str]:
    """Extract product images.

    Primary: og:image meta tag.
    Fallback: <link rel="preload" as="image"> pointing to pvimages CDN — some
    products are missing og:image but still have a preload link for the hero
    image.
    """
    images: list[str] = []
    og_img = soup.find("meta", property="og:image")
    if og_img and isinstance(og_img, Tag):
        src = og_img.get("content", "")
        if src and isinstance(src, str) and src.startswith("http"):
            images.append(src)

    if not images:
        # Fallback: look for preloaded product images from the PetValu CDN
        for link in soup.find_all("link", rel="preload"):
            if link.get("as") != "image":
                continue
            href = link.get("href", "")
            if isinstance(href, str) and "pvimages" in href:
                # Normalise: strip query params (sizing) and ensure https
                clean_url = re.sub(r"\?.*$", "", href)
                if clean_url.startswith("//"):
                    clean_url = f"https:{clean_url}"
                elif not clean_url.startswith("http"):
                    continue
                if clean_url not in images:
                    images.append(clean_url)

    return images


def _parse_product(url: str, html: str) -> Product | None:
    """Parse a Performatrin product page from PetValu."""
    soup = BeautifulSoup(html, "lxml")

    h1 = soup.find("h1")
    if not h1:
        return None
    name = clean_text(h1.get_text())
    if not name or len(name) < 3:
        return None

    # Filter out cat food products
    if _is_cat_product(url, name):
        logger.info(f"  Skipping cat product: {name}")
        return None

    product: Product = {
        "name": name,
        "brand": "Performatrin",
        "url": url,
        "channel": "retail",
        "product_type": _detect_product_type(url, name),
    }

    sub_brand = _detect_sub_brand(name)
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

    images = _parse_images(soup)
    if images:
        product["images"] = images

    return product


def scrape_performatrin(output_dir: Path) -> int:
    """Scrape all Performatrin dog food products. Returns product count."""
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

    write_brand_json(
        "Performatrin", WEBSITE_URL, products, output_dir, slug="performatrin"
    )
    return len(products)
