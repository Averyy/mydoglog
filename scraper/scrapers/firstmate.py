"""FirstMate scraper.

Data source: WordPress REST API + WooCommerce HTML.
- Listing: GET /wp-json/wp/v2/product?per_page=100 → filter by product_cat=18 (Dog Food)
- Images: GET /wp-json/wp/v2/media/{id} → source_url (original upload)
- Detail: HTML page parse for nutritional data
- Ingredients: <ul class="product-ingredients-list"> with <a> links per ingredient
- GA: 4-column HTML table (label | value | label | value)
- Calories: colspan=4 row in GA table ("ME (calculated): X kcal/kg | Y kcal/cup")
- AAFCO: <div class="product__guidelines__box">

Key notes:
- Sub-brands: FirstMate (standard), KASIKS (wild-caught/free-range premium)
- Product types from WP categories: canned (cat 16), treats (cat 201), grain-free (14),
  grain-friendly (15)
- All retail channel
- Many product images are 600x600 native uploads — this is FirstMate's max resolution
"""

import html as html_mod
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

WEBSITE_URL = "https://firstmate.com"

# WP REST API endpoints
_PRODUCTS_API = f"{WEBSITE_URL}/wp-json/wp/v2/product"
_MEDIA_API = f"{WEBSITE_URL}/wp-json/wp/v2/media"

# WP product_cat taxonomy IDs
_DOG_FOOD_CAT = 18
_CANNED_CAT = 16
_TREATS_CAT = 201


def _fetch_dog_products(
    session: SyncSession,
) -> list[tuple[str, str | None, dict]]:
    """Fetch dog food product URLs and image URLs from WP REST API.

    Returns list of (product_url, image_url, wp_product) tuples.
    Filters to products in the Dog Food category (product_cat=18).
    """
    # Fetch all products from WP REST API (paginated)
    all_products: list[dict] = []
    page = 1
    while True:
        resp = session.get(f"{_PRODUCTS_API}?per_page=100&page={page}")
        if not resp.ok:
            break
        products = resp.json()
        if not products:
            break
        all_products.extend(products)
        page += 1

    # Filter to dog food category
    dog_products = [p for p in all_products if _DOG_FOOD_CAT in p.get("product_cat", [])]
    logger.info(f"WP API: {len(all_products)} total, {len(dog_products)} dog food products")

    # Batch-fetch media for featured images
    media_ids = list(set(
        p["featured_media"] for p in dog_products if p.get("featured_media")
    ))
    media_map: dict[int, str] = {}
    for i in range(0, len(media_ids), 50):
        batch = media_ids[i : i + 50]
        ids_str = ",".join(str(mid) for mid in batch)
        resp = session.get(f"{_MEDIA_API}?include={ids_str}&per_page=100")
        if resp.ok:
            for m in resp.json():
                media_map[m["id"]] = m.get("source_url", "")

    results: list[tuple[str, str | None, dict]] = []
    for p in dog_products:
        url = p.get("link", "")
        if not url:
            continue
        img_url = media_map.get(p.get("featured_media", 0))
        results.append((url, img_url or None, p))

    return results



def _detect_sub_brand(url: str, title: str) -> str | None:
    """Detect sub-brand from URL or title."""
    combined = f"{url} {title}".lower()
    if "kasiks" in combined:
        return "KASIKS"
    return "FirstMate"


def _detect_product_type(url: str, title: str, wp_cats: list[int] | None = None) -> str:
    """Detect product type from WP categories, URL, or title."""
    # Prefer WP category data
    if wp_cats:
        if _CANNED_CAT in wp_cats:
            return "wet"
        if _TREATS_CAT in wp_cats:
            return "treats"

    url_lower = url.lower()
    title_lower = title.lower()

    # Canned/wet detection: check for can counts, oz sizes, and canned keywords
    if any(kw in url_lower for kw in ["/canned/", "canned"]):
        return "wet"
    if any(kw in title_lower for kw in ["12.2oz", "5.5oz", "3.2oz", "3oz"]):
        return "wet"
    if re.search(r"\d+\s*cans?\b", title_lower):
        return "wet"

    # Treats
    if "/treats/" in url_lower or "treat" in title_lower:
        return "treats"

    return "dry"


def _parse_ingredients(soup: BeautifulSoup) -> str | None:
    """Extract ingredients from the product-ingredients-list.

    FirstMate uses <ul class="product-ingredients-list list-ingredients"> with
    each ingredient as an <a> tag (with data-title/data-content for tooltips).
    Sub-ingredients (minerals, vitamins) are nested in <ul> inside
    <li class="sub-ingredient parent--XX">.
    """
    # Target the specific ingredient list by class name
    ing_list = soup.find("ul", class_="product-ingredients-list")
    if not ing_list:
        # Fallback: look for the ingredient tab pane
        ing_pane = soup.find("div", id="ingredients")
        if ing_pane:
            ing_list = ing_pane.find("ul")
    if not ing_list:
        return None

    ingredients: list[str] = []
    seen_sub_parents: set[str] = set()

    for li in ing_list.find_all("li", recursive=False):
        # Check if this is a sub-ingredient parent wrapper
        sub_list = li.find("ul")
        if sub_list:
            # This li contains a nested <ul> of sub-ingredients (e.g., minerals, vitamins)
            # The sub-ingredients are the actual items; skip the parent label
            sub_items: list[str] = []
            for sub_li in sub_list.find_all("li"):
                a_tag = sub_li.find("a")
                if a_tag:
                    text = clean_text(a_tag.get_text())
                else:
                    text = clean_text(sub_li.get_text())
                # Strip leading/trailing parens that wrap the group
                text = text.strip("() ")
                if text:
                    sub_items.append(text)
            if sub_items:
                ingredients.extend(sub_items)
            continue

        # Check if this is a sub-ingredient li (nested under a parent)
        classes = li.get("class", [])
        if any("sub-ingredient" in c for c in classes):
            # These are handled by the parent's sub_list traversal above
            continue

        # Regular ingredient: get text from <a> tag or direct text
        a_tag = li.find("a")
        if a_tag:
            text = clean_text(a_tag.get_text())
        else:
            span = li.find("span")
            if span:
                text = clean_text(span.get_text())
            else:
                text = clean_text(li.get_text())

        # Skip category labels like "Minerals", "Vitamins"
        if text and text.lower() not in ("minerals", "vitamins"):
            if len(text) < 200:
                ingredients.append(text)

    if ingredients:
        return ", ".join(ingredients)
    return None


def _parse_ga(soup: BeautifulSoup) -> tuple[GuaranteedAnalysis | None, str | None]:
    """Parse GA from 4-column HTML table. Returns (ga, calorie_content)."""
    ga: dict[str, float] = {}
    calorie_raw: str | None = None

    for table in soup.find_all("table"):
        table_text = table.get_text().lower()
        if "crude protein" not in table_text and "crude fat" not in table_text:
            continue

        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            cell_texts = [clean_text(c.get_text()) for c in cells]

            # Check for colspan calorie row: single cell with kcal data
            if len(cells) == 1:
                cell = cells[0]
                colspan = cell.get("colspan")
                cell_text = cell_texts[0]
                if colspan and ("kcal" in cell_text.lower() or "me" in cell_text.lower()):
                    calorie_raw = cell_text
                    continue

            # Handle 4-column format: label1 | val1 | label2 | val2
            pairs: list[tuple[str, str]] = []
            if len(cell_texts) >= 4:
                pairs.append((cell_texts[0], cell_texts[1]))
                pairs.append((cell_texts[2], cell_texts[3]))
            elif len(cell_texts) >= 2:
                pairs.append((cell_texts[0], cell_texts[1]))

            for label, value in pairs:
                label_lower = label.lower().strip()

                # Check for calorie content in regular cells
                if "me" in label_lower and "calc" in label_lower:
                    calorie_raw = f"{label}: {value}"
                    continue
                if "kcal" in label_lower or "kcal" in value.lower():
                    calorie_raw = f"{label} {value}"
                    continue

                # Skip ratio rows (e.g., "Calcium / Phosphorous ratio")
                if "ratio" in label_lower:
                    continue

                # GA field mapping
                field = _map_ga_field(label_lower)
                if not field:
                    continue

                m = re.search(r"(\d+\.?\d*)\s*%?", value)
                if m:
                    ga[field] = float(m.group(1))

        break  # Use first matching table

    ga_result = ga if ga else None
    cal_result = _normalize_calorie_raw(calorie_raw) if calorie_raw else None

    return ga_result, cal_result  # type: ignore[return-value]


def _normalize_calorie_raw(raw: str) -> str | None:
    """Normalize FirstMate calorie strings.

    FirstMate uses formats like:
    - "ME (calculated): 3400 kcal/ kg | 527 kcal/cup"
    - "901 kcal/kg | 311 kcal/345g can"
    """
    # Try normalize_calorie_content first
    result = normalize_calorie_content(raw)
    if result and "kcal" in result:
        return result

    # Fallback: parse the pipe-separated format directly
    raw_clean = raw.replace(",", "").lower()

    kg_match = re.search(r"(\d+)\s*kcal\s*/\s*kg", raw_clean)
    cup_match = re.search(r"(\d+)\s*kcal\s*/\s*cup", raw_clean)

    parts = []
    if kg_match:
        parts.append(f"{int(kg_match.group(1))} kcal/kg")
    if cup_match:
        parts.append(f"{int(cup_match.group(1))} kcal/cup")

    return ", ".join(parts) if parts else raw.strip()


# GA label → field name mapping
_GA_FIELD_MAP: dict[str, str] = {
    "crude protein": "crude_protein_min",
    "crude fat": "crude_fat_min",
    "crude fiber": "crude_fiber_max",
    "crude fibre": "crude_fiber_max",
    "moisture": "moisture_max",
    "ash": "ash_max",
    "calcium": "calcium_min",
    "phosphorus": "phosphorus_min",
    "phosphorous": "phosphorus_min",
    "omega-6": "omega_6_min",
    "omega 6": "omega_6_min",
    "omega-3": "omega_3_min",
    "omega 3": "omega_3_min",
}


def _map_ga_field(label: str) -> str | None:
    """Map a GA label to our field name."""
    label = re.sub(r"\s*\((?:min|max)\.?\)\s*", "", label).strip(" .")
    for pattern, field in _GA_FIELD_MAP.items():
        if pattern in label:
            # Override suffix based on original label
            if "(max" in label or "max" in label:
                return field.replace("_min", "_max")
            return field
    return None


def _parse_aafco(soup: BeautifulSoup) -> str | None:
    """Extract AAFCO statement from the guidelines box div."""
    # Primary: look for the dedicated guidelines box
    box = soup.find("div", class_="product__guidelines__box")
    if box:
        statement = clean_text(box.get_text())
        if statement and len(statement) > 20:
            return statement

    # Fallback: regex on page text for AAFCO sentence
    text = soup.get_text(separator=" ")
    match = re.search(
        r"((?:FirstMate|KASIKS)[^.]*?(?:AAFCO|Association of American Feed Control)[^.]*\.)",
        text,
        re.IGNORECASE,
    )
    if match:
        statement = clean_text(match.group(1))
        if len(statement) > 20 and len(statement) < 500:
            return statement
    return None


def _parse_images(soup: BeautifulSoup, api_image_url: str | None = None) -> list[str]:
    """Extract product images.

    Primary source: WP REST API media source_url (original upload).
    Fallback: page-level srcset/data-srcset or og:image.
    WordPress appends -NNNxNNN to resized filenames; stripping that
    suffix yields the original upload.
    """
    # Primary: WP API image URL (original upload, no suffix stripping needed)
    if api_image_url:
        return [api_image_url]

    images: list[str] = []

    # Fallback 1: wp-post-image with srcset or data-srcset (lazy loading)
    for img in soup.find_all("img", class_=lambda c: c and "wp-post-image" in c):
        srcset = img.get("srcset", "") or img.get("data-srcset", "")
        if srcset and isinstance(srcset, str):
            best_url = ""
            best_w = 0
            for entry in srcset.split(","):
                entry = entry.strip()
                parts = entry.rsplit(" ", 1)
                if len(parts) == 2 and parts[1].endswith("w"):
                    try:
                        w = int(parts[1][:-1])
                        if w > best_w:
                            best_w = w
                            best_url = parts[0]
                    except ValueError:
                        pass
            if best_url:
                images.append(best_url)
                return images

        # No srcset — use data-src or src, strip WP suffix
        src = img.get("data-src", "") or img.get("src", "")
        if src and isinstance(src, str) and src.startswith("http"):
            src = re.sub(r"-\d+x\d+(\.\w+)$", r"\1", src)
            images.append(src)
            return images

    # Fallback 2: og:image with WordPress suffix stripped
    og_img = soup.find("meta", property="og:image")
    if og_img and isinstance(og_img, Tag):
        src = og_img.get("content", "")
        if src and isinstance(src, str) and src.startswith("http"):
            src = re.sub(r"-\d+x\d+(\.\w+)$", r"\1", src)
            images.append(src)
    return images


def _parse_product(
    url: str,
    html: str,
    api_image_url: str | None = None,
    wp_product: dict | None = None,
) -> Product | None:
    """Parse a FirstMate product page."""
    soup = BeautifulSoup(html, "lxml")

    # Use WP API title if available (properly decoded), fall back to page h1
    if wp_product:
        name = html_mod.unescape(wp_product["title"]["rendered"])
    else:
        h1 = soup.find("h1")
        if not h1:
            return None
        name = clean_text(h1.get_text())

    if not name or len(name) < 3:
        return None

    wp_cats = wp_product.get("product_cat", []) if wp_product else None

    product: Product = {
        "name": name,
        "brand": "FirstMate",
        "url": url,
        "channel": "retail",
        "product_type": _detect_product_type(url, name, wp_cats),
    }

    sub_brand = _detect_sub_brand(url, name)
    if sub_brand:
        product["sub_brand"] = sub_brand

    ingredients = _parse_ingredients(soup)
    if ingredients:
        product["ingredients_raw"] = ingredients

    ga, cal = _parse_ga(soup)
    if ga:
        product["guaranteed_analysis"] = ga
        product["guaranteed_analysis_basis"] = "as-fed"
    if cal:
        product["calorie_content"] = cal

    aafco = _parse_aafco(soup)
    if aafco:
        product["aafco_statement"] = aafco

    images = _parse_images(soup, api_image_url)
    if images:
        product["images"] = images

    return product


def scrape_firstmate(output_dir: Path) -> int:
    """Scrape all FirstMate dog food products. Returns product count."""
    with SyncSession(rate_limit=1.0) as session:
        entries = _fetch_dog_products(session)

        products: list[Product] = []
        for i, (url, img_url, wp_product) in enumerate(entries):
            logger.info(f"  [{i + 1}/{len(entries)}] {url}")
            resp = session.get(url)
            if not resp.ok:
                logger.warning(f"Failed to fetch {url}: {resp.status_code}")
                continue

            product = _parse_product(url, resp.text, img_url, wp_product)
            if product:
                products.append(product)

        logger.info(f"Parsed {len(products)} dog food products from {len(entries)} entries")

    write_brand_json("FirstMate", WEBSITE_URL, products, output_dir, slug="firstmate")
    return len(products)
