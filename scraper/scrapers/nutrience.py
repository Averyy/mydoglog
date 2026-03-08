"""Nutrience scraper.

Data source: WooCommerce Store API + WordPress HTML.
- Discovery: WC Store API at /wp-json/wc/store/v1/products (public, no auth)
  - Returns product names, URLs, images, attributes (pet type, food type, product line)
  - Filters to dog products via "Pet Type" attribute
- Detail: HTML page parse for ingredients, GA, calories, variants
- Ingredients: Accordion UI — p.title-acc "Ingredients" + div.inner sibling
- GA: HTML table — reuse parse_ga_html_table
- Calories: After GA table in standard format (also in API as attribute)
- SKU: "Available sizes" section with "SIZE (SKU-XXXXX)" format

Key notes:
- Product lines: SubZero, Infusion, Care, Original, Trattoria, Grain Free
- All retail channel
- Canadian brand (Rolf C. Hagen)
- Bilingual site — API returns English URLs only
- WP REST API (wp/v2) is blocked by Solid Security plugin, but WC Store API is public
"""

import logging
import re
from pathlib import Path

from bs4 import BeautifulSoup, Tag
from wafer import SyncSession

from .common import (
    GuaranteedAnalysis,
    Product,
    Variant,
    clean_text,
    normalize_calorie_content,
    parse_ga_html_table,
    write_brand_json,
)

logger = logging.getLogger(__name__)

WEBSITE_URL = "https://nutrience.com"

# WooCommerce Store API (public, no auth required)
_WC_STORE_API = f"{WEBSITE_URL}/wp-json/wc/store/v1/products"


def _get_wc_attribute(product: dict, name: str) -> str | None:
    """Get a WooCommerce product attribute value by name."""
    for attr in product.get("attributes", []):
        if attr.get("name", "").lower() == name.lower():
            terms = attr.get("terms", [])
            if terms:
                return terms[0].get("name", "")
    return None


def _fetch_dog_products(session: SyncSession) -> list[dict]:
    """Fetch dog food products from WooCommerce Store API.

    Returns list of WC product dicts filtered to dog products.
    The API is paginated (max 100 per page).
    """
    all_products: list[dict] = []
    page = 1

    while True:
        resp = session.get(f"{_WC_STORE_API}?per_page=100&page={page}")
        if not resp.ok:
            if page == 1:
                logger.warning(f"WC Store API returned {resp.status_code}")
            break
        products = resp.json()
        if not products:
            break
        all_products.extend(products)
        page += 1

    # Filter to dog products by "Pet Type" attribute or product name
    dog_products = []
    for p in all_products:
        pet_type = _get_wc_attribute(p, "Pet Type")
        if pet_type and "dog" in pet_type.lower():
            dog_products.append(p)
        elif not pet_type:
            # Some dog products (supplements, Trattoria toppers) lack Pet Type
            name = p.get("name", "").lower()
            if "dog" in name and "cat" not in name:
                dog_products.append(p)

    logger.info(
        f"WC Store API: {len(all_products)} total, {len(dog_products)} dog products"
    )
    return dog_products


def _detect_product_line(title: str, url: str) -> str | None:
    """Detect product line from title or URL."""
    combined = f"{title} {url}".lower()
    if "subzero" in combined or "sub zero" in combined or "sub-zero" in combined:
        return "SubZero"
    if "infusion" in combined:
        return "Infusion"
    if "care" in combined:
        return "Care"
    if "original" in combined:
        return "Original"
    if "trattoria" in combined:
        return "Trattoria"
    if "grain free" in combined or "grain-free" in combined:
        return "Grain Free"
    if "homestyle" in combined or "home style" in combined:
        return "Homestyle"
    if "limited ingredient" in combined or "limited-ingredient" in combined:
        return "SubZero"  # LID is part of SubZero line
    if "freeze-dried" in combined or "freeze dried" in combined:
        return "SubZero"  # Freeze-dried raw is part of SubZero line
    return None


def _detect_type(url: str, title: str) -> str:
    """Detect product type: food, treat, or supplement."""
    combined = f"{url} {title}".lower()
    if any(kw in combined for kw in ("treat", "chew", "antler", "biscuit", "jerky")):
        return "treat"
    if any(kw in combined for kw in ("topper", "supplement")):
        return "supplement"
    return "food"


def _detect_format(url: str, title: str) -> str:
    """Detect product format: dry or wet."""
    combined = f"{url} {title}".lower()
    if any(
        kw in combined
        for kw in ("wet", "pâté", "pate", "stew", "canned", "ragu", "topper")
    ):
        return "wet"
    return "dry"


def _parse_ingredients(soup: BeautifulSoup) -> str | None:
    """Extract ingredients from page.

    Nutrience uses an accordion UI: <p class="title-acc js-accordion">Ingredients</p>
    followed by <div class="inner"> containing the ingredient text.
    """
    # Primary: accordion structure (p.title-acc + div.inner sibling)
    for p_tag in soup.find_all("p", class_="title-acc"):
        if p_tag.get_text(strip=True).lower().startswith("ingredient"):
            inner_div = p_tag.find_next_sibling("div", class_="inner")
            if inner_div:
                # Ingredient text is typically in a <p> inside the inner div,
                # or directly as text content
                inner_p = inner_div.find("p")
                if inner_p:
                    ing_text = clean_text(inner_p.get_text(separator=" "))
                else:
                    ing_text = clean_text(inner_div.get_text(separator=" "))
                # Threshold of 2 allows single-ingredient treats like "Beef Liver"
                if len(ing_text) > 2:
                    return ing_text

    # Secondary: accordion without specific class — any element whose text
    # is exactly "Ingredients" followed by a div sibling
    for el in soup.find_all(["p", "div", "span"]):
        text = el.get_text(strip=True).lower()
        if text in ("ingredients", "ingredients:"):
            sibling = el.find_next_sibling("div")
            if sibling:
                inner_p = sibling.find("p")
                if inner_p:
                    ing_text = clean_text(inner_p.get_text(separator=" "))
                else:
                    ing_text = clean_text(sibling.get_text(separator=" "))
                if len(ing_text) > 2:
                    return ing_text

    # Tertiary: heading-based search (h2/h3/h4/strong/b)
    for heading in soup.find_all(["h2", "h3", "h4", "strong", "b"]):
        text = heading.get_text(strip=True).lower()
        if text in ("ingredients", "ingredients:"):
            sibling = heading.find_next_sibling()
            if sibling:
                ing_text = clean_text(sibling.get_text(separator=" "))
                if len(ing_text) > 2:
                    return ing_text

            parent = heading.parent
            if parent:
                full_text = parent.get_text(separator=" ")
                full_text = re.sub(
                    r"^ingredients?\s*:?\s*", "", full_text, flags=re.IGNORECASE
                ).strip()
                if len(full_text) > 2:
                    return clean_text(full_text)

    # Fallback: regex search in full page text
    full_text = soup.get_text(separator="\n")
    match = re.search(
        r"Ingredients:?\s*\n(.*?)(?:\nGuaranteed Analysis|\nFeeding|\n\n)",
        full_text,
        re.IGNORECASE | re.DOTALL,
    )
    if match:
        ing = clean_text(match.group(1))
        if len(ing) > 2:
            return ing

    return None


def _parse_ga(soup: BeautifulSoup) -> GuaranteedAnalysis | None:
    """Parse GA from HTML table."""
    for table in soup.find_all("table"):
        table_text = table.get_text().lower()
        if "crude protein" in table_text or "crude fat" in table_text:
            ga = parse_ga_html_table(str(table))
            if ga:
                return ga
    return None


def _parse_calorie_content(soup: BeautifulSoup) -> str | None:
    """Extract calorie content."""
    text = soup.get_text(separator=" ")
    cal_match = re.search(
        r"(\d[\d,]*)\s*kcal/kg.*?(\d+)\s*kcal/(?:cup|can)",
        text,
        re.IGNORECASE,
    )
    if cal_match:
        return normalize_calorie_content(cal_match.group(0))

    # Broader calorie search
    match = re.search(r"calorie.*?(\d[\d,]*\s*kcal.*?)(?:\n|$)", text, re.IGNORECASE)
    if match:
        result = normalize_calorie_content(match.group(1))
        if result:
            return result

    # Fallback: kcal/100g (e.g. milk replacer powder) — convert to kcal/kg
    match_100g = re.search(r"(\d[\d,]*)\s*kcal\s*/\s*100\s*g", text, re.IGNORECASE)
    if match_100g:
        kcal_per_kg = int(float(match_100g.group(1).replace(",", "")) * 10)
        return f"{kcal_per_kg} kcal/kg"

    return None


def _parse_variants(soup: BeautifulSoup) -> list[Variant]:
    """Parse size variants from 'Available sizes' section."""
    variants: list[Variant] = []
    text = soup.get_text()

    # Look for "Available in" or "Available sizes" section
    for pattern in [
        r"(?:Available (?:in|sizes?))[\s:]*\n?((?:.*(?:lb|kg|g|oz).*\n?)+)",
        r"(?:Size|Sizes?)[\s:]*\n?((?:.*(?:lb|kg|g|oz).*\n?)+)",
    ]:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            for line in match.group(1).split("\n"):
                line = line.strip()
                if not line:
                    continue

                # Skip lines that describe target dog weight, not product weight
                # e.g. "For dogs under 14 kg"
                if re.search(r"for\s+dogs?\s+(?:under|over|up\s+to)", line, re.IGNORECASE):
                    continue

                # Parse weight
                weight_match = re.search(r"(\d+\.?\d*)\s*(lb|kg|g|oz)", line, re.IGNORECASE)
                if not weight_match:
                    continue

                value = float(weight_match.group(1))
                unit = weight_match.group(2).lower()
                if unit == "kg":
                    size_kg = value
                elif unit == "g":
                    size_kg = value / 1000
                elif unit in ("lb", "lbs"):
                    size_kg = round(value / 2.20462, 2)
                elif unit == "oz":
                    size_kg = round(value / 35.274, 3)
                else:
                    continue

                variant: Variant = {
                    "size_kg": round(size_kg, 3),
                    "size_description": line.strip(),
                }

                # Check for SKU
                sku_match = re.search(r"SKU[:\s-]*([\w-]+)", line, re.IGNORECASE)
                if sku_match:
                    variant["sku"] = sku_match.group(1)

                variants.append(variant)
            break

    return variants


def _parse_images(soup: BeautifulSoup) -> list[str]:
    """Extract product images.

    Nutrience product pages use a swiper/slider with <img> tags inside
    .swiper-slide containers. We look for product packshot images from
    wp-content/uploads, filtering out logos, icons, and banner-sized images.
    We also check og:image as a fallback.
    """
    images: list[str] = []
    seen: set[str] = set()

    def _add_image(src: str) -> None:
        if not src or not isinstance(src, str):
            return
        if not src.startswith("http"):
            return
        # Skip logos, icons, tiny images
        if any(skip in src.lower() for skip in ("logo", "icon", "favicon")):
            return
        # Normalize: strip trailing size params for dedup but keep original
        normalized = src.split("?")[0].rstrip("/")
        if normalized not in seen:
            seen.add(normalized)
            images.append(src)

    # Primary: product images in swiper slides or product image containers
    for selector in [
        ".swiper-slide img",
        ".product-slider img",
        ".product-image img",
        ".product-images img",
        ".product-gallery img",
    ]:
        for img in soup.select(selector):
            src = img.get("data-src") or img.get("data-lazy-src") or img.get("src", "")
            if isinstance(src, str) and "wp-content/uploads" in src:
                _add_image(src)

    # Secondary: all wp-content/uploads images in main content area
    # that look like product photos (PNG/JPG with "Product-Image" or brand name)
    if not images:
        for img in soup.find_all("img"):
            src = img.get("data-src") or img.get("data-lazy-src") or img.get("src", "")
            if isinstance(src, str) and "wp-content/uploads" in src:
                # Prefer product packshot images over banners
                src_lower = src.lower()
                if "product-image" in src_lower or "product_image" in src_lower:
                    _add_image(src)
                elif any(ext in src_lower for ext in (".png", ".jpg", ".jpeg", ".webp")):
                    # Check dimensions hint in filename — skip very wide banners
                    banner_match = re.search(r"-(\d+)x(\d+)", src)
                    if banner_match:
                        w, h = int(banner_match.group(1)), int(banner_match.group(2))
                        if w > 3 * h:
                            continue  # Skip banner-ratio images
                    _add_image(src)

    # Fallback: og:image
    if not images:
        og_img = soup.find("meta", property="og:image")
        if og_img and isinstance(og_img, Tag):
            src = og_img.get("content", "")
            if isinstance(src, str):
                _add_image(src)

    return images


def _parse_product(
    url: str, html: str, wc_product: dict | None = None
) -> Product | None:
    """Parse a Nutrience product page.

    If wc_product is provided, uses API data for name, product line, food type,
    and images. HTML is still parsed for ingredients, GA, calories, and variants.
    """
    soup = BeautifulSoup(html, "lxml")

    # Name: prefer API title, fall back to h1
    if wc_product:
        name = clean_text(wc_product.get("name", ""))
    else:
        h1 = soup.find("h1")
        name = clean_text(h1.get_text()) if h1 else None
    if not name or len(name) < 3:
        return None

    # Product type + format: use API "Food Type" attribute for format hints,
    # but always use name-based detection for type (API attribute is too coarse —
    # supplements, treats, and toppers all show as "Dry Food" or similar)
    product_type = _detect_type(url, name)
    product_format = _detect_format(url, name)
    if wc_product:
        food_type = _get_wc_attribute(wc_product, "Food Type")
        if food_type:
            ft = food_type.lower()
            # API format hints are reliable for wet detection
            if any(kw in ft for kw in ("wet", "pate", "stew")):
                product_format = "wet"

    product: Product = {
        "name": name,
        "brand": "Nutrience",
        "url": url,
        "channel": "retail",
        "product_type": product_type,
        "product_format": product_format,
    }

    # Product line: prefer API "Product Line" attribute
    product_line = None
    if wc_product:
        product_line_attr = _get_wc_attribute(wc_product, "Product Line")
        if product_line_attr:
            product_line = product_line_attr
    if not product_line:
        product_line = _detect_product_line(name, url)
    if not product_line:
        title_tag = soup.find("title")
        if title_tag:
            product_line = _detect_product_line(title_tag.get_text(), url)
    if product_line:
        product["product_line"] = product_line

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

    variants = _parse_variants(soup)
    if variants:
        product["variants"] = variants

    # Always parse images from HTML — the HTML parser has banner filtering
    # (API images are often hero banners, not product packshots)
    images = _parse_images(soup)
    if images:
        product["images"] = images

    return product


def scrape_nutrience(output_dir: Path) -> int:
    """Scrape all Nutrience dog food products. Returns product count."""
    with SyncSession(rate_limit=1.0) as session:
        wc_products = _fetch_dog_products(session)

        products: list[Product] = []
        for i, wc_prod in enumerate(wc_products):
            url = wc_prod.get("permalink", "")
            if not url:
                continue
            url = url.rstrip("/")
            logger.info(f"  [{i + 1}/{len(wc_products)}] {url}")
            resp = session.get(url)
            if not resp.ok:
                logger.warning(f"Failed to fetch {url}: {resp.status_code}")
                continue

            product = _parse_product(url, resp.text, wc_product=wc_prod)
            if product:
                products.append(product)

    write_brand_json("Nutrience", WEBSITE_URL, products, output_dir, slug="nutrience")
    return len(products)
