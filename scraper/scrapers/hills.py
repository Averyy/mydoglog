"""Hill's Pet Nutrition Canada scraper.

Data source: hillspet.ca server-rendered HTML.
- Listing: GET hillspet.ca/en-ca/sitemap.xml → filter /en-ca/dog-food/ URLs
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
    GuaranteedAnalysis,
    Product,
    Variant,
    clean_text,
    normalize_calorie_content,
    parse_ga_html_table,
    write_brand_json,
)

logger = logging.getLogger(__name__)

SITEMAP_URL = "https://www.hillspet.ca/en-ca/sitemap.xml"
WEBSITE_URL = "https://www.hillspet.ca"
US_BASE_URL = "https://www.hillspet.com"

# --- Static fallback data for products missing calories (and 1 missing everything) ---
# Sources: Chewy.ca, Chewy.com (US), hillspet.com (US), myvetstore.ca (Wilson's).
# Last verified: 2026-03-02
#
# Structure: URL slug (after /en-ca/dog-food/) → dict with optional keys:
#   "calorie_content", "ingredients_raw", "guaranteed_analysis", "name"
# Only used when all other fallbacks (US site, Chewy scraper) fail.

_FALLBACK_DATA: dict[str, dict] = {
    # --- TREATS (retail) — Source: Chewy.ca ---
    "hills-grain-free-soft-baked-naturals-beef-sweet-potatoes-adult-treats": {
        "calorie_content": "12 kcal/treat",
    },
    "hills-grain-free-soft-baked-naturals-chicken-carrots-adult-treats": {
        "calorie_content": "12 kcal/treat",
    },
    "hills-grain-free-soft-baked-naturals-duck-pumpkin-adult-treats": {
        "calorie_content": "11 kcal/treat",
    },
    "hills-natural-baked-light-biscuits-real-chicken-small-adult-treats": {
        "calorie_content": "3020 kcal/kg, 8 kcal/treat",
    },
    "hills-natural-fruity-crunchy-snacks-apples-oatmeal-adult-treats": {
        "calorie_content": "23 kcal/treat",
    },
    "hills-natural-fruity-crunchy-snacks-cranberries-oatmeal-adult-treats": {
        "calorie_content": "24 kcal/treat",
    },
    "hills-natural-soft-savories-beef-cheddar-adult-treats": {
        "calorie_content": "25 kcal/treat",
    },
    "hills-natural-soft-savories-chicken-yogurt-adult-treats": {
        "calorie_content": "24 kcal/treat",
    },
    "hills-natural-soft-savories-peanut-butter-banana-adult-treats": {
        "calorie_content": "27 kcal/treat",
    },
    "hills-natural-jerky-mini-strips-real-beef-adult-treats": {
        "calorie_content": "3061 kcal/kg, 16 kcal/treat",
    },
    # --- WET FOOD (retail) — Source: hillspet.ca (par conserve values)
    # NOTE: Variety packs are excluded from scraping (individual products scraped separately)
    "science-diet-mature-adult-healthy-cuisine-beef-carrots-peas-stew-canned": {
        "calorie_content": "257 kcal/can",
    },
    "science-diet-adult-healthy-cuisine-beef-carrots-peas-canned": {
        "calorie_content": "305 kcal/can",
    },
    "science-diet-adult-perfect-digestion-chicken-vegetable-rice-stew-canned": {
        "calorie_content": "278 kcal/can",
    },
    "science-diet-adult-chunks-gravy-chicken-vegetable-canned": {
        "calorie_content": "327 kcal/can",
    },
    "science-diet-adult-salmon-canned": {
        "calorie_content": "369 kcal/can",
    },
    "science-diet-puppy-chicken-canned": {
        "calorie_content": "495 kcal/can",
    },
    # --- DRY (retail) — Source: Chewy.ca + hillspet.com (US) ---
    "science-diet-adult-healthy-mobility-dry": {
        "ingredients_raw": "Chicken Meal, Brewers Rice, Whole Grain Sorghum, Brown Rice, Whole Grain Wheat, Cracked Pearled Barley, Soybean Meal, Dried Beet Pulp, Chicken Fat, Chicken Liver Flavor, Soybean Oil, Corn Gluten Meal, Fish Oil, Flaxseed, Lactic Acid, Pork Liver Flavor, Potassium Chloride, Choline Chloride, DL-Methionine, Iodized Salt, Calcium Carbonate, vitamins (Vitamin E Supplement, L-Ascorbyl-2-Polyphosphate (source of Vitamin C), Niacin Supplement, Thiamine Mononitrate, Vitamin A Supplement, Calcium Pantothenate, Biotin, Vitamin B12 Supplement, Pyridoxine Hydrochloride, Riboflavin Supplement, Vitamin D3 Supplement, Folic Acid), minerals (Ferrous Sulfate, Zinc Oxide, Copper Sulfate, Manganous Oxide, Calcium Iodate, Sodium Selenite), Taurine, L-Lysine, Oat Fiber, Mixed Tocopherols for freshness, Natural Flavors, L-Carnitine, Beta-Carotene, Apples, Broccoli, Carrots, Cranberries, Green Peas.",
        "guaranteed_analysis": {
            "crude_protein_min": 17.0,
            "crude_fat_min": 10.0,
            "crude_fiber_max": 3.0,
            "moisture_max": 10.0,
        },
        "calorie_content": "3617 kcal/kg, 361 kcal/cup",
    },
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

# itemBrand in dataLayer → channel
_CHANNEL_MAP: dict[str, str] = {
    "sd": "retail",  # Science Diet
    "hills": "retail",  # Hill's Science Diet
    "pd": "vet",  # Prescription Diet
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
    """Fetch sitemap and extract dog food product URLs."""
    resp = session.get(SITEMAP_URL)
    resp.raise_for_status()

    # Parse XML sitemap
    root = ElementTree.fromstring(resp.text)
    # Handle XML namespace
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

    urls: list[str] = []
    for url_elem in root.findall(".//sm:url/sm:loc", ns):
        url = url_elem.text
        if url and "/en-ca/dog-food/" in url:
            # Skip variety/multi packs — individual products are scraped separately
            if "variety-pack" in url or "multi-pack" in url:
                continue
            urls.append(url.strip())

    logger.info(f"Sitemap: {len(urls)} dog food URLs")
    return urls


def _fetch_product_page(session: SyncSession, url: str) -> str | None:
    """Fetch a product page HTML."""
    resp = session.get(url)
    if not resp.ok:
        logger.warning(f"Failed to fetch {url}: {resp.status_code}")
        return None
    return resp.text


def _extract_datalayer(html: str) -> dict | None:
    """Extract product data from window.dataLayer script block.

    Hill's dataLayer structure has product data nested in objects like:
    {"product": {"productForm": "dry", "itemBrand": "pd", ...}}
    The array JSON may be malformed (extra data after the array), so we
    parse incrementally.
    """
    # Strategy 1: Find the dataLayer array and parse objects within it
    pattern = r"window\.dataLayer\s*=\s*\["
    match = re.search(pattern, html, re.DOTALL)
    if not match:
        return None

    # Extract individual JSON objects from within the array
    product_data: dict = {}
    start = match.end()

    # Find all {...} blocks within the dataLayer array
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
                    # Check for product data — may be top-level or nested
                    if isinstance(obj, dict):
                        if "itemBrand" in obj or "productForm" in obj:
                            product_data.update(obj)
                        elif "product" in obj and isinstance(obj["product"], dict):
                            product_data.update(obj["product"])
                except json.JSONDecodeError:
                    pass
                obj_start = None
        elif c == "]" and brace_depth == 0:
            break  # End of array

    return product_data if product_data else None


def _find_accordion_content(soup: BeautifulSoup, heading_text: str) -> str | None:
    """Find accordion panel content by its heading text.

    Hill's uses AEM accordion components: a <button class="cmp-accordion__button">
    with aria-controls pointing to a <div class="cmp-accordion__panel"> by ID.
    """
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
            # Fallback: next sibling of parent heading
            parent = tag.parent
            if parent and parent.name in ("h2", "h3", "h4"):
                panel = parent.find_next_sibling()
                if panel:
                    return str(panel)

    return None


def _parse_ingredients(soup: BeautifulSoup) -> str | None:
    """Extract ingredients from the Ingredients accordion panel."""
    content = _find_accordion_content(soup, "Ingredients")
    if not content:
        return None

    # Parse the HTML content to get plain text
    content_soup = BeautifulSoup(content, "lxml")
    text = content_soup.get_text(separator=" ")
    text = clean_text(text)

    # Remove common prefixes/suffixes
    text = re.sub(r"^ingredients?\s*:?\s*", "", text, flags=re.IGNORECASE).strip()

    return text if len(text) > 10 else None


def _parse_ga(soup: BeautifulSoup) -> GuaranteedAnalysis | None:
    """Extract GA from the Nutrient Content accordion panel.

    Hill's tables use simplified labels ("Protein", "Fat", "Crude Fiber")
    without min/max designators. We map these to standard fields with
    conventional min/max assumptions.
    """
    content = _find_accordion_content(soup, "Nutrient")
    if not content:
        content = _find_accordion_content(soup, "Guaranteed Analysis")
    if not content:
        return None

    if "<table" not in content.lower():
        return None

    # Try standard parser first
    ga = parse_ga_html_table(content)

    # Hill's tables may use short labels; supplement with Hills-specific parsing
    if not ga or "crude_protein_min" not in ga:
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
            # Map Hill's short labels → our fields
            field = _HILLS_GA_MAP.get(label)
            if field and field not in ga:
                ga[field] = value

    # Sanity check: drop percentage fields >100% (same as parse_ga_html_table)
    if ga:
        _PCT_FIELDS = {
            "crude_protein", "crude_fat", "crude_fiber", "moisture", "ash",
            "calcium", "phosphorus", "omega_6", "omega_3", "epa", "dha",
            "taurine", "potassium", "sodium", "copper",
        }
        bad_keys = [
            k for k, v in ga.items()
            if any(k.startswith(f) for f in _PCT_FIELDS) and v > 100
        ]
        for k in bad_keys:
            logger.warning(f"Hills GA sanity check: dropping {k}={ga[k]} (>100%)")
            del ga[k]

    return ga if ga else None


# Hill's nutrient table uses short labels → map to our GA fields
_HILLS_GA_MAP: dict[str, str] = {
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


def _parse_calorie_content(soup: BeautifulSoup) -> str | None:
    """Extract calorie content from nutrient panel or page text.

    Hill's dry food: "3495 kcal/kg, 347 kcal/cup"
    Hill's wet food: "354 kcal / 13 oz (370 g) can"
    """
    content = _find_accordion_content(soup, "Nutrient")
    if not content:
        content = _find_accordion_content(soup, "Caloric")
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

    # Hill's CMS serves French calorie text on some CA and US pages:
    # "{kcal} kcal par conserve de {size} g ({oz} oz)"
    m = re.search(
        r"(\d[\d,]*\.?\d*)\s*kcal\s+par\s+conserve",
        text,
        re.IGNORECASE,
    )
    if m:
        kcal = m.group(1).replace(",", "")
        return f"{int(float(kcal))} kcal/can"

    # Dry food format: standard kcal/kg + kcal/cup — but ONLY pass the
    # calorie-specific line to normalizer, NOT the entire nutrient table.
    # The full table contains "IU/kg" values (Vitamin E etc.) that cause
    # normalize_calorie_content to produce false matches like "278 kcal/kg".
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


def _parse_channel(data_layer: dict | None) -> str:
    """Determine retail vs vet from dataLayer itemBrand."""
    if not data_layer:
        return "retail"
    brand = str(data_layer.get("itemBrand", "")).lower().strip()
    return _CHANNEL_MAP.get(brand, "retail")


def _detect_type(data_layer: dict | None, url: str) -> str:
    """Determine product type (food/treat) from dataLayer productForm or URL."""
    if data_layer:
        form = str(data_layer.get("productForm", "")).lower().strip()
        if form in _TYPE_MAP:
            return _TYPE_MAP[form]

    # Fallback: check URL
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

    # Fallback: check URL
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
    # Split by pipe, comma, or semicolon
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

    # Try dataLayer first
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

    # Also look for size options in page HTML
    for option in soup.find_all("option"):
        text = option.get_text(strip=True)
        if not text:
            continue
        size_kg = _parse_hills_weight(text)
        if size_kg is not None:
            # Avoid duplicates
            if not any(v["size_description"] == text for v in variants):
                variants.append({
                    "size_kg": size_kg,
                    "size_description": text,
                })

    return variants


def _parse_hills_weight(text: str) -> float | None:
    """Parse Hill's weight strings. Hill's uses lbs primarily — convert to kg."""
    text = text.lower().replace(",", "").strip()

    # kg first
    m = re.search(r"(\d+\.?\d*)\s*kg", text)
    if m:
        return round(float(m.group(1)), 2)

    # lbs → kg
    m = re.search(r"(\d+\.?\d*)\s*(?:lb|lbs|pound)", text)
    if m:
        return round(float(m.group(1)) * LBS_TO_KG, 2)

    # grams
    m = re.search(r"(\d+\.?\d*)\s*g(?:\b|$)", text)
    if m:
        return round(float(m.group(1)) / 1000, 3)

    # ounces
    m = re.search(r"(\d+\.?\d*)\s*(?:oz|ounce)", text)
    if m:
        return round(float(m.group(1)) / 35.274, 3)

    return None


def _parse_images(soup: BeautifulSoup) -> list[str]:
    """Extract product images from pxmshare CDN.

    Hill's moved images to Colgate-Palmolive's PXM CDN. The canonical product
    image is in <meta name="image"> tags (class="swiftype" or "elastic").
    Fallback: <img> tags with src on pxmshare, but ONLY from the product
    hero/gallery — NOT from "Related products" carousels at the bottom, which
    contain images of completely different products.
    """
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
    # Related products are in containers with "related" in their heading text
    # or inside <a> tags linking to other product pages.
    related_sections = set()
    for heading in soup.find_all(["h2", "h3"], string=re.compile(r"related", re.I)):
        parent = heading.find_parent(["section", "div"])
        if parent:
            related_sections.add(id(parent))

    for img in soup.find_all("img"):
        src = img.get("src", "")
        if not src or "pxmshare.colgatepalmolive.com" not in src or src in seen:
            continue
        # Skip images inside <a> tags linking to other products (related/recommended)
        parent_a = img.find_parent("a")
        if parent_a and parent_a.get("href", "").startswith(("/en-ca/dog-food/", "http")):
            continue
        # Skip images inside related product sections
        if any(img.find_parent(id=None) and id(p) in related_sections
               for p in img.parents if p.name in ("section", "div")):
            continue
        src = re.sub(r"/PNG_\d+/", "/PNG_2000/", src)
        seen.add(src)
        images.append(src)

    return images


def _parse_product(url: str, html: str) -> Product | None:
    """Parse a product page HTML into a Product."""
    soup = BeautifulSoup(html, "lxml")
    data_layer = _extract_datalayer(html)

    # Get product name from <title> or <h1>
    title_tag = soup.find("h1")
    name = title_tag.get_text(strip=True) if title_tag else ""
    if not name:
        title_meta = soup.find("title")
        name = title_meta.get_text(strip=True) if title_meta else ""
        # Clean: remove " | Hill's Pet" suffix
        name = re.sub(r"\s*\|.*$", "", name)
    if not name:
        return None

    name = clean_text(name)

    # Filter out broken/discontinued pages that return garbage titles
    if not name or name in ("0", "Not Found") or len(name) < 3:
        return None

    product_type = _detect_type(data_layer, url)
    product_format = _detect_format(data_layer, url)

    # Append product form to wet food names to distinguish from dry counterparts
    # (e.g., "c/d Multicare Chicken Flavor Dog Food" exists as both dry and wet)
    if product_format == "wet" and product_type == "food":
        name = f"{name} Wet Food"

    product: Product = {
        "name": name,
        "brand": "Hill's",
        "url": url,
        "channel": _parse_channel(data_layer),
        "product_type": product_type,
        "product_format": product_format,
    }

    # Sub-brand from channel
    if product["channel"] == "vet":
        product["sub_brand"] = "Prescription Diet"
    else:
        product["sub_brand"] = "Science Diet"

    # Ingredients
    ingredients = _parse_ingredients(soup)
    if ingredients:
        product["ingredients_raw"] = ingredients

    # GA (dry matter basis for Hill's)
    ga = _parse_ga(soup)
    if ga:
        product["guaranteed_analysis"] = ga
        product["guaranteed_analysis_basis"] = "dry-matter"

    # Calorie content
    cal = _parse_calorie_content(soup)
    if cal:
        product["calorie_content"] = cal

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
    """Convert a hillspet.ca product URL to the hillspet.com equivalent.

    CA: https://www.hillspet.ca/en-ca/dog-food/{slug}
    US: https://www.hillspet.com/dog-food/{slug}

    Returns None if the URL doesn't match the expected pattern.
    """
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

    The US and CA sites share the same product slugs and HTML structure.
    When the CA page is missing data, the US page often has it.

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


def scrape_hills(output_dir: Path) -> int:
    """Scrape all Hill's Canada dog food products. Returns product count."""
    with SyncSession(rate_limit=1.0) as session:
        # Step 1: Get product URLs from sitemap
        urls = _fetch_sitemap_urls(session)

        # Step 2: Fetch and parse each product page
        products: list[Product] = []
        us_supplemented = 0
        for i, url in enumerate(urls):
            logger.info(f"  [{i + 1}/{len(urls)}] {url}")
            html = _fetch_product_page(session, url)
            if not html:
                continue

            # Detect dead/discontinued pages Hill's left in the sitemap
            # (return 200 but with <h1>0</h1>, <h1>Not Found</h1>, or no content)
            soup_check = BeautifulSoup(html, "lxml")
            h1 = soup_check.find("h1")
            h1_text = h1.get_text(strip=True) if h1 else ""
            if not h1_text or h1_text in ("0", "Not Found"):
                logger.info(f"  Skipped (dead page): {url}")
                continue

            product = _parse_product(url, html)
            if product:
                products.append(product)
            else:
                logger.warning(f"  Failed to parse: {url}")

        # Step 3: Supplement missing data from US site (hillspet.com)
        for product in products:
            needs_data = (
                "calorie_content" not in product
                or "ingredients_raw" not in product
                or "guaranteed_analysis" not in product
            )
            if needs_data:
                if _supplement_from_us_site(product, session):
                    us_supplemented += 1

        if us_supplemented:
            logger.info(f"  US fallback supplemented {us_supplemented} products")

    # Step 4: Static fallback for products still missing data
    # (Chewy fallback removed — search never matched Hill's products,
    # and _FALLBACK_DATA covers all 36 products that need backfill.)
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

    write_brand_json("Hill's", WEBSITE_URL, products, output_dir, slug="hills")
    return len(products)
