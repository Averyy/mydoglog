"""Wellness scraper (via PetSmart.ca).

Data source: petsmart.ca — Next.js with React Server Components (RSC).
- Discovery: listing page at /dog/food/f/brand/wellness + XML sitemaps as supplement
- Detail: Product pages at petsmart.ca/dog/{food,treats}/{category}/{slug}-{sku}.html
- Metadata (name, SKU, image, UPC): JSON-LD <script type="application/ld+json">
- Nutritional data (ingredients, GA, calories): RSC flight payloads
  (self.__next_f.push([1,"..."])) containing escaped HTML

Key notes:
- WellPet LLC brand. ~74 listings on PetSmart.ca (includes size variants).
- Sub-brands: Complete Health, CORE, CORE+, CORE Digestive Health, Bowl Boosters,
  Protein Bowls, 95%, Stews. Simple LID is NOT on PetSmart.ca.
- Products span /dog/food/ and /dog/treats/ paths.
- Multi-flavor pages (Stews 6 flavors, Protein Bowls 8 flavors) — each flavor
  should have its own URL in sitemaps.
- Size variants need dedup.
- wafer-py handles Kasada bot protection
"""

import json
import logging
import re
from collections import Counter, defaultdict
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
from .common import parse_ga_text as parse_ga
from .petsmart import (
    detect_flavor_variants as _detect_flavor_variants,
    extract_rsc_text as _extract_rsc_text_shared,
    extract_rsc_texts_by_flavor as _extract_rsc_texts_by_flavor,
)

logger = logging.getLogger(__name__)

WEBSITE_URL = "https://www.petsmart.ca"

_LISTING_URL = f"{WEBSITE_URL}/dog/food/f/brand/wellness"
_SITEMAP_URLS = [f"{WEBSITE_URL}/sitemap_{i}.xml" for i in range(5)]


def _fetch_product_urls(session: SyncSession) -> list[str]:
    """Discover Wellness dog product URLs from PetSmart listing page + sitemaps."""
    urls: set[str] = set()

    # Primary: listing page (food only — treats come from sitemaps)
    resp = session.get(_LISTING_URL)
    if resp.ok:
        for m in re.finditer(
            r'href="(/dog/(?:food|treats)/[^"]*wellness[^"]*\.html)"',
            resp.text,
            re.IGNORECASE,
        ):
            urls.add(f"{WEBSITE_URL}{m.group(1)}")

    listing_count = len(urls)
    logger.info(f"Found {listing_count} Wellness dog URLs from listing page")

    # Supplement: sitemaps (catch treats and any products not on listing page)
    for sitemap_url in _SITEMAP_URLS:
        resp = session.get(sitemap_url)
        if not resp.ok:
            continue
        for m in re.finditer(
            r"<loc>(https://www\.petsmart\.ca/dog/(?:food|treats)/[^<]*wellness[^<]*\.html)</loc>",
            resp.text,
            re.IGNORECASE,
        ):
            urls.add(m.group(1))

    # Drop legacy "andtrade" URLs when a clean counterpart exists
    def _slug_key(url: str) -> str:
        slug = url.split("/")[-1].rsplit("-", 1)[0]
        slug = slug.replace("andtrade", "")
        return re.sub(r"-+", "-", slug).strip("-")

    slug_to_urls: dict[str, list[str]] = {}
    for u in urls:
        slug_to_urls.setdefault(_slug_key(u), []).append(u)

    deduped: set[str] = set()
    for slug, group in slug_to_urls.items():
        if len(group) == 1:
            deduped.add(group[0])
        else:
            clean = [u for u in group if "andtrade" not in u]
            legacy = [u for u in group if "andtrade" in u]
            if clean:
                deduped.update(clean)
                for u in legacy:
                    logger.info(f"Dropping legacy andtrade URL: {u}")
            else:
                deduped.update(group)

    logger.info(
        f"Found {len(deduped)} total Wellness dog URLs "
        f"({listing_count} listing + {len(deduped) - listing_count} new from sitemaps, "
        f"{len(urls) - len(deduped)} legacy dropped)"
    )
    return sorted(deduped)


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

    Uses the shared petsmart.py implementation which supplements the primary
    chunk with GA/calorie data from other chunks when missing.
    """
    return _extract_rsc_text_shared(html)


def _parse_ingredients(text: str) -> str | None:
    """Extract ingredients from RSC payload text."""
    m = re.search(
        r"Ingredients\s*:\s*\n(.*?)(?:\n\s*(?:Guaranteed|Caloric|Feeding|Directions|AAFCO)|$)",
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

    # Fallback: "NNN calories per cup" without kcal
    m = re.search(r"(\d+)\s+calories?\s+per\s+cup", text, re.IGNORECASE)
    if m:
        return f"{m.group(1)} kcal/cup"

    return None


def _detect_sub_brand(name: str) -> str | None:
    """Detect Wellness sub-brand from product name."""
    name_lower = name.lower()
    # Check specific patterns before generic ones
    if "core digestive health" in name_lower:
        return "CORE Digestive Health"
    if "core+" in name_lower:
        return "CORE+"
    # CORE+ products may use "Freeze-Dried Pieces" or "Kibble + Freeze-Dried"
    if "core" in name_lower and "freeze-dried" in name_lower:
        return "CORE+"
    if "bowl booster" in name_lower:
        return "Bowl Boosters"
    if "core" in name_lower:
        return "CORE"
    if "complete health" in name_lower:
        return "Complete Health"
    if "95%" in name_lower or "ninety-five" in name_lower:
        return "95%"
    if "protein bowl" in name_lower:
        return "Protein Bowls"
    return None


def _detect_type(url: str, name: str) -> str:
    """Detect product type: food, treat, or supplement."""
    url_lower = url.lower()
    name_lower = name.lower()

    if "/treats/" in url_lower:
        return "treat"
    if "food-toppers" in url_lower or "topper" in name_lower:
        return "supplement"
    if "bowl booster" in name_lower:
        return "supplement"
    if "95%" in name_lower or "ninety-five" in name_lower:
        return "supplement"
    if re.search(r"\btreat", name_lower) or "puppy bites" in name_lower:
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
    if "stew" in name_lower:
        return "wet"
    if "protein bowl" in name_lower:
        return "wet"
    if "95%" in name_lower or "ninety-five" in name_lower:
        return "wet"
    if "bowl booster" in name_lower and "freeze-dried" not in name_lower:
        return "wet"
    if "/treats/" in url_lower:
        return "dry"
    return "dry"


def _detect_life_stage(name: str) -> str | None:
    """Detect life stage from product name."""
    name_lower = name.lower()
    if "puppy" in name_lower:
        return "puppy"
    if "senior" in name_lower or "age advantage" in name_lower:
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
    if "small breed" in name_lower or "small & toy" in name_lower or "small bite" in name_lower:
        return "Small"
    if "medium breed" in name_lower:
        return "Medium"
    return None


def _parse_products(url: str, html: str) -> list[Product]:
    """Parse a Wellness product page from PetSmart.

    Returns multiple products when the page has flavor variants (e.g. 95% line
    with Chicken, Beef, Lamb, Turkey flavors on one page). Each flavor gets its
    own Product with distinct name, ingredients, GA, and calories.
    """
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
        return []

    name = clean_text(name)

    # Strip "Wellness " or "Wellness® " brand prefix
    name = re.sub(r"^Wellness\s*®?\s*", "", name, flags=re.IGNORECASE)

    # Strip trailing size: ", 5.5 oz", "- 13 Oz.", ", 34 lb"
    name = re.sub(
        r"[,\s]*-?\s*\d+\.?\d*\s*(?:oz|lb|g|kg|ml)\.?(?:\s*,\s*\d+\s*count)?\s*$",
        "",
        name,
        flags=re.IGNORECASE,
    )

    # Strip "- Natural, " mid-name (keeps descriptor after it)
    name = re.sub(r"\s*-\s*Natural,\s*", " - ", name, flags=re.IGNORECASE)
    # Strip "- Natural" at end of name
    name = re.sub(r"\s*-\s*Natural\s*$", "", name, flags=re.IGNORECASE)

    # Verify this is actually a Wellness brand product via the brand link on the page
    brand_match = re.search(
        r'data-testid="test-pdp-brand"[^>]*>([^<]+)</a>', html
    )
    if brand_match:
        page_brand = brand_match.group(1).strip().lower()
        if "wellness" not in page_brand:
            logger.info(f"  Skipping non-Wellness product (brand={brand_match.group(1).strip()}): {name}")
            return []

    # Filter out cat products
    if re.search(r"\bcat\b", name, re.IGNORECASE) and "catch" not in name.lower():
        logger.info(f"  Skipping cat product: {name}")
        return []
    if "/cat/" in url.lower():
        logger.info(f"  Skipping cat product: {name}")
        return []

    # Skip variety packs
    name_lower = name.lower()
    url_lower = url.lower()
    if "variety pack" in name_lower or "variety-pack" in url_lower:
        logger.info(f"  Skipping variety pack: {name}")
        return []
    if "multi value pack" in name_lower or "multipack" in name_lower:
        logger.info(f"  Skipping multi-pack: {name}")
        return []

    # Detect flavor variants — if multiple flavors, split into separate products
    flavors = _detect_flavor_variants(html)
    if len(flavors) > 1:
        return _parse_multi_flavor(url, html, soup, name, ld_products, flavors)

    # Single-flavor product (standard path)
    product: Product = {
        "name": name,
        "brand": "Wellness",
        "url": url,
        "channel": "retail",
        "product_type": _detect_type(url, name),
        "product_format": _detect_format(url, name),
    }

    sub_brand = _detect_sub_brand(name)
    if sub_brand:
        product["sub_brand"] = sub_brand

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

        ga = parse_ga(rsc_text)
        if ga:
            product["guaranteed_analysis"] = ga
            product["guaranteed_analysis_basis"] = "as-fed"

        cal = _parse_calories(rsc_text)
        if cal:
            product["calorie_content"] = cal

    return [product]


def _parse_multi_flavor(
    url: str,
    html: str,
    soup: BeautifulSoup,
    base_name: str,
    ld_products: list[dict],
    flavors: list[str],
) -> list[Product]:
    """Split a multi-flavor PetSmart page into separate products.

    Each flavor gets its own Product with:
    - Name suffixed with flavor (e.g. "95% ... Grain Free Chicken")
    - Its own ingredients, GA, and calorie data from flavor-specific RSC chunk
    - Matched JSON-LD variant (SKU/UPC) via Item Number in RSC text
    """
    flavor_texts = _extract_rsc_texts_by_flavor(html, flavors)
    if not flavor_texts:
        logger.warning(f"  Multi-flavor page but no per-flavor RSC data: {base_name}")
        return []

    # Build SKU -> JSON-LD mapping for per-flavor variant assignment
    sku_to_ld: dict[str, dict] = {}
    for ld_item in ld_products:
        sku = ld_item.get("sku")
        if sku:
            sku_to_ld[str(sku)] = ld_item

    products: list[Product] = []
    for flavor, rsc_text in flavor_texts.items():
        product: Product = {
            "name": f"{base_name} {flavor}",
            "brand": "Wellness",
            "url": url,
            "channel": "retail",
            "product_type": _detect_type(url, base_name),
            "product_format": _detect_format(url, base_name),
        }

        sub_brand = _detect_sub_brand(base_name)
        if sub_brand:
            product["sub_brand"] = sub_brand

        life_stage = _detect_life_stage(base_name)
        if life_stage:
            product["life_stage"] = life_stage

        breed_size = _detect_breed_size(base_name)
        if breed_size:
            product["breed_size"] = breed_size

        # Match this flavor to its JSON-LD entry via Item Number in RSC text
        item_match = re.search(r"Item Number:\s*(\d+)", rsc_text)
        if item_match:
            sku = item_match.group(1)
            product["source_id"] = sku
            ld_item = sku_to_ld.get(sku)
            if ld_item:
                gtin = ld_item.get("gtin13")
                variant: Variant = {"size_kg": 0.0, "size_description": ""}
                if gtin:
                    variant["upc"] = gtin
                variant["sku"] = sku
                product["variants"] = [variant]

                img = ld_item.get("image")
                if isinstance(img, str) and img.startswith("http"):
                    product["images"] = [img]

        # Extract nutritional data from this flavor's RSC text
        ingredients = _parse_ingredients(rsc_text)
        if ingredients:
            product["ingredients_raw"] = ingredients

        ga = parse_ga(rsc_text)
        if ga:
            product["guaranteed_analysis"] = ga
            product["guaranteed_analysis_basis"] = "as-fed"

        cal = _parse_calories(rsc_text)
        if cal:
            product["calorie_content"] = cal

        products.append(product)
        logger.info(f"  Multi-flavor: {product['name']}")

    return products


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


def _deduplicate_products(products: list[Product]) -> list[Product]:
    """Remove duplicate products.

    Two passes:
    1. Exact name dupes — same name + same ingredients -> keep first.
       Same name + different ingredients -> append primary protein to disambiguate.
    2. Size-variant dupes — different names but same (life_stage, breed_size,
       format, sub_brand, product_type, ingredients) -> keep shortest name.

    Uses object identity (id()) not URLs, since multi-flavor pages produce
    multiple products sharing the same URL.
    """
    # Pass 1: exact name duplicates
    name_counts = Counter(p["name"] for p in products)
    duped_names = {n for n, c in name_counts.items() if c > 1}

    skip_ids: set[int] = set()
    if duped_names:
        groups: dict[str, list[Product]] = {}
        for p in products:
            if p["name"] in duped_names:
                groups.setdefault(p["name"], []).append(p)

        for base_name, group in groups.items():
            ingredients = [_normalize_ing(p.get("ingredients_raw", "")) for p in group]
            if len(set(ingredients)) == 1:
                for p in group[1:]:
                    skip_ids.add(id(p))
                    logger.info(f"  Skipping name duplicate: {base_name} ({p['url']})")
            else:
                for p in group:
                    protein = _primary_protein(p.get("ingredients_raw", ""))
                    if protein:
                        p["name"] = f"{base_name} {protein}"

    products = [p for p in products if id(p) not in skip_ids]

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

    skip_ids = set()
    for key, group in identity_groups.items():
        if len(group) <= 1:
            continue
        # Keep the product with the shortest name (most canonical)
        group.sort(key=lambda p: len(p["name"]))
        keep = group[0]
        for p in group[1:]:
            skip_ids.add(id(p))
            logger.info(
                f"  Skipping size variant: {p['name']} "
                f"(keeping {keep['name']})"
            )

    return [p for p in products if id(p) not in skip_ids]


def scrape_wellness(output_dir: Path) -> int:
    """Scrape all Wellness dog food products from PetSmart. Returns product count."""
    with SyncSession(rate_limit=1.0) as session:
        urls = _fetch_product_urls(session)

        products: list[Product] = []
        for i, url in enumerate(urls):
            logger.info(f"  [{i + 1}/{len(urls)}] {url}")
            resp = session.get(url)
            if not resp.ok:
                logger.warning(f"Failed to fetch {url}: {resp.status_code}")
                continue

            parsed = _parse_products(url, resp.text)
            products.extend(parsed)

    # Warn about products missing ingredients but keep them
    for p in products:
        if not p.get("ingredients_raw"):
            logger.warning(f"  Missing ingredients: {p['name']}")

    products = _deduplicate_products(products)

    write_brand_json("Wellness", WEBSITE_URL, products, output_dir, slug="wellness")
    return len(products)
