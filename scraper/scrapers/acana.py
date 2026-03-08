"""Acana & Orijen scraper.

Data source: Champion Petfoods websites (Salesforce Commerce Cloud / Demandware).
- Acana: acana.com/en-CA/dogs/dog-food/
- Orijen: orijenpetfoods.com/en-CA/dogs/dog-food/
- Images: demandware CDN — strip ?sw= params for full resolution

Key notes:
- Same parent company (Champion Petfoods)
- Salesforce Commerce Cloud (Demandware)
- All retail channel
- Product pages have ingredients, GA, calories, and full-res images
"""

import json
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

WEBSITE_URLS = {
    "acana": "https://www.acana.com",
    "orijen": "https://www.orijenpetfoods.com",
}

# Demandware Search-UpdateGrid API endpoints for full product listings.
# Using sz=200 to get all products in a single request.
_SEARCH_API = {
    "acana": "/on/demandware.store/Sites-acana_na-Site/en_CA/Search-UpdateGrid?cgid=dogs&prefn1=region&prefv1=CA&start=0&sz=200",
    "orijen": "/on/demandware.store/Sites-orijen_na-Site/en_CA/Search-UpdateGrid?cgid=dogs&prefn1=region&prefv1=CA&start=0&sz=200",
}


def _fetch_product_urls_from_site(
    session: SyncSession, brand: str, base_url: str
) -> list[str]:
    """Discover product URLs via the Demandware Search-UpdateGrid API.

    The category pages use a "More Results" button that calls this API
    for pagination. We request all products at once with a large sz param.
    """
    urls: set[str] = set()

    api_path = _SEARCH_API.get(brand)
    if not api_path:
        return []

    api_url = f"{base_url}{api_path}"
    resp = session.get(api_url)
    if not resp.ok:
        logger.warning(f"  Search API returned {resp.status_code} for {brand}")
        return []

    soup = BeautifulSoup(resp.text, "lxml")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.endswith(".html") and ("/dog-food/" in href or "/dog-treats/" in href):
            if not href.startswith("http"):
                href = f"{base_url}{href}"
            urls.add(href)

    return sorted(urls)




def _truncate_ingredients(text: str) -> str:
    """Truncate ingredient text at known boundary markers.

    Acana/Orijen pages often have the ingredient list followed by calorie
    content, AAFCO statements, and GA data in the same container. We cut
    at the first boundary marker.
    """
    boundary_patterns = [
        r"\nCALORIE CONTENT",
        r"\(ME CALCULATED\)",  # sometimes on same line as last ingredient
        r"\(ME calculated\)",
        r"\nME [\(c]",  # "ME CALCULATED" or "ME (calculated)" on own line
        r"\nMETABOLIZABLE ENERGY",
        r"\nMetabolizable Energy",
        r"\nAnalytical Constituents",
        r"\nGuaranteed Analysis",
        r"\nADDITIVES",  # EU-format additive sections
        r"\n\*Approximate",
        r"\n\+we also add",
        r"\nCrude protein",
        r"\nCrude fat",
        r"\n.*?is formulated to meet",
        r"\n.*?Dog Food Nutrient Profiles",
    ]
    for pattern in boundary_patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            text = text[: m.start()]
    # Strip EU-format percentage declarations from ingredient names
    # e.g., "beef meal (7%)" → "beef meal", "raw salmon (13%)" → "raw salmon"
    # If the source has "eggs (5%) whole lentils" (missing comma), ensure we
    # insert a comma so ingredients don't get concatenated after stripping.
    text = re.sub(r"\s*\(\d+\.?\d*%\)\s*(?!,|$|\)|\.|$)", ", ", text)
    text = re.sub(r"\s*\(\d+\.?\d*%\)", "", text)
    # Clean up any double commas from above
    text = re.sub(r",\s*,", ",", text)
    return text.strip().rstrip(".")


def _parse_ingredients(soup: BeautifulSoup) -> str | None:
    """Extract ingredients from an Acana/Orijen product page.

    The pages use an "Ingredients & Analysis" section where a <div> sibling
    contains both the ingredient list and the GA/calorie data. We extract
    the text and truncate at known boundary markers.

    The ingredient text often starts with "Composition\\n" which we strip.
    """
    # --- Primary: "Ingredients & Analysis" heading + sibling div ---
    for heading in soup.find_all(["h2", "h3", "h4"]):
        text = heading.get_text(strip=True).lower()
        if "ingredient" in text:
            sibling = heading.find_next_sibling("div")
            if sibling:
                raw = sibling.get_text(separator="\n")
                raw = _truncate_ingredients(raw)
                # Strip "Composition" header
                raw = re.sub(
                    r"^(?:Composition|Ingredients?)\s*:?\s*\n?",
                    "",
                    raw,
                    flags=re.IGNORECASE,
                ).strip()
                # Collapse newlines to spaces — Acana pages have <br> tags
                # mid-ingredient (e.g., "fresh whole\npumpkin")
                raw = raw.replace("\n", " ")
                ing_text = clean_text(raw)
                if len(ing_text) > 20:
                    return ing_text

    # --- Fallback: heading + any sibling ---
    for heading in soup.find_all(["h2", "h3", "h4", "strong", "span"]):
        text = heading.get_text(strip=True).lower()
        if "ingredient" in text:
            sibling = heading.find_next_sibling()
            if sibling:
                raw = sibling.get_text(separator="\n")
                raw = _truncate_ingredients(raw)
                raw = re.sub(
                    r"^(?:Composition|Ingredients?)\s*:?\s*\n?",
                    "",
                    raw,
                    flags=re.IGNORECASE,
                ).strip()
                raw = raw.replace("\n", " ")
                ing_text = clean_text(raw)
                if len(ing_text) > 20 and not ing_text.startswith("http"):
                    return ing_text

    # --- Last resort: regex over full page text ---
    full_text = soup.get_text(separator="\n")
    match = re.search(
        r"(?:Composition|Ingredients?)\s*:?\s*\n(.*?)(?:\nGuaranteed|\nCALORIE|\nME |\nAnalytical|$)",
        full_text,
        re.IGNORECASE | re.DOTALL,
    )
    if match:
        ing = clean_text(match.group(1).replace("\n", " "))
        if len(ing) > 20:
            return ing
    return None


def _parse_ga(soup: BeautifulSoup) -> GuaranteedAnalysis | None:
    """Parse GA from HTML table or analysis list.

    Acana/Orijen pages use two formats:
    - Master product pages: <table> with GA rows (rare on acana.com)
    - SKU pages: <div class="analysis"> with <ul>/<li> items
    """
    # Strategy 1: HTML table
    for table in soup.find_all("table"):
        table_text = table.get_text().lower()
        if "crude protein" in table_text or "crude fat" in table_text:
            return parse_ga_html_table(str(table))

    # Strategy 2: <div class="analysis"> with <ul>/<li>
    # Two formats exist:
    #   Wet/pâté: "Crude protein (min.)  8%" — has qualifier
    #   Dry/kibble: "Crude protein  29%" — no qualifier
    #   Dry also uses "Fat content" instead of "Crude fat"
    analysis_div = soup.find("div", class_="analysis")
    if analysis_div:
        ga: GuaranteedAnalysis = {}
        for li in analysis_div.find_all("li"):
            li_text = li.get_text(strip=True)
            if not li_text:
                continue
            # Extract nutrient name and percentage value
            m = re.match(
                r"(.+?)\s*(?:\((?:min|max)\.?\))?\s*(\d+\.?\d*)\s*%",
                li_text,
                re.IGNORECASE,
            )
            if not m:
                continue
            nutrient = clean_text(m.group(1)).lower()
            value = float(m.group(2))
            # Determine qualifier from text or infer from nutrient type
            if "(min" in li_text.lower():
                qualifier = "min"
            elif "(max" in li_text.lower():
                qualifier = "max"
            elif "moisture" in nutrient or "fiber" in nutrient or "fibre" in nutrient or "ash" in nutrient:
                qualifier = "max"
            else:
                qualifier = "min"

            entry = {"value": value, "unit": "%", "qualifier": qualifier}
            if "crude protein" in nutrient or nutrient == "protein":
                ga["crude_protein"] = entry
            elif nutrient in ("crude fat", "fat content", "fat"):
                ga["crude_fat"] = entry
            elif "crude fiber" in nutrient or "crude fibre" in nutrient:
                ga["crude_fiber"] = entry
            elif "moisture" in nutrient:
                ga["moisture"] = entry
        if ga:
            return ga

    return None


def _parse_calorie_content(soup: BeautifulSoup) -> str | None:
    """Extract calorie content.

    Handles homesalive.ca formats:
    - ``3,493 kcal/kg, 419 kcal/cup``
    - ``3,790 kcal/kg, 455 kcal/ 120g cup``   (space + weight before cup)
    - ``1,069 kcal/kg, 388 cal/can``           (cal not kcal)
    - ``3,405 mg/kg, 409 kcal/120 g cup``      (mg/kg typo)
    """
    text = soup.get_text(separator=" ")
    # Broad match: number + unit/kg … number + unit/cup-or-can-or-treat
    # The optional prefix before "cup" handles "120g cup", "1/4 cup", etc.
    cal_match = re.search(
        r"(\d[\d,]*)\s*(?:kcal|cal|mg)/kg"
        r".*?"
        r"(\d+)\s*(?:kcal|cal)/\s*(?:[\d/]+\s*g?\s*)?(?:cup|can|treat)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if cal_match:
        return normalize_calorie_content(cal_match.group(0))

    # Alternate format: "3510 kcal/kg (421 kcal per 250ml/120g cup)"
    # or: "1127 kcal/kg ( 409 Kcal per 363 g)"
    cal_match = re.search(
        r"(\d[\d,]*)\s*kcal/kg\s*\(\s*(\d+)\s*kcal\s+per\s+[^)]*\)",
        text,
        re.IGNORECASE,
    )
    if cal_match:
        return normalize_calorie_content(cal_match.group(0))

    # Treat format: "5520 kcal/kg or 5 kcal per individual treat"
    cal_match = re.search(
        r"(\d[\d,]*)\s*kcal/kg\s+or\s+(\d+)\s*kcal\s+per\s+(?:\w+\s+)?treat",
        text,
        re.IGNORECASE,
    )
    if cal_match:
        return normalize_calorie_content(cal_match.group(0))
    return None


# Sub-brand detection: map keywords in the product name to sub-brand labels
_ACANA_SUB_BRANDS: list[tuple[str, str]] = [
    ("singles limited ingredient", "Singles"),
    ("singles", "Singles"),
    ("healthy grains", "Healthy Grains"),
    ("highest protein", "Highest Protein"),
    ("classics", "Classics"),
    ("premium chunks", "Premium Chunks"),
    ("premium pâté", "Premium Pâté"),
    ("premium pate", "Premium Pâté"),
    ("bone broth infused", "Bone Broth Infused"),
    ("chewy strips", "Chewy Strips"),
    ("light & fit", "Light & Fit"),
    ("light and fit", "Light & Fit"),
    ("sport & agility", "Sport & Agility"),
    ("sport and agility", "Sport & Agility"),
]

_ORIJEN_SUB_BRANDS: list[tuple[str, str]] = [
    ("amazing grains", "Amazing Grains"),
    ("freeze-dried", "Freeze-Dried"),
    ("freeze dried", "Freeze-Dried"),
    ("fit & trim", "Fit & Trim"),
    ("fit and trim", "Fit & Trim"),
]


def _detect_sub_brand(name: str, brand: str) -> str | None:
    """Detect sub-brand from product name."""
    name_lower = name.lower()
    table = _ACANA_SUB_BRANDS if brand == "acana" else _ORIJEN_SUB_BRANDS
    for keyword, sub_brand in table:
        if keyword in name_lower:
            return sub_brand
    return None


def _detect_type(url: str, name: str) -> str:
    """Detect product type: food or treat."""
    combined = f"{url} {name}".lower()
    if "treat" in combined or "snack" in combined:
        return "treat"
    return "food"


def _detect_format(url: str, name: str) -> str:
    """Detect product format: dry or wet."""
    combined = f"{url} {name}".lower()
    if (
        "wet" in combined
        or "stew" in combined
        or "canned" in combined
        or re.search(r"\bcan\b", combined)
        or "pâté" in combined
        or "pate" in combined
        or "chunks" in combined
    ):
        return "wet"
    return "dry"


def _parse_images(soup: BeautifulSoup) -> list[str]:
    """Extract product images from Demandware pages.

    Images may be in:
    - <img> tags with demandware.static src (with ?sw= resize params)
    - Zoom container divs with background-image style URLs
    - og:image meta tag

    Always strip ?sw= query params to get full-resolution originals.
    """
    images: list[str] = []

    # Strategy 1: <img> tags with demandware product catalog URLs
    # Product images use "master-catalog" path; site assets use "Library"
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if isinstance(src, str) and "demandware.static" in src and "master-catalog" in src:
            src = src.split("?")[0]
            if src not in images:
                images.append(src)
                return images

    # Strategy 1b: dw/image/v2 URLs (alternate CDN path for product images)
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if isinstance(src, str) and "dw/image/v2/" in src:
            src = src.split("?")[0]
            if src not in images:
                images.append(src)
                return images

    # Strategy 2: zoom container background-image (Orijen uses this)
    for div in soup.find_all("div", class_="zoomWindow"):
        style = div.get("style", "")
        m = re.search(r'url\(["\']?(https?://[^"\')\s]+)["\']?\)', style)
        if m:
            src = m.group(1).split("?")[0]
            if src not in images:
                images.append(src)
                return images

    # Strategy 2b: any element with background-image containing master-catalog
    for tag in soup.find_all(style=True):
        style = tag.get("style", "")
        if "master-catalog" in style:
            m = re.search(r'url\(["\']?(https?://[^"\')\s]+)["\']?\)', style)
            if m:
                src = m.group(1).split("?")[0]
                if src not in images:
                    images.append(src)
                    return images

    # Strategy 3: og:image (strip resize params)
    og_img = soup.find("meta", property="og:image")
    if og_img and isinstance(og_img, Tag):
        src = og_img.get("content", "")
        if src and isinstance(src, str) and src.startswith("http"):
            src = src.split("?")[0]
            images.append(src)
    return images


def _get_canonical_url(soup: BeautifulSoup, base_url: str) -> str | None:
    """Extract canonical URL from a product page.

    Demandware master pages link to SKU-specific canonical URLs that contain
    the full nutritional data (GA, calories) not present on the master page.
    """
    link = soup.find("link", rel="canonical")
    if link and isinstance(link, Tag):
        href = link.get("href", "")
        if isinstance(href, str) and href:
            if href.startswith("/"):
                return f"{base_url}{href}"
            if href.startswith("http"):
                return href
    return None


def _parse_product(
    url: str, html: str, brand: str, session: SyncSession, base_url: str
) -> Product | None:
    """Parse a product page."""
    soup = BeautifulSoup(html, "lxml")

    h1 = soup.find("h1")
    if not h1:
        return None
    name = clean_text(h1.get_text())
    if not name or len(name) < 3:
        return None

    # Strip "ACANA " brand prefix (case-insensitive)
    if name.upper().startswith("ACANA "):
        name = name[6:].lstrip()

    product: Product = {
        "name": name,
        "brand": brand.title(),
        "url": url,
        "channel": "retail",
        "product_type": _detect_type(url, name),
        "product_format": _detect_format(url, name),
    }

    sub_brand = _detect_sub_brand(name, brand)
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

    # If GA or calories missing, try the canonical (SKU) URL which has full data
    if not ga or not cal:
        canonical = _get_canonical_url(soup, base_url)
        if canonical and canonical != url:
            logger.info(f"    Fetching canonical URL for GA/calories: {canonical}")
            resp = session.get(canonical)
            if resp.ok:
                sku_soup = BeautifulSoup(resp.text, "lxml")
                if not ga:
                    ga = _parse_ga(sku_soup)
                    if ga:
                        product["guaranteed_analysis"] = ga
                        product["guaranteed_analysis_basis"] = "as-fed"
                if not cal:
                    cal = _parse_calorie_content(sku_soup)
                    if cal:
                        product["calorie_content"] = cal

    images = _parse_images(soup)
    if images:
        product["images"] = images

    return product


def scrape_acana(output_dir: Path) -> int:
    """Scrape all Acana + Orijen dog food products. Returns product count."""
    all_products: list[Product] = []

    with SyncSession(rate_limit=1.0) as session:
        for brand, base_url in WEBSITE_URLS.items():
            logger.info(f"Scraping {brand.title()} from {base_url}...")

            urls = _fetch_product_urls_from_site(session, brand, base_url)
            logger.info(f"  Found {len(urls)} product URLs")

            for i, url in enumerate(urls):
                logger.info(f"  [{i + 1}/{len(urls)}] {url}")
                resp = session.get(url)
                if not resp.ok:
                    logger.warning(f"  Failed: {resp.status_code}")
                    continue
                product = _parse_product(url, resp.text, brand, session, base_url)
                if product:
                    all_products.append(product)

    write_brand_json(
        "Champion Petfoods",
        "https://www.championpetfoods.com",
        all_products,
        output_dir,
        slug="acana",
    )
    return len(all_products)
