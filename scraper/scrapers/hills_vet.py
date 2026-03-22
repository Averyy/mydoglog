"""Hill's Prescription Diet (vet) scraper.

Data source: hillspet.ca server-rendered HTML, filtered to Prescription Diet.
- Listing: GET hillspet.ca/en-ca/sitemap.xml → filter prescription-diet URLs
- Detail: Parse HTML product pages (accordion panels + window.dataLayer)

Key challenges:
- dataLayer extraction from <script> tag via regex
- Accordion panel parsing by heading text (not CSS classes)
- Weight conversion: lbs → kg
- GA basis: Hill's reports dry matter %, not as-fed
- Health tags from pipe-separated condition strings
"""

import json
import logging
import re
from pathlib import Path
from xml.etree import ElementTree

from bs4 import BeautifulSoup
from wafer import SyncSession

from .common import (
    Product,
    Variant,
    clean_text,
    normalize_calorie_content,
    write_brand_json,
)
from .hills_common import (
    find_accordion_content,
    parse_calorie_content,
    parse_ga,
    parse_ingredients,
)

logger = logging.getLogger(__name__)

SITEMAP_URL = "https://www.hillspet.ca/en-ca/sitemap.xml"
WEBSITE_URL = "https://www.hillspet.ca"
US_BASE_URL = "https://www.hillspet.com"

# --- Static fallback data for vet products missing calories ---
# Sources: hillspet.ca (par conserve), myvetstore.ca (Wilson's).
# Last verified: 2026-03-02
#
# Structure: URL slug (after /en-ca/dog-food/) → dict with optional keys:
#   "calorie_content", "ingredients_raw", "guaranteed_analysis", "name"

_FALLBACK_DATA: dict[str, dict] = {
    # --- WET FOOD (vet) — Source: hillspet.ca (par conserve values)
    "prescription-diet-cd-multicare-urinary-care-canned": {
        "calorie_content": "448 kcal/can",
    },
    "prescription-diet-dd-salmon-skin-care-canned": {
        "calorie_content": "405 kcal/can",
    },
    "prescription-diet-gastrointestinal-biome-chicken-vegetable-stew-digestive-care-canned": {
        "calorie_content": "287 kcal/can",
    },
    "prescription-diet-id-chicken-vegetable-stew-digestive-care-canned": {
        "calorie_content": "276 kcal/can",
    },
    "prescription-diet-id-digestive-care-canned": {
        "calorie_content": "375 kcal/can",
    },
    "prescription-diet-id-low-fat-digestive-care-canned": {
        "calorie_content": "328 kcal/can",
    },
    "prescription-diet-jd-joint-care-canned": {
        "calorie_content": "470 kcal/can",
    },
    "prescription-diet-kd-kidney-care-canned": {
        "calorie_content": "433 kcal/can",
    },
    "prescription-diet-metabolic-vegetable-chicken-stew-weight-management-canned": {
        "calorie_content": "248 kcal/can",
    },
    "prescription-diet-metabolic-mobility-vegetables-tuna-stew-weight-management-canned": {
        "calorie_content": "225 kcal/can",
    },
    "prescription-diet-onc-on-care-chicken-stew-restorative-care-canned": {
        "calorie_content": "322 kcal/can",
    },
    "prescription-diet-zd-food-sensitivities-canned": {
        "calorie_content": "357 kcal/can",
    },
    # --- TREATS (vet) — Source: myvetstore.ca (Wilson's Animal Hospital) ---
    # Calorie values calculated from caloric basis (g/100kcal) + as-fed %,
    # cross-verified across protein/fat/carb (convergence within 2%).
    "prescription-diet-hypo-treats-digestive-care-treats": {
        "name": "Hypoallergenic Dog Treats",
        "calorie_content": "3483 kcal/kg",
    },
    "prescription-diet-treats-dental-care-treats": {
        "name": "Dog Treats",
        "calorie_content": "2840 kcal/kg",
    },
    "prescription-diet-soft-baked-treat-aging-care-treats": {
        "name": "Soft Baked Dog Treats",
        "calorie_content": "3207 kcal/kg",
    },
    "prescription-diet-metabolic-healthy-weight-glucose-management-treats": {
        "name": "Metabolic Weight Management Dog Treats",
        "calorie_content": "3427 kcal/kg",
    },
}

# productForm in dataLayer → product type + format
_TYPE_MAP: dict[str, str] = {
    "dry": "food",
    "stew": "food",
    "canned": "food",
    "wet": "food",
    "treat": "treat",
    "treats": "treat",
}

_FORMAT_MAP: dict[str, str] = {
    "dry": "dry",
    "stew": "wet",
    "canned": "wet",
    "wet": "wet",
    "treat": "dry",
    "treats": "dry",
}

# condition string fragments → health tags
_CONDITION_MAP: dict[str, str] = {
    "gidisorders": "digestive_health",
    "gi disorders": "digestive_health",
    "digestive": "digestive_health",
    "skincoat": "skin_coat",
    "skin": "skin_coat",
    "weight": "weight_management",
    "weightmanagement": "weight_management",
    "obesity": "weight_management",
    "urinary": "urinary_health",
    "kidney": "kidney_health",
    "renal": "kidney_health",
    "joint": "joint_health",
    "mobility": "joint_health",
    "diabetes": "diabetes",
    "heart": "heart_health",
    "cardiac": "heart_health",
    "liver": "liver_health",
    "hepatic": "liver_health",
    "dental": "dental_health",
    "food sensitivities": "food_sensitivities",
    "foodsensitivities": "food_sensitivities",
    "allergy": "food_sensitivities",
    "brain": "brain_health",
    "cognitive": "brain_health",
    "cancer": "cancer_care",
    "critical care": "critical_care",
    "criticalcare": "critical_care",
    "recovery": "critical_care",
    "thyroid": "thyroid",
}

LBS_TO_KG = 1 / 2.20462


def _fetch_sitemap_urls(session: SyncSession) -> list[str]:
    """Fetch sitemap and extract Prescription Diet dog food URLs."""
    resp = session.get(SITEMAP_URL)
    resp.raise_for_status()

    root = ElementTree.fromstring(resp.text)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

    urls: list[str] = []
    for url_elem in root.findall(".//sm:url/sm:loc", ns):
        url = url_elem.text
        if url and "/en-ca/dog-food/" in url:
            # Only Prescription Diet products
            slug = url.split("/en-ca/dog-food/")[-1]
            if not slug.startswith("prescription-diet"):
                continue
            # Skip variety/multi packs
            if "variety-pack" in url or "multi-pack" in url:
                continue
            urls.append(url.strip())

    logger.info(f"Sitemap: {len(urls)} Prescription Diet URLs")
    return urls


def _fetch_product_page(session: SyncSession, url: str) -> str | None:
    """Fetch a product page HTML."""
    resp = session.get(url)
    if not resp.ok:
        logger.warning(f"Failed to fetch {url}: {resp.status_code}")
        return None
    return resp.text


def _extract_datalayer(html: str) -> dict | None:
    """Extract product data from window.dataLayer script block."""
    pattern = r"window\.dataLayer\s*=\s*\["
    match = re.search(pattern, html, re.DOTALL)
    if not match:
        return None

    product_data: dict = {}
    start = match.end()

    brace_depth = 0
    obj_start = None
    for i in range(start, min(start + 20000, len(html))):
        c = html[i]
        if c == "{":
            if brace_depth == 0:
                obj_start = i
            brace_depth += 1
        elif c == "}":
            brace_depth -= 1
            if brace_depth == 0 and obj_start is not None:
                obj_str = html[obj_start : i + 1]
                try:
                    obj = json.loads(obj_str)
                    if isinstance(obj, dict):
                        if "itemBrand" in obj or "productForm" in obj:
                            product_data.update(obj)
                        elif "product" in obj and isinstance(obj["product"], dict):
                            product_data.update(obj["product"])
                except json.JSONDecodeError:
                    pass
                obj_start = None
        elif c == "]" and brace_depth == 0:
            break

    return product_data if product_data else None



# Re-export shared parsing functions for backwards compatibility
_find_accordion_content = find_accordion_content
_parse_ingredients = parse_ingredients
_parse_ga = parse_ga
_parse_calorie_content = parse_calorie_content


def _detect_type(data_layer: dict | None, url: str) -> str:
    """Determine product type (food/treat) from dataLayer productForm or URL."""
    if data_layer:
        form = str(data_layer.get("productForm", "")).lower().strip()
        if form in _TYPE_MAP:
            return _TYPE_MAP[form]

    url_lower = url.lower()
    if "/treats" in url_lower or "/treat" in url_lower:
        return "treat"
    return "food"


def _detect_format(data_layer: dict | None, url: str) -> str:
    """Determine product format (dry/wet) from dataLayer productForm or URL."""
    if data_layer:
        form = str(data_layer.get("productForm", "")).lower().strip()
        if form in _FORMAT_MAP:
            return _FORMAT_MAP[form]

    url_lower = url.lower()
    if "/stew" in url_lower or "/canned" in url_lower or "/wet" in url_lower:
        return "wet"
    return "dry"


def _parse_health_tags(data_layer: dict | None) -> list[str]:
    """Parse health tags from pipe-separated condition string."""
    if not data_layer:
        return []

    condition = str(data_layer.get("condition", "")).lower()
    if not condition:
        return []

    tags: set[str] = set()
    parts = re.split(r"[|,;]", condition)
    for part in parts:
        part = part.strip()
        if not part:
            continue
        for pattern, tag in _CONDITION_MAP.items():
            if pattern in part:
                tags.add(tag)
                break

    return sorted(tags)


def _parse_variants(soup: BeautifulSoup, data_layer: dict | None) -> list[Variant]:
    """Extract product size variants."""
    variants: list[Variant] = []

    if data_layer:
        item_variant = data_layer.get("itemVariant", "")
        sku = data_layer.get("sku", "")

        if item_variant:
            size_kg = _parse_hills_weight(str(item_variant))
            if size_kg is not None:
                variant: Variant = {
                    "size_kg": size_kg,
                    "size_description": str(item_variant),
                }
                if sku:
                    variant["sku"] = str(sku)
                variants.append(variant)

    for option in soup.find_all("option"):
        text = option.get_text(strip=True)
        if not text:
            continue
        size_kg = _parse_hills_weight(text)
        if size_kg is not None:
            if not any(v["size_description"] == text for v in variants):
                variants.append({
                    "size_kg": size_kg,
                    "size_description": text,
                })

    return variants


def _parse_hills_weight(text: str) -> float | None:
    """Parse Hill's weight strings. Hill's uses lbs primarily — convert to kg."""
    text = text.lower().replace(",", "").strip()

    m = re.search(r"(\d+\.?\d*)\s*kg", text)
    if m:
        return round(float(m.group(1)), 2)

    m = re.search(r"(\d+\.?\d*)\s*(?:lb|lbs|pound)", text)
    if m:
        return round(float(m.group(1)) * LBS_TO_KG, 2)

    m = re.search(r"(\d+\.?\d*)\s*g(?:\b|$)", text)
    if m:
        return round(float(m.group(1)) / 1000, 3)

    m = re.search(r"(\d+\.?\d*)\s*(?:oz|ounce)", text)
    if m:
        return round(float(m.group(1)) / 35.274, 3)

    return None


def _parse_images(soup: BeautifulSoup) -> list[str]:
    """Extract product images from pxmshare CDN."""
    seen: set[str] = set()
    images: list[str] = []

    # Strategy 1: <meta name="image"> — canonical product image
    for meta in soup.find_all("meta", attrs={"name": "image"}):
        src = meta.get("content", "")
        if src and "pxmshare.colgatepalmolive.com" in src and src not in seen:
            src = re.sub(r"/PNG_\d+/", "/PNG_2000/", src)
            seen.add(src)
            images.append(src)

    if images:
        return images

    # Strategy 2: <img> tags — only from outside related-product sections
    related_sections = set()
    for heading in soup.find_all(["h2", "h3"], string=re.compile(r"related", re.I)):
        parent = heading.find_parent(["section", "div"])
        if parent:
            related_sections.add(id(parent))

    for img in soup.find_all("img"):
        src = img.get("src", "")
        if not src or "pxmshare.colgatepalmolive.com" not in src or src in seen:
            continue
        parent_a = img.find_parent("a")
        if parent_a and parent_a.get("href", "").startswith(("/en-ca/dog-food/", "http")):
            continue
        if any(img.find_parent(id=None) and id(p) in related_sections
               for p in img.parents if p.name in ("section", "div")):
            continue
        src = re.sub(r"/PNG_\d+/", "/PNG_2000/", src)
        seen.add(src)
        images.append(src)

    return images


def _parse_product(url: str, html: str, soup: BeautifulSoup | None = None) -> Product | None:
    """Parse a product page HTML into a Product."""
    if soup is None:
        soup = BeautifulSoup(html, "lxml")
    data_layer = _extract_datalayer(html)

    # Get product name from <h1> or <title>
    title_tag = soup.find("h1")
    name = title_tag.get_text(strip=True) if title_tag else ""
    if not name:
        title_meta = soup.find("title")
        name = title_meta.get_text(strip=True) if title_meta else ""
        name = re.sub(r"\s*\|.*$", "", name)
    if not name:
        return None

    name = clean_text(name)

    if not name or name in ("0", "Not Found") or len(name) < 3:
        return None

    product_type = _detect_type(data_layer, url)
    product_format = _detect_format(data_layer, url)

    # Append "Wet Food" to wet food names to distinguish from dry counterparts
    if product_format == "wet" and product_type == "food":
        name = f"{name} Wet Food"

    product: Product = {
        "name": name,
        "brand": "Hill's",
        "url": url,
        "channel": "vet",
        "product_type": product_type,
        "product_format": product_format,
        "sub_brand": "Prescription Diet",
    }

    # GA from Hill's nutrient table (dry-matter basis)
    ga = _parse_ga(soup)
    if ga:
        product["guaranteed_analysis"] = ga
        product["guaranteed_analysis_basis"] = "dry-matter"

    # Ingredients
    ingredients = _parse_ingredients(soup)
    if ingredients:
        product["ingredients_raw"] = ingredients

    # Calories
    calories = _parse_calorie_content(soup)
    if calories:
        product["calorie_content"] = calories

    # Health tags
    health_tags = _parse_health_tags(data_layer)
    if health_tags:
        product["health_tags"] = health_tags

    # Images
    images = _parse_images(soup)
    if images:
        product["images"] = images

    # Variants
    variants = _parse_variants(soup, data_layer)
    if variants:
        product["variants"] = variants

    # Source ID from dataLayer
    if data_layer:
        sku = data_layer.get("sku", "") or data_layer.get("data-product-id", "")
        if sku:
            product["source_id"] = str(sku)

    return product


def _ca_url_to_us_url(ca_url: str) -> str | None:
    """Convert a hillspet.ca product URL to the hillspet.com equivalent."""
    prefix = "https://www.hillspet.ca/en-ca/dog-food/"
    if not ca_url.startswith(prefix):
        return None
    slug = ca_url[len(prefix) :]
    if not slug:
        return None
    return f"{US_BASE_URL}/dog-food/{slug}"


def _supplement_from_us_site(
    product: Product, session: SyncSession
) -> bool:
    """Fill missing calories, ingredients, or GA from the US hillspet.com page.

    Returns True if any field was supplemented, False otherwise.
    """
    needs_cal = "calorie_content" not in product
    needs_ing = "ingredients_raw" not in product
    needs_ga = "guaranteed_analysis" not in product

    if not (needs_cal or needs_ing or needs_ga):
        return False

    us_url = _ca_url_to_us_url(product["url"])
    if not us_url:
        return False

    resp = session.get(us_url)
    if not resp.ok:
        logger.debug(f"  US fallback 404: {us_url}")
        return False

    soup = BeautifulSoup(resp.text, "lxml")
    supplemented = False

    if needs_cal:
        cal = _parse_calorie_content(soup)
        if cal:
            product["calorie_content"] = cal
            supplemented = True
            logger.info(f"  US fallback: calories → {cal}")

    if needs_ing:
        ing = _parse_ingredients(soup)
        if ing:
            product["ingredients_raw"] = ing
            supplemented = True
            logger.info(f"  US fallback: ingredients ({len(ing)} chars)")

    if needs_ga:
        ga = _parse_ga(soup)
        if ga:
            product["guaranteed_analysis"] = ga
            product["guaranteed_analysis_basis"] = "dry-matter"
            supplemented = True
            logger.info(f"  US fallback: GA ({len(ga)} fields)")

    return supplemented


def _enrich_wet_kcal_per_kg(product: Product) -> bool:
    """Calculate kcal/kg for wet products from kcal/can + can weight.

    Returns True if kcal/kg was added.
    """
    if product.get("product_format") != "wet":
        return False

    cal = product.get("calorie_content", "")
    variants = product.get("variants", [])
    if not cal or not variants:
        return False

    if "kcal/kg" in cal:
        return False

    m = re.match(r"(\d+)\s*kcal/can", cal)
    if not m:
        return False
    kcal_per_can = float(m.group(1))

    can_weight_kg = variants[0].get("size_kg")
    if not can_weight_kg or can_weight_kg <= 0:
        return False

    kcal_per_kg = round(kcal_per_can / can_weight_kg)
    product["calorie_content"] = f"{kcal_per_kg} kcal/kg, {int(kcal_per_can)} kcal/can"

    logger.info(f"  kcal/kg: {product['name'][:50]} → {kcal_per_kg} kcal/kg")
    return True


def scrape_hills_vet(output_dir: Path) -> int:
    """Scrape Hill's Prescription Diet (vet) products. Returns product count."""
    with SyncSession(rate_limit=1.0) as session:
        # Step 1: Get Prescription Diet URLs from sitemap
        urls = _fetch_sitemap_urls(session)

        # Step 2: Parse each product page (metadata + GA + ingredients + calories)
        products: list[Product] = []
        for i, url in enumerate(urls):
            logger.info(f"  [{i + 1}/{len(urls)}] {url}")
            html = _fetch_product_page(session, url)
            if not html:
                continue

            soup = BeautifulSoup(html, "lxml")
            h1 = soup.find("h1")
            h1_text = h1.get_text(strip=True) if h1 else ""
            if not h1_text or h1_text in ("0", "Not Found"):
                logger.info(f"  Skipped (dead page): {url}")
                continue

            product = _parse_product(url, html, soup=soup)
            if product:
                products.append(product)
            else:
                logger.warning(f"  Failed to parse: {url}")

        # Step 3: US site fallback for missing data
        us_supplemented = 0
        for product in products:
            if _supplement_from_us_site(product, session):
                us_supplemented += 1
        if us_supplemented:
            logger.info(f"  US fallback supplemented {us_supplemented} products")

    # Step 4: Static fallback for name corrections and missing calories
    static_filled = 0
    for product in products:
        slug = product["url"].replace(f"{WEBSITE_URL}/en-ca/dog-food/", "")
        if slug not in _FALLBACK_DATA:
            continue
        fb = _FALLBACK_DATA[slug]
        filled_any = False
        if fb.get("name"):
            product["name"] = fb["name"]
            filled_any = True
        if fb.get("calorie_content") and not product.get("calorie_content"):
            cal = normalize_calorie_content(fb["calorie_content"])
            if cal:
                product["calorie_content"] = cal
                filled_any = True
        if fb.get("ingredients_raw") and not product.get("ingredients_raw"):
            product["ingredients_raw"] = fb["ingredients_raw"]
            filled_any = True
        if fb.get("guaranteed_analysis") and not product.get("guaranteed_analysis"):
            product["guaranteed_analysis"] = fb["guaranteed_analysis"]
            product["guaranteed_analysis_basis"] = "as-fed"
            filled_any = True
        if filled_any:
            static_filled += 1
    if static_filled:
        logger.info(f"  Static fallback filled {static_filled} products")

    # Step 5: Calculate kcal/kg for wet products from kcal/can + can weight
    kcal_enriched = 0
    for product in products:
        if _enrich_wet_kcal_per_kg(product):
            kcal_enriched += 1
    if kcal_enriched:
        logger.info(f"  kcal/kg calculated for {kcal_enriched} wet products")

    write_brand_json("Hill's", WEBSITE_URL, products, output_dir, slug="hills_vet")
    return len(products)
