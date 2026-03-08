"""Canadian Naturals scraper.

Data source: WordPress HTML.
- Listing: Discover product URLs from category/team pages
- Detail: HTML page parse
- Ingredients: In a <p> tag containing <strong>Ingredients:</strong> followed by comma-separated text
- GA: <ul> list items ("Protein 24%min", "Fat 14%min", etc.) — custom parser
- Calories: In GA <ul> as "Calorie Content: XXXX kcal per kg (XXX kcal per cup)"
- Images: Product image in .single-team-details <img> (no og:image on this site)

Key notes:
- Product URLs follow /team/{slug}/ pattern
- Product lines: Value Series, LID, Omega Fresh, Grain Free, Classic
- All retail channel
- Product name from first .speaker-bio div or <title> tag (h1 is empty)
- Deduplication by product name (some products have multiple URL paths)
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
    normalize_calorie_content,
    write_brand_json,
)

logger = logging.getLogger(__name__)

WEBSITE_URL = "https://canadiannaturals.com"

# Supplementary calorie data for products where canadiannaturals.com omits the
# calorie line from its GA section. Values verified against multiple retailers
# (PetValu FCM07855, homesalive.ca, petland.ca, bluebarn.shop — all list
# identical figures on the bag). Keyed by URL slug (the /team/{slug} portion).
_SUPPLEMENTARY_CALORIES: dict[str, str] = {
    "lamb-rice-large-breed": "3551 kcal/kg, 378 kcal/cup",
}

_SITEMAP_URL = f"{WEBSITE_URL}/wp-sitemap-posts-team-1.xml"

# Recipes listing page (contains links to all /team/ product pages)
_LISTING_URL = f"{WEBSITE_URL}/our-recipes/"


def _fetch_product_urls(session: SyncSession) -> list[str]:
    """Discover product URLs from WP sitemap or recipes listing page."""
    urls: set[str] = set()

    # Try WordPress post-type sitemap first (most reliable)
    resp = session.get(_SITEMAP_URL)
    if resp.ok and "<?xml" in resp.text[:100]:
        try:
            from xml.etree import ElementTree

            root = ElementTree.fromstring(resp.text)
            ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
            for url_elem in root.findall(".//sm:url/sm:loc", ns):
                url = url_elem.text
                if url and "/team/" in url:
                    urls.add(url.strip().rstrip("/"))
        except ElementTree.ParseError:
            pass

    # Fallback: recipes listing page
    if not urls:
        resp = session.get(_LISTING_URL)
        if resp.ok:
            soup = BeautifulSoup(resp.text, "lxml")
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if "/team/" in href:
                    if not href.startswith("http"):
                        href = f"{WEBSITE_URL}{href}"
                    urls.add(href.rstrip("/"))

    # Filter out non-product URLs (e.g. /team/ index)
    urls = {u for u in urls if not u.endswith("/team/") and u.count("/") >= 4}

    logger.info(f"Found {len(urls)} product URLs")
    return sorted(urls)


def _is_dog_product(url: str, soup: BeautifulSoup) -> bool:
    """Check if this is a dog product (not cat)."""
    url_lower = url.lower()
    if "cat" in url_lower and "dog" not in url_lower:
        return False

    text = soup.get_text()[:1000].lower()
    if "for dogs" in text or "dog food" in text or "for dog" in text:
        return True
    if "for cats" in text and "dog" not in text:
        return False

    # Default: include (might be ambiguous)
    return True


def _detect_product_line(soup: BeautifulSoup) -> str | None:
    """Detect product line from page content."""
    text = soup.get_text().lower()
    if "value series" in text:
        return "Value Series"
    if "limited ingredient" in text or "l.i.d." in text:
        return "Limited Ingredient"
    if "omega fresh" in text:
        return "Omega Fresh"
    if "grain free" in text:
        return "Grain Free"
    return None


def _detect_type(url: str, title: str) -> str:
    """Detect product type: food, treat, or supplement."""
    combined = f"{url} {title}".lower()
    if "treat" in combined:
        return "treat"
    return "food"


def _detect_format(url: str, title: str) -> str:
    """Detect product format: dry or wet."""
    combined = f"{url} {title}".lower()
    if "canned" in combined or "can " in combined or "stew" in combined:
        return "wet"
    return "dry"


def _parse_name(soup: BeautifulSoup) -> str | None:
    """Extract product name from first speaker-bio div or title tag.

    The site uses WordPress "team" CPT. The first .speaker-bio div contains:
        <h3>Product Name</h3>
        <p>Product Line / Tagline</p>
    We extract the <h3> text specifically to avoid picking up the tagline.
    h1 is empty on these pages. Other h3 tags on the page are unreliable
    because customer review titles also use h3.
    """
    # Primary: <h3> inside first .speaker-bio div
    speaker_bio = soup.find("div", class_="speaker-bio")
    if speaker_bio:
        h3 = speaker_bio.find("h3")
        if h3:
            name = clean_text(h3.get_text(strip=True))
            if name and len(name) >= 5:
                return name
        # Fallback: full div text if no h3
        text = speaker_bio.get_text(strip=True)
        if text and len(text) >= 5:
            name = clean_text(text)
            if name and len(name) >= 5:
                return name

    # Fallback: <title> tag — format "Product Name – Canadian Naturals"
    title_tag = soup.find("title")
    if title_tag:
        title_text = title_tag.get_text(strip=True)
        # Remove site name suffix
        for sep in [" \u2013 ", " - ", " | "]:
            if sep in title_text:
                title_text = title_text.split(sep)[0].strip()
                break
        if title_text and len(title_text) >= 3:
            return clean_text(title_text)

    return None


def _parse_ingredients(soup: BeautifulSoup) -> str | None:
    """Extract ingredients from the <p> tag containing <strong>Ingredients:</strong>.

    The HTML structure is:
        <p><strong>Ingredients:</strong>Chicken meal, ground oats, ...</p>

    We extract only the text content of that <p> tag, stripping the
    "Ingredients:" prefix. This avoids pulling in nav menus, reviews,
    or other page chrome that appears in get_text() output.
    """
    # Find <strong> or <b> tag containing "Ingredients"
    for tag in soup.find_all(["strong", "b"]):
        tag_text = tag.get_text(strip=True)
        if tag_text.lower().startswith("ingredients"):
            # The parent <p> contains the full ingredient list
            parent = tag.parent
            if parent and parent.name == "p":
                full_text = parent.get_text()
                # Strip "Ingredients:" prefix
                match = re.match(
                    r"\s*Ingredients:?\s*",
                    full_text,
                    re.IGNORECASE,
                )
                if match:
                    ingredients = full_text[match.end() :].strip()
                else:
                    ingredients = full_text.strip()
                ingredients = clean_text(ingredients)
                if len(ingredients) > 20:
                    return ingredients

    return None


def _parse_ga_text(soup: BeautifulSoup) -> tuple[GuaranteedAnalysis | None, str | None]:
    """Parse GA from <ul> list items.

    The HTML structure is:
        <div>Guaranteed Analysis:</div>
        <ul class="cbox double-column-list">
            <li>Protein 24%min</li>
            <li>Fat 14%min</li>
            ...
            <li>Calorie Content: 3746 kcal per kg (400 kcal per cup)</li>
        </ul>

    Returns (ga, calorie_content).
    """
    ga: dict[str, float] = {}
    calorie_raw: str | None = None

    # Find the GA heading, then the next <ul>
    ga_heading = None
    for tag in soup.find_all(string=lambda s: s and "guaranteed analysis" in s.lower()):
        ga_heading = tag
        break

    if not ga_heading:
        return None, None

    # Navigate to the container and find the next <ul>
    container = ga_heading.parent if hasattr(ga_heading, "parent") else None
    if not container:
        return None, None

    # Walk up if needed to find the div-level container
    if container.name not in ("div", "td", "section"):
        container = container.parent

    ul = container.find_next("ul") if container else None
    if not ul:
        # Fallback: try text-based parsing
        return _parse_ga_from_text(soup)

    for li in ul.find_all("li"):
        line = li.get_text(strip=True)
        if not line:
            continue

        # Check for calorie content
        if "calorie" in line.lower() or "kcal" in line.lower():
            calorie_raw = line
            continue

        # Parse GA values: "Protein 24%min" or "Fat 14%min"
        # Also handle ".40%min" (leading dot) for omega-3
        m = re.match(
            r"([\w\s-]+?)\s+(\.?\d+\.?\d*)\s*%\s*(min|max)?",
            line,
            re.IGNORECASE,
        )
        if m:
            label = m.group(1).strip().lower()
            value = float(m.group(2))
            suffix = m.group(3)

            field = _map_ga_field(label, suffix)
            if field:
                ga[field] = value

    ga_result = ga if ga else None
    cal_result = normalize_calorie_content(calorie_raw) if calorie_raw else None

    return ga_result, cal_result  # type: ignore[return-value]


def _parse_ga_from_text(soup: BeautifulSoup) -> tuple[GuaranteedAnalysis | None, str | None]:
    """Fallback GA parser using page text (if <ul> structure is not found)."""
    text = soup.get_text(separator="\n")

    ga_match = re.search(
        r"Guaranteed Analysis:?\s*\n(.*?)(?:\n\s*Feeding|$)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if not ga_match:
        return None, None

    ga_text = ga_match.group(1)
    ga: dict[str, float] = {}
    calorie_raw: str | None = None

    for line in ga_text.split("\n"):
        line = line.strip("- \u2022*\t ")
        if not line:
            continue

        if "calorie" in line.lower() or "kcal" in line.lower():
            calorie_raw = line
            continue

        m = re.match(
            r"([\w\s-]+?)\s+(\.?\d+\.?\d*)\s*%\s*(min|max)?",
            line,
            re.IGNORECASE,
        )
        if m:
            label = m.group(1).strip().lower()
            value = float(m.group(2))
            suffix = m.group(3)

            field = _map_ga_field(label, suffix)
            if field:
                ga[field] = value

    ga_result = ga if ga else None
    cal_result = normalize_calorie_content(calorie_raw) if calorie_raw else None

    return ga_result, cal_result  # type: ignore[return-value]


# GA label map — ordered with longer/more-specific patterns FIRST so that
# "omega-6 fatty acids" matches "omega-6" before falling through to "fat".
_GA_TEXT_MAP: list[tuple[str, str, str]] = [
    ("omega-6 fatty acid", "omega_6", "min"),
    ("omega 6 fatty acid", "omega_6", "min"),
    ("omega-6", "omega_6", "min"),
    ("omega 6", "omega_6", "min"),
    ("omega-3 fatty acid", "omega_3", "min"),
    ("omega 3 fatty acid", "omega_3", "min"),
    ("omega-3", "omega_3", "min"),
    ("omega 3", "omega_3", "min"),
    ("protein", "crude_protein", "min"),
    ("fat", "crude_fat", "min"),
    ("fiber", "crude_fiber", "max"),
    ("fibre", "crude_fiber", "max"),
    ("moisture", "moisture", "max"),
    ("ash", "ash", "max"),
    ("calcium", "calcium", "min"),
    ("phosphorus", "phosphorus", "min"),
]


def _map_ga_field(label: str, suffix: str | None) -> str | None:
    """Map a Canadian Naturals GA label to field name.

    Uses ordered list so longer/more-specific patterns match first,
    preventing "fat" from matching "omega-6 fatty acids".
    """
    for pattern, field_base, default_suffix in _GA_TEXT_MAP:
        if pattern in label:
            s = suffix.lower() if suffix else default_suffix
            return f"{field_base}_{s}"
    return None


def _parse_images(soup: BeautifulSoup) -> list[str]:
    """Extract product images from the page.

    Canadian Naturals does not use og:image. Product images are in
    <img> tags within the .single-team-details container. We filter
    out broken images (empty filenames like ".png") and logos.
    """
    images: list[str] = []
    seen: set[str] = set()

    # Look for product images in the team details container
    team_div = soup.find(
        "div",
        class_=lambda c: c and "single-team-details" in c,
    )
    if team_div:
        for img in team_div.find_all("img"):
            src = img.get("src", "")
            if not isinstance(src, str) or not src.startswith("http"):
                continue
            # Skip broken images (filename is just ".png" or similar)
            filename = src.rsplit("/", 1)[-1] if "/" in src else src
            if re.match(r"^\.?\w{0,3}$", filename):
                continue
            # Skip logos and icons
            if "logo" in src.lower() or "icon" in src.lower():
                continue
            # Strip WordPress dimension suffix to get original upload
            # e.g. image-name-1024x1024.png → image-name.png
            src = re.sub(r"-\d+x\d+(\.\w+)$", r"\1", src)
            if src not in seen:
                images.append(src)
                seen.add(src)

    # Fallback: og:image (in case site adds it later)
    if not images:
        og_img = soup.find("meta", property="og:image")
        if og_img and isinstance(og_img, Tag):
            src = og_img.get("content", "")
            if src and isinstance(src, str) and src.startswith("http"):
                images.append(src)

    return images


def _parse_product(url: str, html: str) -> Product | None:
    """Parse a Canadian Naturals product page."""
    soup = BeautifulSoup(html, "lxml")

    if not _is_dog_product(url, soup):
        return None

    name = _parse_name(soup)
    if not name or len(name) < 3:
        return None

    product: Product = {
        "name": name,
        "brand": "Canadian Naturals",
        "url": url,
        "channel": "retail",
        "product_type": _detect_type(url, name),
        "product_format": _detect_format(url, name),
    }

    product_line = _detect_product_line(soup)
    if product_line:
        product["product_line"] = product_line

    ingredients = _parse_ingredients(soup)
    if ingredients:
        product["ingredients_raw"] = ingredients

    ga, cal = _parse_ga_text(soup)
    if ga:
        product["guaranteed_analysis"] = ga
        product["guaranteed_analysis_basis"] = "as-fed"

    # Fallback: use supplementary calorie data if the page omits it
    if not cal:
        slug = url.rstrip("/").rsplit("/", 1)[-1]
        cal = _SUPPLEMENTARY_CALORIES.get(slug)
        if cal:
            logger.info(f"  Using supplementary calorie data for {slug}")

    if cal:
        product["calorie_content"] = cal

    images = _parse_images(soup)
    if images:
        product["images"] = images

    return product


def scrape_canadiannaturals(output_dir: Path) -> int:
    """Scrape all Canadian Naturals dog food products. Returns product count."""
    with SyncSession(rate_limit=1.0) as session:
        urls = _fetch_product_urls(session)

        products: list[Product] = []
        seen_names: set[str] = set()

        for i, url in enumerate(urls):
            logger.info(f"  [{i + 1}/{len(urls)}] {url}")
            resp = session.get(url)
            if not resp.ok:
                logger.warning(f"Failed to fetch {url}: {resp.status_code}")
                continue

            product = _parse_product(url, resp.text)
            if product:
                # Deduplicate by normalized product name
                name_key = product["name"].lower().strip()
                if name_key in seen_names:
                    logger.info(f"    Skipping duplicate: {product['name']}")
                    continue
                seen_names.add(name_key)
                products.append(product)

    write_brand_json(
        "Canadian Naturals",
        WEBSITE_URL,
        products,
        output_dir,
        slug="canadiannaturals",
    )
    return len(products)
