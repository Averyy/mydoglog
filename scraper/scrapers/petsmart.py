"""Shared PetSmart.ca scraper utilities.

PetSmart uses Next.js with React Server Components (RSC). Product data comes
from three sources on each page:

1. JSON-LD (<script type="application/ld+json">) — name, SKU, UPC, image
2. RSC flight payloads (self.__next_f.push([1,"..."])) — ingredients, GA, calories
3. Brand verification (data-testid="test-pdp-brand") — confirm correct brand

Discovery modes:
- Featured brands: /featured-brands/{slug}/f/pet/dog?page=N
- Search fallback: /search/f/pet/dog?q={query}&page=N
Both paginate by incrementing page until error / empty / "No results found".

IMPORTANT: Always use wafer-py SyncSession(rate_limit=1.0) to avoid Kasada blocks.
"""

import json
import logging
import re
from collections import Counter, defaultdict
from collections.abc import Callable

from bs4 import BeautifulSoup
from wafer import SyncSession

from .common import (
    GuaranteedAnalysis,
    Product,
    Variant,
    clean_text,
    normalize_calorie_content,
    write_brand_json,
)

logger = logging.getLogger(__name__)

WEBSITE_URL = "https://www.petsmart.ca"

# GA field patterns — ordered with longer/more-specific patterns FIRST
GA_PATTERNS: list[tuple[str, str]] = [
    (r"omega[\s-]*6\s+fatty\s+acid", "omega_6"),
    (r"omega[\s-]*6", "omega_6"),
    (r"omega[\s-]*3\s+fatty\s+acid", "omega_3"),
    (r"omega[\s-]*3", "omega_3"),
    (r"crude\s+protein", "crude_protein"),
    (r"crude\s+fat", "crude_fat"),
    (r"crude\s+fib[re]+", "crude_fiber"),
    (r"moisture", "moisture"),
    (r"\bash\b", "ash"),
    (r"calcium", "calcium"),
    (r"phosphorus", "phosphorus"),
    (r"glucosamine", "glucosamine"),
    (r"chondroitin", "chondroitin"),
    (r"taurine", "taurine"),
    (r"\bdha\b", "dha"),
    (r"\bepa\b", "epa"),
    (r"l-carnitine", "l_carnitine"),
]


# ---------------------------------------------------------------------------
# Ingredient overrides for known PetSmart source data errors
# ---------------------------------------------------------------------------

# Global overrides applied to all brands
_GLOBAL_INGREDIENT_OVERRIDES: dict[str, str] = {
    "Minerals 9potassium Chloride": "Minerals (Potassium Chloride",
    "),- ": "), ",  # Missing space after parenthetical
    "Lamb Meal. Brewers Rice": "Lamb Meal, Brewers Rice",  # Period instead of comma
    "- Taurine": "Taurine",  # Leading dash artifact
    "Calcium Iod ": "Calcium Iodate ",  # Truncated ingredient name
    "Calcium Iod,": "Calcium Iodate,",  # Truncated variant
    # Purina ONE treats: "Essential Nutrients and Other Ingredients:" sub-header
    "Essential Nutrients and Other Ingredients: ": "",
    # DentaLife: proprietary blend header before real ingredients
    "Inactive Ingredients: ": "",
}


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


def fetch_product_urls(
    session: SyncSession,
    *,
    brand_slug: str | None = None,
    search_query: str | None = None,
    listing_url: str | None = None,
) -> list[str]:
    """Discover dog product URLs from PetSmart.

    Three modes (tried in order):
    1. Custom listing URL: any PetSmart listing/filter page (paginated)
    2. Featured brands: /featured-brands/{brand_slug}/f/pet/dog?page=N
    3. Search fallback: /search/f/pet/dog?q={search_query}&page=N

    Must provide at least one of listing_url, brand_slug, or search_query.
    """
    if not brand_slug and not search_query and not listing_url:
        raise ValueError("Must provide listing_url, brand_slug, or search_query")

    urls: set[str] = set()

    # Try custom listing URL first
    if listing_url:
        result = _paginate_listing(session, listing_url)
        if result:
            return sorted(result)

    # Try featured brands
    if brand_slug:
        result = _paginate_listing(
            session,
            f"{WEBSITE_URL}/featured-brands/{brand_slug}/f/pet/dog",
        )
        if result:
            return sorted(result)

    # Fall back to search
    if search_query:
        result = _paginate_listing(
            session,
            f"{WEBSITE_URL}/search/f/pet/dog",
            query_param=f"q={search_query}",
        )
        if result:
            return sorted(result)

    return sorted(urls)


def _paginate_listing(
    session: SyncSession,
    base_url: str,
    *,
    query_param: str | None = None,
) -> set[str]:
    """Paginate a PetSmart listing URL, collecting product URLs."""
    urls: set[str] = set()
    page = 1

    while True:
        params = []
        if query_param:
            params.append(query_param)
        params.append(f"page={page}")

        url = f"{base_url}?{'&'.join(params)}"
        resp = session.get(url)
        if not resp.ok:
            break

        if "No results found" in resp.text and page > 1:
            break

        page_urls: list[str] = []
        for m in re.finditer(
            r'href="(/dog/(?:food|treats)/[^"]*\.html)"',
            resp.text,
        ):
            product_url = f"{WEBSITE_URL}{m.group(1)}"
            if product_url not in urls:
                urls.add(product_url)
                page_urls.append(product_url)

        logger.info(f"  Page {page}: {len(page_urls)} new URLs (total: {len(urls)})")

        if not page_urls:
            break
        page += 1

    return urls


# ---------------------------------------------------------------------------
# RSC payload extraction
# ---------------------------------------------------------------------------


def parse_json_ld_products(soup: BeautifulSoup) -> list[dict]:
    """Extract all Product JSON-LD entries from the page."""
    products = []
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string)
            if data.get("@type") == "Product":
                products.append(data)
        except (json.JSONDecodeError, TypeError):
            continue
    return products


def extract_rsc_text(html: str) -> str | None:
    """Extract nutritional text from Next.js RSC flight payloads.

    Picks the longest chunk with 'Ingredients:', then checks if it's missing
    GA or calorie data. If so, supplements from other chunks that have it.
    """
    candidates: list[str] = []

    for m in re.finditer(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html):
        payload = m.group(1)
        if (
            "ngredient" not in payload
            and "uaranteed" not in payload
            and "NUTRITIONAL" not in payload
        ):
            continue

        try:
            unescaped = payload.encode().decode("unicode_escape")
        except (UnicodeDecodeError, ValueError):
            continue

        soup = BeautifulSoup(unescaped, "lxml")
        text = soup.get_text(separator="\n", strip=True)
        if text:
            candidates.append(text)

    if not candidates:
        return None

    # Pick the longest chunk with Ingredients: as primary
    best_text = ""
    for text in candidates:
        if re.search(r"Ingredients\s*:", text) and len(text) > len(best_text):
            best_text = text

    if not best_text:
        # No chunk has Ingredients:, just pick the longest
        best_text = max(candidates, key=len)

    # If primary is missing GA or calories, look for them in other chunks
    has_ga = bool(re.search(r"Crude\s+Protein.*\d+\.?\d*\s*%", best_text))
    has_cal = bool(re.search(r"kcal/", best_text))

    if not has_ga or not has_cal:
        for text in candidates:
            if text is best_text:
                continue
            if not has_ga and re.search(r"Crude\s+Protein.*\d+\.?\d*\s*%", text):
                best_text = best_text + "\n" + text
                has_ga = True
            if not has_cal and re.search(r"kcal/", text):
                best_text = best_text + "\n" + text
                has_cal = True
            if has_ga and has_cal:
                break

    return best_text if best_text else None


# ---------------------------------------------------------------------------
# Nutritional parsing
# ---------------------------------------------------------------------------


def parse_ingredients(
    text: str,
    *,
    overrides: dict[str, str] | None = None,
) -> str | None:
    """Extract ingredients from RSC payload text.

    CRITICAL: Regex requires colon after "Ingredients" — using optional colon
    matches marketing copy like "Wholesome ingredients" before the real section.

    Args:
        text: RSC payload text.
        overrides: Brand-specific ingredient text overrides (bad -> good).
    """
    m = re.search(
        r"Ingredients\s*:\s*\n(.*?)(?:\n\s*(?:Guaranteed|Caloric|Feeding|Directions|AAFCO)|$)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if m:
        ingredients = re.sub(r"\s*\n\s*", " ", m.group(1)).strip()
        ingredients = clean_text(ingredients)
        if ingredients and len(ingredients) > 2:
            ingredients = clean_ingredients(ingredients, overrides=overrides)
            return ingredients

    m = re.search(r"(?:^|\n)\s*Ingredients\s*:\s*(.+)", text, re.IGNORECASE)
    if m:
        ingredients = clean_text(m.group(1).strip())
        if ingredients and len(ingredients) > 2:
            ingredients = clean_ingredients(ingredients, overrides=overrides)
            return ingredients

    return None


def clean_ingredients(
    text: str,
    *,
    overrides: dict[str, str] | None = None,
) -> str:
    """Fix common PetSmart ingredient text issues."""
    # Strip leading colon (e.g. ": Water, Turkey" from double-colon after Ingredients:)
    text = re.sub(r"^:\s*", "", text)
    # Strip DentaLife "Active Ingredients per Chew" proprietary blend prefix
    text = re.sub(
        r"^Active Ingredients.*?Inactive Ingredients:\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    # Strip leading SKU numbers (e.g. "5287562, 5287561 Deboned Chicken")
    text = re.sub(r"^[\d,\s]+(?=[A-Z])", "", text)
    # Strip trailing disclaimer (e.g. "...and trace nutrients are not naturally occurring.")
    text = re.sub(
        r"[.,;]?\s*(?:added\s+)?(?:vitamins,?\s+minerals,?\s+)?and\s+trace\s+nutrients\s+are\s+not\s+naturally\s+occurring.*$",
        "",
        text,
        flags=re.IGNORECASE,
    )
    # Strip trailing marketing copy (e.g. "...Supplement Our natural ingredients are carefully sourced...")
    text = re.sub(
        r"\s+Our\s+(?:natural\s+)?ingredients\s+are\s+.*$",
        "",
        text,
        flags=re.IGNORECASE,
    )
    # Fix Riboflavin mojibake (multiple encoding variants)
    text = re.sub(r"Ribo[^\x00-\x7F]+avin", "Riboflavin", text)
    # Normalize en-dashes (–) to hyphens (-) — PetSmart uses Unicode en-dashes
    text = text.replace("\u2013", "-")
    # Apply global overrides
    for bad, good in _GLOBAL_INGREDIENT_OVERRIDES.items():
        text = text.replace(bad, good)
    # Apply brand-specific overrides
    if overrides:
        for bad, good in overrides.items():
            text = text.replace(bad, good)
    # Strip trailing product SKU codes (e.g. "...Supplement]. K444422", "...Chloride. 2C37078")
    text = re.sub(r"[.\s]+\d*[A-Z]\d{4,}[A-Z]?$", "", text)
    return text.strip().rstrip(".,;")


def parse_ga(text: str) -> GuaranteedAnalysis | None:
    """Parse GA from RSC payload text."""
    ga: dict[str, float] = {}
    _MAX_BY_DEFAULT = {"ash", "crude_fiber", "moisture"}

    # Fix PetSmart jammed GA formats (no separators between fields)
    # "GUARANTEED ANALYSISCrude" or "Guaranteed AnalysisCrude"
    text = re.sub(r"Analysis(?=Crude|Moisture)", "Analysis\n", text, flags=re.IGNORECASE)
    # "(MIN) % 30.00" -> "30.00% MIN" (percent before number)
    text = re.sub(r"\(MIN\)\s*%\s*([\d.]+)", r"\1% MIN", text)
    text = re.sub(r"\(MAX\)\s*%\s*([\d.]+)", r"\1% MAX", text)
    # "30%Crude" or "10.0%Crude" -> add newline (percent jammed to next field)
    # Don't split "30% MIN" or "30% MAX" — only when followed by field names
    text = re.sub(r"(\d%)(?=[A-Z](?!IN\b|AX\b))", r"\1\n", text)
    # "MINCrude" or "MAXCrude" -> add newline
    text = re.sub(r"(MIN|MAX)(?=[A-Z])", r"\1\n", text)

    segments: list[str] = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        pct_count = len(re.findall(r"\d+\.?\d*\s*%", line))
        if pct_count > 1:
            # Split on comma/semicolon before uppercase
            parts = re.split(r"[,;]\s*(?=[A-Z*])", line)
            if len(parts) < pct_count:
                # Split on GA field boundaries in all-on-one-line format.
                # Insert newlines after: "% MIN/MAX/min./max." or "N %" before uppercase
                # Allow optional period after % (e.g. "2.00%. MIN")
                normalized = re.sub(
                    r"(%\.?\s*(?:MIN|MAX|min\.|max\.)?)\s+(?=[A-Z*])",
                    r"\1\n",
                    line,
                )
                parts = [p.strip() for p in normalized.split("\n") if p.strip()]
            segments.extend(parts)
        else:
            segments.append(line)

    for segment in segments:
        segment = segment.strip()
        if not segment:
            continue

        segment_lower = segment.lower()

        for pattern, field_base in GA_PATTERNS:
            if not re.search(pattern, segment_lower):
                continue

            is_max = bool(re.search(r"\bmax\b", segment_lower))
            is_min = bool(re.search(r"\bmin\b", segment_lower))

            if not is_max and not is_min:
                is_max = field_base in _MAX_BY_DEFAULT
                is_min = not is_max

            suffix = "_max" if is_max else "_min"

            val_match = re.search(r"(\d+\.?\d*)\s*%", segment)
            if not val_match and field_base in _MAX_BY_DEFAULT | {
                "crude_protein",
                "crude_fat",
            }:
                fallback = re.search(
                    r"(?:min|max)\.?\)?\s+(\d+\.?\d*)(?!\s*mg)",
                    segment,
                    re.IGNORECASE,
                )
                if fallback:
                    val_match = fallback
            if val_match:
                ga[f"{field_base}{suffix}"] = float(val_match.group(1))

            break

    return ga if ga else None  # type: ignore[return-value]


def _fix_reversed_units(raw: str) -> str:
    """Fix PetSmart calorie unit issues.

    Handles:
    - Fraction slash (U+2044 ⁄) -> regular slash
    - Reversed units: 'kg/kcal' -> 'kcal/kg', 'kg/cup' -> 'kcal/cup'
    - Number-after-unit: 'ME (kcal/kg) 3,359 ME (kcal/cup) 458' -> '3,359 kcal/kg, 458 kcal/cup'
    - Also handles: '(ME kcal/kg) 3,359' format (parentheses around ME + unit)
    """
    # Normalize fraction slash (⁄ U+2044) to regular slash
    raw = raw.replace("\u2044", "/")

    # Fix "ME (kcal/unit) number" or "(ME kcal/unit) number" format
    me_match = re.findall(
        r"(?:ME\s*\(kcal|(?:\(ME\s+kcal))/(kg|cup|can|pouch)\)?\s*([\d,]+\.?\d*)",
        raw,
        re.IGNORECASE,
    )
    if me_match:
        # Only keep kg and cup/can/pouch (skip g, lb)
        parts = []
        for unit, num in me_match:
            if unit.lower() in ("kg", "cup", "can", "pouch"):
                parts.append(f"{num} kcal/{unit}")
        if parts:
            return ", ".join(parts)

    # Fix simple reversed units
    raw = re.sub(r"\bkg\s*/\s*kcal\b", "kcal/kg", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\bkg\s*/\s*cup\b", "kcal/cup", raw, flags=re.IGNORECASE)
    return raw


def parse_calories(text: str) -> str | None:
    """Extract calorie content from RSC payload text."""
    for line in text.split("\n"):
        line_lower = line.strip().lower()
        if ("calori" in line_lower or "kcal" in line_lower) and "kcal" in line_lower:
            normalized = normalize_calorie_content(_fix_reversed_units(line.strip()))
            if normalized:
                return normalized

    m = re.search(
        r"Calori[ce]+\s+Content\s*:?\s*(?:\([^)]*\)\s*:?\s*)?\n\s*(.+)",
        text,
        re.IGNORECASE,
    )
    if m:
        normalized = normalize_calorie_content(_fix_reversed_units(m.group(1).strip()))
        if normalized:
            return normalized

    # Fallback: "NNN calories per cup" without kcal
    m = re.search(r"(\d+)\s+calories?\s+per\s+cup", text, re.IGNORECASE)
    if m:
        return f"{m.group(1)} kcal/cup"

    return None


# ---------------------------------------------------------------------------
# Product detection helpers
# ---------------------------------------------------------------------------


def detect_type(url: str, name: str) -> str:
    """Detect product type: food, treat, or supplement."""
    url_lower = url.lower()
    name_lower = name.lower()

    if "/treats/" in url_lower:
        return "treat"
    if "food-toppers" in url_lower or "topper" in name_lower:
        return "supplement"
    if "bone broth" in name_lower or "meal complement" in name_lower:
        return "supplement"
    if "puree" in name_lower:
        return "supplement"
    return "food"


def detect_format(url: str, name: str, product_type: str) -> str:
    """Detect product format: dry or wet."""
    url_lower = url.lower()
    name_lower = name.lower()

    if "canned-food" in url_lower or "wet" in name_lower:
        return "wet"
    if "food-toppers" in url_lower or "topper" in name_lower:
        return "wet"
    if "stew" in name_lower or "broth" in name_lower:
        return "wet"
    if "puree" in name_lower or "shreds" in name_lower:
        return "wet"
    if product_type == "supplement":
        return "wet"
    if "/treats/" in url_lower:
        return "dry"
    return "dry"


def detect_life_stage(name: str) -> str | None:
    """Detect life stage from product name."""
    name_lower = name.lower()
    if "puppy" in name_lower:
        return "puppy"
    if "senior" in name_lower:
        return "senior"
    if "all life stage" in name_lower:
        return "all"
    if "adult" in name_lower:
        return "adult"
    return None


def detect_breed_size(name: str) -> str | None:
    """Detect breed size from product name."""
    name_lower = name.lower()
    if "large breed" in name_lower:
        return "Large"
    if "small breed" in name_lower:
        return "Small"
    return None


# ---------------------------------------------------------------------------
# Product parsing
# ---------------------------------------------------------------------------


def parse_product(
    url: str,
    html: str,
    *,
    brand_name: str,
    brand_pattern: str | None = None,
    ingredient_overrides: dict[str, str] | None = None,
    detect_sub_brand: Callable[[str], str | None] | None = None,
    manual_product_data: dict[str, dict] | None = None,
) -> Product | None:
    """Parse a PetSmart product page.

    Args:
        url: Product page URL.
        html: Raw HTML of the product page.
        brand_name: Display name (e.g. "Natural Balance").
        brand_pattern: Regex pattern to match brand in page brand tag.
            Defaults to case-insensitive match of brand_name.
        ingredient_overrides: Brand-specific ingredient text fixes.
        detect_sub_brand: Optional callable(name) -> str | None for sub-brand detection.
    """
    soup = BeautifulSoup(html, "lxml")

    ld_products = parse_json_ld_products(soup)
    ld = ld_products[0] if ld_products else None

    # Get name from JSON-LD, fallback to h1
    name = None
    if ld:
        name = ld.get("name")
    if not name:
        h1 = soup.find("h1")
        if h1:
            name = h1.get_text(strip=True)
    if not name:
        return None

    name = clean_text(name)

    # Strip brand prefix from name
    brand_prefix_pattern = re.escape(brand_name).replace(r"\ ", r"\s+")
    name = re.sub(
        rf"^{brand_prefix_pattern}\s*®?\s*",
        "",
        name,
        flags=re.IGNORECASE,
    )

    # Strip trailing size: ", 5.5 oz", "- 13 Oz.", ", 10 OZ", ", 4 lbs."
    name = re.sub(
        r"[,\s]*-?\s*\d+\.?\d*\s*(?:oz|lbs?|g|kg|ml)\.?(?:\s*,\s*\d+\s*count)?\s*$",
        "",
        name,
        flags=re.IGNORECASE,
    )

    # Verify brand from page
    if brand_pattern is None:
        brand_pattern = re.escape(brand_name).replace(r"\ ", r"\s+")
    brand_match = re.search(
        r'data-testid="test-pdp-brand"[^>]*>([^<]+)</a>', html
    )
    if brand_match:
        page_brand = brand_match.group(1).strip()
        if not re.search(brand_pattern, page_brand, re.IGNORECASE):
            logger.info(
                f"  Skipping non-{brand_name} product "
                f"(brand={page_brand}): {name}"
            )
            return None

    # Filter out cat products
    if re.search(r"\bcat\b", name, re.IGNORECASE) or "/cat/" in url.lower():
        logger.info(f"  Skipping cat product: {name}")
        return None

    # Skip variety packs
    name_lower = name.lower()
    url_lower = url.lower()
    if "variety pack" in name_lower or "variety-pack" in url_lower:
        logger.info(f"  Skipping variety pack: {name}")
        return None
    if "multi value pack" in name_lower or "multipack" in name_lower:
        logger.info(f"  Skipping multi-pack: {name}")
        return None

    product_type = detect_type(url, name)
    product_format = detect_format(url, name, product_type)

    product: Product = {
        "name": name,
        "brand": brand_name,
        "url": url,
        "channel": "retail",
        "product_type": product_type,
        "product_format": product_format,
    }

    if detect_sub_brand:
        sub_brand = detect_sub_brand(name)
        if sub_brand:
            product["sub_brand"] = sub_brand

    life_stage = detect_life_stage(name)
    if life_stage:
        product["life_stage"] = life_stage

    breed_size = detect_breed_size(name)
    if breed_size:
        product["breed_size"] = breed_size

    # SKU from JSON-LD
    if ld:
        sku = ld.get("sku") or ld.get("productID")
        if sku:
            product["source_id"] = str(sku)

    # Image from JSON-LD
    if ld and ld.get("image"):
        img = ld["image"]
        if isinstance(img, str) and img.startswith("http"):
            product["images"] = [img]

    # Variants with UPC from JSON-LD
    if ld_products:
        variants: list[Variant] = []
        for ld_item in ld_products:
            gtin = ld_item.get("gtin13")
            item_sku = ld_item.get("sku")
            item_name = ld_item.get("name", "")
            size_desc = ""
            size_match = re.search(
                r"(\d+(?:\.\d+)?\s*(?:lb|oz|kg|g))\b", item_name, re.IGNORECASE
            )
            if size_match:
                size_desc = size_match.group(1)
            variant: Variant = {
                "size_kg": 0.0,
                "size_description": size_desc,
            }
            if gtin:
                variant["upc"] = gtin
            if item_sku:
                variant["sku"] = str(item_sku)
            if gtin or size_desc:
                variants.append(variant)
        if variants:
            product["variants"] = variants

    # Extract nutritional data from RSC payload
    rsc_text = extract_rsc_text(html)
    if rsc_text:
        ingredients = parse_ingredients(rsc_text, overrides=ingredient_overrides)
        if ingredients:
            product["ingredients_raw"] = ingredients

        ga = parse_ga(rsc_text)
        if ga:
            product["guaranteed_analysis"] = ga
            product["guaranteed_analysis_basis"] = "as-fed"

        cal = parse_calories(rsc_text)
        if cal:
            product["calorie_content"] = cal

    # Apply manual data overrides (fixes bad source data or fills missing fields)
    if manual_product_data:
        for url_pattern, fields in manual_product_data.items():
            if url_pattern in url:
                for key, value in fields.items():
                    product[key] = value  # type: ignore[literal-required]
                    logger.info(f"  Applied manual {key} for: {name}")
                break

    return product


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------


def _primary_protein(ingredients_raw: str) -> str | None:
    """Extract the primary protein name from the first ingredient."""
    first = ingredients_raw.split(",")[0].strip()
    first = re.sub(r"\s+Broth$", "", first, flags=re.IGNORECASE)
    return first if first else None


def _normalize_ing(raw: str) -> str:
    """Normalize ingredients for comparison (case, spacing, trailing punct)."""
    s = raw.lower().strip().rstrip(".")
    s = re.sub(r"\s*([()])\s*", r" \1 ", s)
    return re.sub(r"\s+", " ", s).strip()


def deduplicate_products(products: list[Product]) -> list[Product]:
    """Remove duplicate products.

    Two passes:
    1. Exact name dupes — same name + same ingredients -> keep first.
       Same name + different ingredients -> append primary protein to disambiguate.
    2. Size-variant dupes — different names but same (life_stage, breed_size,
       format, sub_brand, product_type, ingredients) -> keep shortest name.
    """
    # Pass 1: exact name duplicates
    name_counts = Counter(p["name"] for p in products)
    duped_names = {n for n, c in name_counts.items() if c > 1}

    skip_urls: set[str] = set()
    if duped_names:
        groups: dict[str, list[Product]] = {}
        for p in products:
            if p["name"] in duped_names:
                groups.setdefault(p["name"], []).append(p)

        for base_name, group in groups.items():
            ingredients = [_normalize_ing(p.get("ingredients_raw", "")) for p in group]
            if len(set(ingredients)) == 1:
                for p in group[1:]:
                    skip_urls.add(p["url"])
                    logger.info(f"  Skipping name duplicate: {base_name} ({p['url']})")
            else:
                for p in group:
                    protein = _primary_protein(p.get("ingredients_raw", ""))
                    if protein:
                        p["name"] = f"{base_name} {protein}"

    products = [p for p in products if p["url"] not in skip_urls]

    # Pass 2: size-variant duplicates (same product identity + ingredients)
    identity_groups: dict[tuple, list[Product]] = defaultdict(list)
    for p in products:
        ing = _normalize_ing(p.get("ingredients_raw", ""))
        if not ing:
            continue
        key = (
            p.get("life_stage", ""),
            p.get("breed_size", ""),
            p.get("product_format", ""),
            p.get("sub_brand", ""),
            p.get("product_type", ""),
            ing,
        )
        identity_groups[key].append(p)

    skip_urls = set()
    for key, group in identity_groups.items():
        if len(group) <= 1:
            continue
        group.sort(key=lambda p: len(p["name"]))
        keep = group[0]
        for p in group[1:]:
            skip_urls.add(p["url"])
            logger.info(
                f"  Skipping size variant: {p['name']} "
                f"(keeping {keep['name']})"
            )

    return [p for p in products if p["url"] not in skip_urls]


# ---------------------------------------------------------------------------
# High-level scrape helper
# ---------------------------------------------------------------------------


def scrape_petsmart_brand(
    output_dir,
    *,
    brand_name: str,
    slug: str,
    brand_slug: str | None = None,
    search_query: str | None = None,
    listing_url: str | None = None,
    brand_pattern: str | None = None,
    ingredient_overrides: dict[str, str] | None = None,
    detect_sub_brand: Callable[[str], str | None] | None = None,
    manual_product_data: dict[str, dict] | None = None,
    skip_url_patterns: set[str] | None = None,
    rate_limit: float = 2.0,
) -> int:
    """Scrape a brand from PetSmart and write JSON. Returns product count.

    Args:
        output_dir: Directory for output JSON.
        brand_name: Display name (e.g. "Natural Balance").
        slug: Output filename slug (e.g. "naturalbalance").
        brand_slug: PetSmart featured-brands slug (e.g. "natural-balance").
        search_query: Fallback search query (e.g. "Eukanuba").
        listing_url: Custom PetSmart listing/filter URL (e.g. multi-brand filter).
        brand_pattern: Regex to verify brand on product pages.
        ingredient_overrides: Brand-specific ingredient text fixes.
        detect_sub_brand: Optional callable(name) -> str | None.
        manual_product_data: URL-keyed dict of fields to fill when RSC is missing data.
        skip_url_patterns: Set of URL substrings to skip (known dupes, bad pages).
        rate_limit: Seconds between requests (default 2.0).
    """
    with SyncSession(rate_limit=rate_limit) as session:
        urls = fetch_product_urls(
            session,
            brand_slug=brand_slug,
            search_query=search_query,
            listing_url=listing_url,
        )
        logger.info(f"Found {len(urls)} product URLs for {brand_name}")

        products: list[Product] = []
        for i, url in enumerate(urls):
            if skip_url_patterns and any(p in url for p in skip_url_patterns):
                logger.info(f"  [{i + 1}/{len(urls)}] Skipping (blocklist): {url.split('/')[-1]}")
                continue
            logger.info(f"  [{i + 1}/{len(urls)}] {url.split('/')[-1]}")
            resp = session.get(url)
            if not resp.ok:
                logger.warning(f"Failed to fetch {url}: {resp.status_code}")
                continue

            product = parse_product(
                url,
                resp.text,
                brand_name=brand_name,
                brand_pattern=brand_pattern,
                ingredient_overrides=ingredient_overrides,
                detect_sub_brand=detect_sub_brand,
                manual_product_data=manual_product_data,
            )
            if product:
                products.append(product)

    for p in products:
        if not p.get("ingredients_raw"):
            logger.warning(f"  Missing ingredients: {p['name']}")

    products = deduplicate_products(products)

    has_ingredients = sum(1 for p in products if p.get("ingredients_raw"))
    has_ga = sum(1 for p in products if p.get("guaranteed_analysis"))
    has_cal = sum(1 for p in products if p.get("calorie_content"))
    logger.info(
        f"Completeness: {has_ingredients}/{len(products)} ingredients, "
        f"{has_ga}/{len(products)} GA, {has_cal}/{len(products)} calories"
    )

    write_brand_json(
        brand_name, WEBSITE_URL, products, output_dir,
        slug=slug, ingredient_overrides=ingredient_overrides,
    )
    return len(products)
