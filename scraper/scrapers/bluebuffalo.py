"""Blue Buffalo scraper.

Data source: Episerver CMS HTML.
- Listing: Canadian sitemap (sitemap.en-ca.xml) for product detail URLs
- Detail: HTML page parse — ingredients in `ingredientsJson` JS variable,
  GA/calories/AAFCO in JS template literals (window.guaranteedAnalysisHtml,
  window.feedingGuidelinesHtml), product name from h1 + Hero-info h3
- Product URL patterns:
  - /en-ca/dry-dog-food/{line}/{recipe}/
  - /en-ca/wet-dog-food/{line}/{recipe}/
  - /en-ca/dog-treats/{line}/{recipe}/

Key notes:
- Uses Canadian (en-ca) pages for Canadian formulations
- All retail channel
- Sub-brands: Life Protection, Wilderness, Basics, Freedom, True Solutions, etc.
- The GA table and feeding guidelines are NOT in the DOM — they're in JS
  template literals assigned to window.guaranteedAnalysisHtml and
  window.feedingGuidelinesHtml. We extract these strings and parse as HTML.
- Treats and some wet products lack feedingGuidelinesHtml entirely — calorie
  data is backfilled from PetSmart.com product pages as a fallback.
"""

import json
import logging
import re
from pathlib import Path
from xml.etree import ElementTree

from bs4 import BeautifulSoup, Tag
from wafer import SyncSession

from .common import (
    GuaranteedAnalysis,
    Product,
    chewy_ingredients_match,
    clean_text,
    normalize_calorie_content,
    parse_chewy_nutrition,
    parse_ga_html_table,
    search_chewy,
    write_brand_json,
)

logger = logging.getLogger(__name__)

WEBSITE_URL = "https://www.bluebuffalo.com"

# Canadian sitemap with all en-ca product URLs
_SITEMAP_URL = f"{WEBSITE_URL}/sitemap.en-ca.xml"

# Product URL prefixes for dog products
_DOG_PREFIXES = ("/en-ca/dry-dog-food/", "/en-ca/wet-dog-food/", "/en-ca/dog-treats/")


def _fetch_product_urls(session: SyncSession) -> list[str]:
    """Discover product URLs from Canadian sitemap."""
    urls: set[str] = set()

    # Try Canadian sitemap directly
    resp = session.get(_SITEMAP_URL)
    if resp.ok:
        try:
            root = ElementTree.fromstring(resp.text)
            ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
            for url_elem in root.findall(".//sm:url/sm:loc", ns):
                url = url_elem.text
                if not url:
                    continue
                # Filter to dog product detail pages
                path = url.replace(WEBSITE_URL, "")
                if any(path.startswith(prefix) for prefix in _DOG_PREFIXES):
                    # Must be a detail page (has sub-brand + recipe slug)
                    # e.g. /en-ca/dry-dog-food/life-protection-formula/chicken-brown-rice-recipe/
                    parts = [p for p in path.strip("/").split("/") if p]
                    if len(parts) >= 4:  # en-ca / dry-dog-food / line / recipe
                        urls.add(url.strip().rstrip("/"))
        except ElementTree.ParseError:
            pass

    # Fallback: try sitemap index
    if not urls:
        resp = session.get(f"{WEBSITE_URL}/sitemap.xml")
        if resp.ok:
            try:
                root = ElementTree.fromstring(resp.text)
                ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
                for sitemap in root.findall(".//sm:sitemap/sm:loc", ns):
                    loc = sitemap.text
                    if loc and "en-ca" in loc.lower():
                        sub_resp = session.get(loc.strip())
                        if sub_resp.ok:
                            try:
                                sub_root = ElementTree.fromstring(sub_resp.text)
                                for url_elem in sub_root.findall(
                                    ".//sm:url/sm:loc", ns
                                ):
                                    url = url_elem.text
                                    if not url:
                                        continue
                                    path = url.replace(WEBSITE_URL, "")
                                    if any(
                                        path.startswith(prefix)
                                        for prefix in _DOG_PREFIXES
                                    ):
                                        parts = [
                                            p
                                            for p in path.strip("/").split("/")
                                            if p
                                        ]
                                        if len(parts) >= 4:
                                            urls.add(url.strip().rstrip("/"))
                            except ElementTree.ParseError:
                                pass
            except ElementTree.ParseError:
                pass

    logger.info(f"Found {len(urls)} product URLs")
    return sorted(urls)


def _detect_sub_brand(title: str, url: str) -> str | None:
    """Detect Blue Buffalo sub-brand."""
    combined = f"{title} {url}".lower()
    if "wilderness" in combined:
        return "Wilderness"
    if "basics" in combined:
        return "Basics"
    if "freedom" in combined:
        return "Freedom"
    if "life protection" in combined or "lp " in combined:
        return "Life Protection"
    if "true solutions" in combined:
        return "True Solutions"
    if "divine" in combined:
        return "Divine Delights"
    if "tastefuls" in combined:
        return "Tastefuls"
    return None


def _detect_product_type(url: str, title: str) -> str:
    """Detect product type."""
    combined = f"{url} {title}".lower()
    if "/wet" in combined or "stew" in combined or "can " in combined:
        return "wet"
    if "/treats" in combined or "treat" in combined or "biscuit" in combined:
        return "treats"
    return "dry"


def _parse_json_ld(soup: BeautifulSoup) -> dict | None:
    """Extract product JSON-LD structured data."""
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            if isinstance(data, dict) and data.get("@type") == "Product":
                return data
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and item.get("@type") == "Product":
                        return item
        except json.JSONDecodeError:
            continue
    return None


_FRENCH_CHARS = re.compile(r"[àâéèêëïîôùûüçæœ]", re.IGNORECASE)


def _strip_french_duplicates(names: list[str]) -> list[str]:
    """Remove French-language duplicates from bilingual en-ca ingredient lists.

    Some Blue Buffalo en-ca pages embed both English and French ingredient lists
    in the ingredientsJson variable. The French entries (always in the second half)
    are detected by accented characters (àâéèêëïîôùûüçæœ) and truncated.

    Handles boundary entries where English and French are period-concatenated,
    e.g. "Oil of Rosemary. Bœuf désossé" → keeps "Oil of Rosemary".
    """
    if len(names) < 4:
        return names

    midpoint = len(names) // 2
    for i in range(midpoint, len(names)):
        if _FRENCH_CHARS.search(names[i]):
            result = names[:i]
            # Handle boundary: last English + first French joined by period
            boundary = names[i]
            if "." in boundary:
                parts = boundary.split(".")
                english = [p.strip() for p in parts if p.strip() and not _FRENCH_CHARS.search(p)]
                if english:
                    result.append(english[0])
            logger.debug(f"Stripped {len(names) - len(result)} French duplicates")
            return result

    return names


def _parse_ingredients_json(html: str) -> str | None:
    """Extract ingredients from the ingredientsJson JS variable embedded in page HTML."""
    match = re.search(r"ingredientsJson\s*=\s*(\{.*?\})\s*;", html, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
        ingredients = data.get("ingredients", [])
        if ingredients and isinstance(ingredients, list):
            names = [
                clean_text(ing.get("name", ""))
                for ing in ingredients
                if isinstance(ing, dict) and ing.get("name")
            ]
            names = _strip_french_duplicates(names)
            if names:
                return ", ".join(names)
    except (json.JSONDecodeError, TypeError):
        pass
    return None


def _strip_trailing_disclaimers(text: str) -> str:
    """Strip trailing product disclaimers from ingredient text."""
    # "This product may naturally change colour after opening"
    text = re.sub(
        r"\.\s*\n?\s*This [Pp]roduct [Mm]ay.*$", ".", text, flags=re.DOTALL
    )
    return text.strip().rstrip(".")


def _parse_ingredients(soup: BeautifulSoup, html: str) -> str | None:
    """Extract ingredients from page HTML."""
    # Primary: ingredientsJson JS variable (most reliable)
    result = _parse_ingredients_json(html)
    if result:
        return _strip_trailing_disclaimers(result)

    # Fallback: heading-based search
    for heading in soup.find_all(["h2", "h3", "h4", "strong", "b", "span", "div"]):
        text = heading.get_text(strip=True).lower()
        if text in ("ingredients", "ingredients:", "ingredient list"):
            sibling = heading.find_next_sibling()
            if sibling:
                ing_text = clean_text(sibling.get_text(separator=" "))
                if len(ing_text) > 20:
                    ing_text = re.sub(
                        r"^ingredients?\s*:?\s*", "", ing_text, flags=re.IGNORECASE
                    ).strip()
                    return _strip_trailing_disclaimers(ing_text)

    # Fallback: search page text
    full_text = soup.get_text(separator="\n")
    match = re.search(
        r"Ingredients?\s*:?\s*\n(.*?)(?:\nGuaranteed Analysis|\nCalorie|\nFeeding|\n\n)",
        full_text,
        re.IGNORECASE | re.DOTALL,
    )
    if match:
        ing = clean_text(match.group(1))
        if len(ing) > 20:
            return _strip_trailing_disclaimers(ing)

    return None


def _extract_js_template(html: str, var_name: str) -> str | None:
    """Extract HTML from a JS template literal like ``window.varName = `...`;``.

    Blue Buffalo embeds GA and feeding-guidelines HTML as JS template literals
    in a <script> block, not in the DOM.  The backtick-delimited string contains
    full HTML that we can parse with BeautifulSoup.
    """
    pattern = rf"window\.{re.escape(var_name)}\s*=\s*`(.*?)`"
    match = re.search(pattern, html, re.DOTALL)
    if match:
        return match.group(1)
    return None


def _parse_ga(html: str) -> GuaranteedAnalysis | None:
    """Parse GA from the window.guaranteedAnalysisHtml JS template literal."""
    ga_html = _extract_js_template(html, "guaranteedAnalysisHtml")
    if not ga_html:
        return None

    ga_soup = BeautifulSoup(ga_html, "lxml")
    table = ga_soup.find("table")
    if table:
        ga = parse_ga_html_table(str(table))
        if ga:
            return ga
    return None


def _parse_aafco_statement(html: str) -> str | None:
    """Extract AAFCO statement from the window.guaranteedAnalysisHtml template."""
    ga_html = _extract_js_template(html, "guaranteedAnalysisHtml")
    if not ga_html:
        return None

    ga_soup = BeautifulSoup(ga_html, "lxml")
    for p in ga_soup.find_all("p"):
        text = clean_text(p.get_text())
        if "aafco" in text.lower() and "formulated" in text.lower():
            return text
    return None


def _parse_calorie_content(html: str) -> str | None:
    """Extract calorie content from the window.feedingGuidelinesHtml template."""
    fg_html = _extract_js_template(html, "feedingGuidelinesHtml")
    if not fg_html:
        return None

    fg_soup = BeautifulSoup(fg_html, "lxml")
    text = fg_soup.get_text(separator=" ")
    cal_match = re.search(
        r"(\d[\d,]*)\s*kcals?/kg.*?(\d+)\s*kcals?/(?:cup|can)",
        text,
        re.IGNORECASE,
    )
    if cal_match:
        return normalize_calorie_content(cal_match.group(0))
    return None


def _parse_images(soup: BeautifulSoup) -> list[str]:
    """Extract product images from the Hero-image container.

    The og:image uses a small 200x200 'share-product-image' thumbnail.
    The actual product hero uses 'large-product-image' at ~1180x1300.
    """
    images: list[str] = []

    # Primary: Hero-image container has the full-size product image
    hero = soup.find("div", class_=lambda c: c and "Hero-image" in c)
    if hero:
        img = hero.find("img")
        if img:
            src = img.get("src", "")
            if src and isinstance(src, str):
                if not src.startswith("http"):
                    src = f"{WEBSITE_URL}{src}"
                images.append(src)
                return images

    # Fallback: any img with large-product-image in src
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if isinstance(src, str) and "large-product-image" in src:
            if not src.startswith("http"):
                src = f"{WEBSITE_URL}{src}"
            images.append(src)
            return images

    # Last resort: og:image (small but better than nothing)
    og_img = soup.find("meta", property="og:image")
    if og_img and isinstance(og_img, Tag):
        src = og_img.get("content", "")
        if src and isinstance(src, str) and src.startswith("http"):
            images.append(src)
    return images


def _build_product_name(soup: BeautifulSoup) -> str | None:
    """Build a unique product name from h1, Hero-info h3, and Hero-flag.

    Blue Buffalo pages have:
    - h1: product line (e.g., "Life Protection Formula")
    - h3 inside .Hero-info: recipe name (e.g., "Chicken and Brown Rice Recipe")
    - div.Hero-flag: audience qualifier (e.g., "Large Breed Adult Dog", "Puppy")

    The Hero-flag contains breed size and life stage info that differentiates
    otherwise identical h1+h3 combos. We include flag qualifiers (breed size
    and non-"Adult Dog" life stages) in the name to ensure uniqueness.

    Examples:
    - "Life Protection Formula Chicken and Brown Rice Recipe"
    - "Life Protection Formula Large Breed Chicken and Brown Rice Recipe"
    - "Life Protection Formula Small Breed Puppy Chicken and Brown Rice Recipe"
    """
    h1 = soup.find("h1")
    if not h1:
        return None
    line_name = clean_text(h1.get_text())
    if not line_name or len(line_name) < 3:
        return None

    # Find recipe name in Hero-info section
    hero_info = soup.find(class_="Hero-info")
    recipe_h3 = hero_info.find("h3") if hero_info else None
    recipe_name = clean_text(recipe_h3.get_text()) if recipe_h3 else None

    # Extract qualifier from Hero-flag (breed size + life stage)
    qualifier = _extract_name_qualifier(soup)

    parts = [line_name]
    if qualifier:
        parts.append(qualifier)
    if recipe_name:
        parts.append(recipe_name)
    name = " ".join(parts)
    if name.startswith("BLUE "):
        name = name[5:]
    return name


def _extract_name_qualifier(soup: BeautifulSoup) -> str | None:
    """Extract differentiating qualifier from the Hero-flag element.

    The Hero-flag contains breed size, life stage, and/or product form info
    that distinguishes products that share the same h1 + h3.  We include
    everything except the generic default "Adult Dog".

    Examples:
    - "Adult Dog"                -> None (default, not useful)
    - "Large Breed Adult Dog"    -> "Large Breed Adult Dog"
    - "Large Breed Puppy"        -> "Large Breed Puppy"
    - "Puppy"                    -> "Puppy"
    - "Senior Dog"               -> "Senior Dog"
    - "Small Breed Adult Dog"    -> "Small Breed Adult Dog"
    - "Jerky Cuts"               -> "Jerky Cuts"
    - "Premium Morsels"          -> "Premium Morsels"
    - "Soft-Baked Dog Treats"    -> "Soft-Baked Dog Treats"
    """
    hero_flag = soup.find(class_="Hero-flag")
    if not hero_flag:
        return None
    raw = clean_text(hero_flag.get_text())
    if not raw:
        return None

    # "Adult Dog" is the most common default — adds no information
    if raw.lower() in ("adult dog", "adult"):
        return None

    return raw


def _parse_life_stage(soup: BeautifulSoup) -> str | None:
    """Extract life stage from the Hero-flag element (e.g., 'Adult Dog', 'Puppy')."""
    hero_flag = soup.find(class_="Hero-flag")
    if not hero_flag:
        return None
    text = clean_text(hero_flag.get_text()).lower()
    if "puppy" in text:
        return "puppy"
    if "senior" in text:
        return "senior"
    if "adult" in text:
        return "adult"
    if "all life" in text or "all stage" in text:
        return "all_life_stages"
    return None


def _parse_product(url: str, html: str) -> Product | None:
    """Parse a Blue Buffalo product page."""
    soup = BeautifulSoup(html, "lxml")

    name = _build_product_name(soup)
    if not name:
        return None

    product_type = _detect_product_type(url, name)

    # Append product form to wet food names to distinguish from dry counterparts
    # (many recipes exist in both dry and wet versions with identical page titles)
    if product_type == "wet":
        name = f"{name} Wet Food"

    product: Product = {
        "name": name,
        "brand": "Blue Buffalo",
        "url": url,
        "channel": "retail",
        "product_type": product_type,
    }

    sub_brand = _detect_sub_brand(name, url)
    if sub_brand:
        product["sub_brand"] = sub_brand

    life_stage = _parse_life_stage(soup)
    if life_stage:
        product["life_stage"] = life_stage

    ingredients = _parse_ingredients(soup, html)
    if ingredients:
        product["ingredients_raw"] = ingredients

    ga = _parse_ga(html)
    if ga:
        product["guaranteed_analysis"] = ga
        product["guaranteed_analysis_basis"] = "as-fed"

    cal = _parse_calorie_content(html)
    if cal:
        product["calorie_content"] = cal

    aafco = _parse_aafco_statement(html)
    if aafco:
        product["aafco_statement"] = aafco

    images = _parse_images(soup)
    if images:
        product["images"] = images

    return product


def _build_bb_chewy_query(product: Product) -> str:
    """Build a Chewy search query for a Blue Buffalo product.

    Uses the product URL slug (last path segment) which contains the recipe
    name in hyphenated form, e.g. "chicken-stix" → "blue buffalo chicken stix".
    Special case: "Delights" → search as "blue buffalo divine delights {rest}".
    """
    url = product["url"]
    name = product["name"].lower()

    # Extract the last slug from the URL path
    path = url.replace(WEBSITE_URL, "").strip("/")
    slug = path.split("/")[-1] if "/" in path else path
    query_part = slug.replace("-", " ")

    # Special case: Divine Delights products
    if "delights" in name or "delights" in query_part:
        return f"blue buffalo divine delights {query_part}".strip()

    return f"blue buffalo {query_part}"


# Seasonal/limited products known to be unfindable on Chewy
_BB_CHEWY_SKIP_KEYWORDS = ["Santa Snacks", "Boo Bars", "Boo Bits"]


def _fill_missing_from_chewy(
    products: list[Product], session: SyncSession
) -> int:
    """Fill missing calorie content from Chewy.com product pages.

    Performs ingredient safety check before accepting Chewy data.
    Skips known seasonal/unfillable products.

    Returns the number of products successfully filled.
    """
    missing = [p for p in products if "calorie_content" not in p]
    if not missing:
        return 0

    logger.info(f"Chewy fallback: {len(missing)} products missing calories")
    filled = 0

    for i, product in enumerate(missing):
        # Skip known unfillable seasonal products
        if any(k in product["name"] for k in _BB_CHEWY_SKIP_KEYWORDS):
            logger.debug(f"    Skipping seasonal: {product['name'][:50]}")
            continue

        query = _build_bb_chewy_query(product)
        logger.info(f"  Chewy [{i + 1}/{len(missing)}] {product['name'][:50]}...")

        product_url = search_chewy(query, session)
        if not product_url:
            logger.debug(f"    Not found on Chewy: {query}")
            continue

        try:
            resp = session.get(product_url)
        except Exception:
            logger.debug(f"    Failed to fetch Chewy page: {product_url}")
            continue

        if not resp.ok:
            logger.debug(f"    Chewy returned {resp.status_code}")
            continue

        nutrition = parse_chewy_nutrition(resp.text)
        if not nutrition.get("calorie_content"):
            logger.debug(f"    No calorie data on Chewy page")
            continue

        # Safety check: verify ingredients match if we have them
        if product.get("ingredients_raw") and nutrition.get("ingredients"):
            if not chewy_ingredients_match(
                product["ingredients_raw"], nutrition["ingredients"]
            ):
                logger.warning(
                    f"    Ingredient mismatch — skipping: {product['name'][:50]}"
                )
                continue

        product["calorie_content"] = nutrition["calorie_content"]
        logger.info(f"    Chewy: {nutrition['calorie_content']}")
        filled += 1

    logger.info(f"Chewy fallback filled {filled}/{len(missing)} products")
    return filled


def scrape_bluebuffalo(output_dir: Path) -> int:
    """Scrape all Blue Buffalo dog food products. Returns product count."""
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

    # Chewy fallback for missing calories
    from wafer.browser import BrowserSolver

    solver = BrowserSolver(headless=True, idle_timeout=60.0)
    with SyncSession(
        rate_limit=1.0, browser_solver=solver, cache_dir=".chewy_cookies"
    ) as chewy_session:
        _fill_missing_from_chewy(products, chewy_session)

    write_brand_json(
        "Blue Buffalo", WEBSITE_URL, products, output_dir, slug="bluebuffalo"
    )
    return len(products)
