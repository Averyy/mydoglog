"""Pedigree scraper (via PetSmart.ca).

Data source: petsmart.ca — Next.js with React Server Components (RSC).
- Discovery: listing page at /dog/food/f/brand/pedigree + XML sitemaps as supplement
- Detail: Product pages at petsmart.ca/dog/food/{category}/{slug}-{sku}.html
- Metadata (name, SKU, image, UPC): JSON-LD <script type="application/ld+json">
- Nutritional data (ingredients, GA, calories): RSC flight payloads
  (self.__next_f.push([1,"..."])) containing escaped HTML

Key notes:
- Mars Petcare brand. ~29 dog products on PetSmart.ca: dry, wet, treats.
- No sub-brands.
- Size variants (2kg vs 18kg) share names and need dedup.
- wafer-py handles Kasada bot protection
"""

import json
import logging
import re
from collections import Counter
from pathlib import Path

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

_INGREDIENT_OVERRIDES: dict[str, str] = {
    "Enriched Egg Noodles (Semolina, Eggs, Niacin, Ferrous Sulfate, Thiamine Mononitrate, Riboflavin, Folic Acid)": (
        "Enriched Egg Noodles, Semolina, Eggs, Niacin, Ferrous Sulfate, Thiamine Mononitrate, Riboflavin, Folic Acid"
    ),
    "Poassium Chloride": "Potassium Chloride",
}

WEBSITE_URL = "https://www.petsmart.ca"

_LISTING_URL = f"{WEBSITE_URL}/dog/food/f/brand/pedigree"
_SITEMAP_URLS = [f"{WEBSITE_URL}/sitemap_{i}.xml" for i in range(5)]

# GA field patterns — ordered with longer/more-specific patterns FIRST
# Calorie fallbacks for products where PetSmart RSC payload lacks calorie data.
# Values sourced from Chewy.ca product pages (March 2026).
_CALORIE_FALLBACKS: dict[str, str] = {
    "53884": "1063 kcal/kg, 399 kcal/can",   # Chopped Beef
    "56029": "1171 kcal/kg, 439 kcal/can",   # Chopped Chicken
    "56030": "1030 kcal/kg, 386 kcal/can",   # Chopped Filet Mignon
    "12926": "884 kcal/kg, 553 kcal/can",    # Choice Cuts Beef
    "21899": "884 kcal/kg, 557 kcal/can",    # Choice Cuts Chicken
    "3783": "2740 kcal/kg, 53 kcal/treat",   # Jumbone Mini
}

# GA field patterns — ordered with longer/more-specific patterns FIRST
_GA_PATTERNS: list[tuple[str, str]] = [
    (r"omega[\s-]*6\s+fatty\s+acid", "omega_6"),
    (r"omega[\s-]*6", "omega_6"),
    (r"omega[\s-]*3\s+fatty\s+acid", "omega_3"),
    (r"omega[\s-]*3", "omega_3"),
    (r"crude\s+protein", "crude_protein"),
    (r"crude\s+fat", "crude_fat"),
    (r"crude\s+fib[re]+", "crude_fiber"),
    (r"moisture", "moisture"),
    (r"ash", "ash"),
    (r"calcium", "calcium"),
    (r"phosphorus", "phosphorus"),
    (r"glucosamine", "glucosamine"),
    (r"chondroitin", "chondroitin"),
    (r"taurine", "taurine"),
    (r"\bdha\b", "dha"),
    (r"\bepa\b", "epa"),
    (r"l-carnitine", "l_carnitine"),
]


def _fetch_product_urls(session: SyncSession) -> list[str]:
    """Discover Pedigree dog product URLs from PetSmart listing page + sitemaps."""
    urls: set[str] = set()

    # Primary: listing page
    resp = session.get(_LISTING_URL)
    if resp.ok:
        for m in re.finditer(
            r'href="(/dog/food/[^"]*pedigree[^"]*\.html)"',
            resp.text,
            re.IGNORECASE,
        ):
            urls.add(f"{WEBSITE_URL}{m.group(1)}")

    listing_count = len(urls)
    logger.info(f"Found {listing_count} Pedigree dog URLs from listing page")

    # Supplement: sitemaps (catch any products not on listing page)
    for sitemap_url in _SITEMAP_URLS:
        resp = session.get(sitemap_url)
        if not resp.ok:
            continue
        for m in re.finditer(
            r"<loc>(https://www\.petsmart\.ca/dog/[^<]*pedigree[^<]*\.html)</loc>",
            resp.text,
            re.IGNORECASE,
        ):
            urls.add(m.group(1))

    logger.info(
        f"Found {len(urls)} total Pedigree dog URLs "
        f"({listing_count} listing + {len(urls) - listing_count} new from sitemaps)"
    )
    return sorted(urls)


def _parse_json_ld_products(soup: BeautifulSoup) -> list[dict]:
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


def _extract_rsc_text(html: str) -> str | None:
    """Extract nutritional text from Next.js RSC flight payloads.

    Prefers chunks that contain actual 'Ingredients:' sections over longer
    chunks that merely mention the word (e.g. product recommendation widgets).
    """
    best_text = ""
    best_has_ingredients = False

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

        has_ingredients = bool(re.search(r"Ingredients\s*:", text))

        # Prefer chunks with actual Ingredients: section; among equal, pick longest
        if (has_ingredients and not best_has_ingredients) or (
            has_ingredients == best_has_ingredients and len(text) > len(best_text)
        ):
            best_text = text
            best_has_ingredients = has_ingredients

    return best_text if best_text else None


def _parse_ingredients(text: str) -> str | None:
    """Extract ingredients from RSC payload text."""
    m = re.search(
        r"Ingredients\s*:?\s*\n(.*?)(?:\n\s*(?:Guaranteed|Caloric|Feeding|Directions|AAFCO)|$)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if m:
        ingredients = re.sub(r"\s*\n\s*", " ", m.group(1)).strip()
        ingredients = clean_text(ingredients)
        if ingredients and len(ingredients) > 2:
            return ingredients

    m = re.search(r"Ingredients\s*:\s*(.+)", text, re.IGNORECASE)
    if m:
        ingredients = clean_text(m.group(1).strip())
        if ingredients and len(ingredients) > 2:
            return ingredients

    return None


def _parse_ga(text: str) -> GuaranteedAnalysis | None:
    """Parse GA from RSC payload text.

    Handles multiple formats:
    - One value per line: "Crude Protein (min) 26.0%"
    - Comma-separated single line
    - Semicolon-separated single line
    Also tolerates missing '%' sign and filters out mg/kg values.
    """
    ga: dict[str, float] = {}
    _MAX_BY_DEFAULT = {"ash", "crude_fiber", "moisture"}

    segments: list[str] = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        pct_count = len(re.findall(r"\d+\.?\d*\s*%", line))
        if pct_count > 1:
            parts = re.split(r"[,;]\s*(?=[A-Z*])", line)
            segments.extend(parts)
        else:
            segments.append(line)

    for segment in segments:
        segment = segment.strip()
        if not segment:
            continue

        segment_lower = segment.lower()

        for pattern, field_base in _GA_PATTERNS:
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


def _parse_calories(text: str) -> str | None:
    """Extract calorie content from RSC payload text."""
    for line in text.split("\n"):
        line_lower = line.strip().lower()
        if ("calori" in line_lower or "kcal" in line_lower) and "kcal" in line_lower:
            normalized = normalize_calorie_content(line.strip())
            if normalized:
                return normalized

    m = re.search(
        r"Calori[ce]+\s+Content\s*:?\s*(?:\([^)]*\)\s*:?\s*)?\n\s*(.+)",
        text,
        re.IGNORECASE,
    )
    if m:
        normalized = normalize_calorie_content(m.group(1).strip())
        if normalized:
            return normalized

    return None


def _detect_type(url: str, name: str) -> str:
    """Detect product type: food, treat, or supplement."""
    url_lower = url.lower()
    name_lower = name.lower()

    if "food-toppers" in url_lower or "supplement" in name_lower or "topper" in name_lower:
        return "supplement"
    if re.search(r"\btreat", url_lower + " " + name_lower):
        return "treat"
    return "food"


def _detect_format(url: str, name: str) -> str:
    """Detect product format: dry or wet."""
    url_lower = url.lower()
    name_lower = name.lower()

    if "canned-food" in url_lower or "wet" in name_lower:
        return "wet"
    if "food-toppers" in url_lower or "topper" in name_lower:
        return "wet"
    return "dry"


def _detect_life_stage(name: str) -> str | None:
    """Detect life stage from product name."""
    name_lower = name.lower()
    if "puppy" in name_lower:
        return "puppy"
    if "senior" in name_lower or "healthy aging" in name_lower:
        return "senior"
    if "all life stage" in name_lower:
        return "all"
    if "adult" in name_lower:
        return "adult"
    return None


def _detect_breed_size(name: str) -> str | None:
    """Detect breed size from product name."""
    name_lower = name.lower()
    if "large breed" in name_lower:
        return "Large"
    if "small breed" in name_lower or "small & toy" in name_lower:
        return "Small"
    if "medium breed" in name_lower:
        return "Medium"
    return None


def _parse_product(url: str, html: str) -> Product | None:
    """Parse a Pedigree product page from PetSmart."""
    soup = BeautifulSoup(html, "lxml")

    ld_products = _parse_json_ld_products(soup)
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

    # Strip "Pedigree " brand prefix
    if name.startswith("Pedigree "):
        name = name[9:]

    # Strip trailing size: ", 5.5 oz", "- 13 Oz.", ", 34 lb"
    name = re.sub(
        r"[,\s]*-?\s*\d+\.?\d*\s*(?:oz|lb|g|kg|ml)\.?\s*$",
        "",
        name,
        flags=re.IGNORECASE,
    )

    # Filter out cat products
    if re.search(r"\bcat\b", name, re.IGNORECASE) and "catch" not in name.lower():
        logger.info(f"  Skipping cat product: {name}")
        return None
    if "/cat/" in url.lower():
        logger.info(f"  Skipping cat product: {name}")
        return None

    # Skip multi-packs / variety packs
    name_lower = name.lower()
    if "multi value pack" in name_lower or "multipack" in name_lower or "variety pack" in name_lower:
        logger.info(f"  Skipping multi-pack: {name}")
        return None
    if "value pack" in name_lower:
        logger.info(f"  Skipping value pack: {name}")
        return None

    product: Product = {
        "name": name,
        "brand": "Pedigree",
        "url": url,
        "channel": "retail",
        "product_type": _detect_type(url, name),
        "product_format": _detect_format(url, name),
    }

    life_stage = _detect_life_stage(name)
    if life_stage:
        product["life_stage"] = life_stage

    breed_size = _detect_breed_size(name)
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
    rsc_text = _extract_rsc_text(html)
    if rsc_text:
        ingredients = _parse_ingredients(rsc_text)
        if ingredients:
            product["ingredients_raw"] = ingredients

        ga = _parse_ga(rsc_text)
        if ga:
            product["guaranteed_analysis"] = ga
            product["guaranteed_analysis_basis"] = "as-fed"

        cal = _parse_calories(rsc_text)
        if cal:
            product["calorie_content"] = cal

    # Fallback: hardcoded calorie data for products missing from RSC.
    # Key is the URL slug SKU (e.g. "53884" from ...-53884.html).
    if "calorie_content" not in product:
        url_sku_match = re.search(r"-(\d+)\.html", url)
        if url_sku_match:
            fallback = _CALORIE_FALLBACKS.get(url_sku_match.group(1))
            if fallback:
                product["calorie_content"] = fallback
                logger.info(f"  Used calorie fallback for URL SKU {url_sku_match.group(1)}")

    return product


def _primary_protein(ingredients_raw: str) -> str | None:
    """Extract the primary protein name from the first ingredient."""
    first = ingredients_raw.split(",")[0].strip()
    first = re.sub(r"\s+Broth$", "", first, flags=re.IGNORECASE)
    return first if first else None


def _deduplicate_products(products: list[Product]) -> list[Product]:
    """Disambiguate products with duplicate names.

    - If two products share a name but have different ingredients, append the
      primary protein to each name.
    - If they share a name AND identical ingredients, keep only the first.
    """
    name_counts = Counter(p["name"] for p in products)
    duped_names = {n for n, c in name_counts.items() if c > 1}

    if not duped_names:
        return products

    groups: dict[str, list[Product]] = {}
    for p in products:
        if p["name"] in duped_names:
            groups.setdefault(p["name"], []).append(p)

    def _normalize_ing(raw: str) -> str:
        """Normalize ingredients for comparison."""
        s = raw.lower().strip()
        s = re.sub(r"\s*([()])\s*", r" \1 ", s)
        return re.sub(r"\s+", " ", s).strip()

    skip_urls: set[str] = set()
    for base_name, group in groups.items():
        ingredients = [_normalize_ing(p.get("ingredients_raw", "")) for p in group]
        if len(set(ingredients)) == 1:
            for p in group[1:]:
                skip_urls.add(p["url"])
                logger.info(f"  Skipping duplicate: {base_name} ({p['url']})")
        else:
            for p in group:
                protein = _primary_protein(p.get("ingredients_raw", ""))
                if protein:
                    p["name"] = f"{base_name} {protein}"

    return [p for p in products if p["url"] not in skip_urls]


def scrape_pedigree(output_dir: Path) -> int:
    """Scrape all Pedigree dog food products from PetSmart. Returns product count."""
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

    products = _deduplicate_products(products)

    write_brand_json("Pedigree", WEBSITE_URL, products, output_dir, slug="pedigree",
        ingredient_overrides=_INGREDIENT_OVERRIDES,
    )
    return len(products)
