#!/usr/bin/env python3
"""
Validate loaded products against the MyVetStore product catalog.

Reads docs/myvetstore-products.md, parses the product tables, then queries
the database for each product using ILIKE fuzzy name matching filtered by
manufacturer/brand. Reports any products not found in the database.

Usage:
    cd scraper && uv run python validate.py
"""

import os
import re
import sys
from pathlib import Path

import psycopg2

DOCS_DIR = Path(__file__).parent.parent / "docs"
MYVETSTORE_PATH = DOCS_DIR / "myvetstore-products.md"

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://mydoglog:password@localhost:5433/mydoglog",
)

# Map MyVetStore manufacturer names to our brand names
MANUFACTURER_TO_BRAND: dict[str, str] = {
    "Nestle Purina": "Purina",
    "Hill's": "Hill's",
    "Royal Canin": "Royal Canin",
    "Rayne": "Rayne",
    "Virbac": "Virbac",
    "Farmina": "Farmina",
    "The Nutro Company": "The Nutro Company",
    "Grey Wolf Animal Health": "Grey Wolf Animal Health",
    "Kong": "Kong",
    "MedVant": "MedVant",
    "Dechra": "Dechra",
    "Ubavet": "Ubavet",
    "Pure Treats": "PureBites",
    "Benny Bullys": "Benny Bullys",
    "Aventix": "Aventix",
    "Crumps'": "Crumps'",
}


def parse_myvetstore_products(filepath: Path) -> list[dict[str, str]]:
    """Parse the markdown tables in myvetstore-products.md.

    Returns a list of dicts with 'name' and 'manufacturer' keys.
    """
    products: list[dict[str, str]] = []
    text = filepath.read_text()

    # Find all table rows (lines starting with |)
    for line in text.split("\n"):
        line = line.strip()
        if not line.startswith("|"):
            continue
        # Skip header rows and separator rows
        if "---" in line or "Product" in line and "Manufacturer" in line:
            continue

        parts = [p.strip() for p in line.split("|")]
        # Filter empty parts from leading/trailing pipes
        parts = [p for p in parts if p]
        if len(parts) < 3:
            continue

        # Try to detect the row number in first column
        try:
            int(parts[0])
        except ValueError:
            continue

        product_name = parts[1].strip()
        manufacturer = parts[2].strip()

        # Skip out of stock items
        if "(OUT OF STOCK)" in product_name:
            product_name = product_name.replace("(OUT OF STOCK)", "").strip()

        # Skip cat products
        if "Feline" in product_name:
            continue

        products.append({
            "name": product_name,
            "manufacturer": manufacturer,
        })

    return products


NOISE_WORDS = {
    "dog", "food", "wet", "dry", "canine", "diet", "formula", "recipe",
    "for", "with", "and", "the", "in", "of", "a",
}

# Prefixes that myvetstore adds but scraped names don't have
STRIP_PREFIXES = [
    "Prescription Diet",
    "Science Diet",
    "Veterinary Diet",
    "Size Health Nutrition",
    "Breed Health Nutrition",
    "Canine Health Nutrition",
    "Pro Plan Veterinary Diets",
]

# Words to strip after prefix removal (myvetstore adds these but scraped names don't)
STRIP_WORDS = ["Canine", "Multifunction"]

# Hill's formula code pattern (e.g., z/d, i/d, t/d, c/d, k/d, l/d, w/d, u/d, j/d, r/d)
HILLS_FORMULA_RE = re.compile(r"\b([a-z]/[a-z])\b", re.IGNORECASE)


def _clean_name(name: str) -> str:
    """Strip brand-specific prefixes and common suffixes from a product name."""
    cleaned = name
    for prefix in STRIP_PREFIXES:
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip()
    # Strip leading noise words (e.g., "Canine" in "Canine Diabetic")
    for word in STRIP_WORDS:
        if cleaned.startswith(word + " "):
            cleaned = cleaned[len(word):].strip()
    # Strip trailing noise like "Dog Food", "Wet Food", "Dry Dog Food", "Diet"
    cleaned = re.sub(r"\s+(Dry\s+)?Dog\s+Food(\s+Wet\s+Food)?$", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+Wet\s+Food$", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+Dry$", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+Diet$", "", cleaned, flags=re.IGNORECASE)
    # Strip parenthesized format hints like "(TetraPak)", "(Canned)"
    cleaned = re.sub(r"\s*\([^)]+\)$", "", cleaned)
    return cleaned.strip()


def _significant_words(name: str) -> list[str]:
    """Extract significant (non-noise) words from a product name."""
    words = re.findall(r"[\w/\'-]+", name)
    return [w for w in words if w.lower() not in NOISE_WORDS and len(w) > 1]


def _run_query(
    cur: "psycopg2.extensions.cursor",
    pattern: str,
    brand_name: str,
) -> list[tuple[str, str]]:
    cur.execute(
        """
        SELECT p.name, b.name AS brand_name
        FROM products p
        JOIN brands b ON p.brand_id = b.id
        WHERE p.name ILIKE %s AND b.name = %s
        LIMIT 5
        """,
        (pattern, brand_name),
    )
    return cur.fetchall()


def find_product_in_db(
    cur: "psycopg2.extensions.cursor",
    product_name: str,
    brand_name: str,
) -> list[tuple[str, str]]:
    """Search for a product using progressively looser ILIKE matching.

    Returns list of (product_name, brand_name) tuples found.
    """
    cleaned = _clean_name(product_name)

    # 1. Try full cleaned name as substring
    results = _run_query(cur, f"%{cleaned}%", brand_name)
    if results:
        return results

    # 2. For Hill's, try matching on formula code (z/d, i/d, etc.) + key words
    formula_match = HILLS_FORMULA_RE.search(cleaned)
    if formula_match:
        code = formula_match.group(1)
        # Get other significant words after the formula code
        rest = cleaned[formula_match.end():].strip()
        extra_words = _significant_words(rest)
        # Match: formula code + first distinctive word (e.g., "Small Bites", "Low Fat", "Chicken")
        if extra_words:
            for word in extra_words[:2]:
                pattern = f"%{code}%{word}%"
                results = _run_query(cur, pattern, brand_name)
                if results:
                    return results
        # Just formula code with brand
        results = _run_query(cur, f"%{code}%", brand_name)
        if results:
            return results

    # 3. Significant-word overlap: build ILIKE pattern from key words
    sig_words = _significant_words(cleaned)
    if len(sig_words) >= 2:
        # Try first 3 significant words
        for n in (min(3, len(sig_words)), 2):
            pattern = "%".join(f"%{w}" for w in sig_words[:n]) + "%"
            results = _run_query(cur, pattern, brand_name)
            if results:
                return results

    # 4. Try just the first 2 significant words without order constraint
    if len(sig_words) >= 2:
        for w1, w2 in [(sig_words[0], sig_words[1])]:
            # Try both orderings
            for pattern in [f"%{w1}%{w2}%", f"%{w2}%{w1}%"]:
                results = _run_query(cur, pattern, brand_name)
                if results:
                    return results

    # 5. Single most-distinctive word (skip very common words)
    if sig_words:
        pattern = f"%{sig_words[0]}%"
        results = _run_query(cur, pattern, brand_name)
        if results:
            return results

    # 6. Try original name with just prefix stripping (no word cleaning)
    for prefix in STRIP_PREFIXES:
        if product_name.startswith(prefix):
            stripped = product_name[len(prefix):].strip()
            results = _run_query(cur, f"%{stripped}%", brand_name)
            if results:
                return results

    return []


def main() -> None:
    if not MYVETSTORE_PATH.exists():
        print(f"ERROR: {MYVETSTORE_PATH} not found.", file=sys.stderr)
        sys.exit(1)

    products = parse_myvetstore_products(MYVETSTORE_PATH)
    print(f"Parsed {len(products)} products from myvetstore-products.md")

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    found = 0
    missing: list[dict[str, str]] = []
    skipped = 0

    try:
        for product in products:
            manufacturer = product["manufacturer"]
            brand_name = MANUFACTURER_TO_BRAND.get(manufacturer, manufacturer)

            # Skip brands we haven't scraped
            cur.execute("SELECT 1 FROM brands WHERE name = %s", (brand_name,))
            if not cur.fetchone():
                skipped += 1
                continue

            results = find_product_in_db(cur, product["name"], brand_name)
            if results:
                found += 1
            else:
                missing.append(product)
    finally:
        cur.close()
        conn.close()

    # Report
    total = len(products) - skipped
    print(f"\n=== Validation Summary ===")
    print(f"  Total myvetstore products: {len(products)}")
    print(f"  Skipped (brand not scraped): {skipped}")
    print(f"  Checked: {total}")
    print(f"  Found: {found}")
    print(f"  Missing: {len(missing)}")
    if total > 0:
        print(f"  Coverage: {found / total * 100:.1f}%")

    if missing:
        print(f"\n--- Missing products ({len(missing)}) ---")
        for p in missing:
            print(f"  [{p['manufacturer']}] {p['name']}")

    if missing:
        sys.exit(1)
    else:
        print("\nAll products found!")


if __name__ == "__main__":
    main()
