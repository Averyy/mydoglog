#!/usr/bin/env python3
"""
Load scraped dog food data into PostgreSQL.

Reads brand JSONs from scraper/data/brands/, manual_products.json, and
ingredient_families.json, then upserts brands, products, ingredients,
product_ingredients, and cross-reactivity groups into the database.

Usage:
    cd scraper && uv run python build.py
"""

import json
import os
import sys
from pathlib import Path
from typing import Any
from uuid import uuid4

import psycopg2
import psycopg2.extras

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = SCRIPT_DIR / "data"
BRANDS_DIR = DATA_DIR / "brands"
MANUAL_PRODUCTS_PATH = DATA_DIR / "manual_products.json"
FAMILIES_PATH = DATA_DIR / "ingredient_families.json"

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://mydoglog:password@localhost:5433/mydoglog",
)

# ---------------------------------------------------------------------------
# Enum mappings — map JSON values to DB enum values
# ---------------------------------------------------------------------------

PRODUCT_TYPE_MAP: dict[str, str] = {
    "dry": "dry_food",
    "dry_food": "dry_food",
    "wet": "wet_food",
    "wet_food": "wet_food",
    "treats": "treat",
    "treat": "treat",
    "topper": "topper",
    "supplement": "supplement",
    "supplements": "supplement",
    "probiotic": "probiotic",
    "freeze_dried": "freeze_dried",
    "whole_food": "whole_food",
}

CHANNEL_MAP: dict[str, str] = {
    "retail": "retail",
    "vet": "vet",
    "seed": "seed",
}

# source_group values allowed by the DB enum
VALID_SOURCE_GROUPS = {
    "poultry", "red_meat", "fish", "grain", "legume",
    "root", "fruit", "dairy", "egg", "other",
}

SOURCE_GROUP_MAP: dict[str, str] = {
    "exotic": "other",
    "mammal": "red_meat",
    "seed": "other",
    "vegetable": "other",
    "animal": "other",
    "unknown": "other",
}

# form_type values allowed by the DB enum
VALID_FORM_TYPES = {
    "raw", "meal", "by_product", "fat", "oil", "hydrolyzed", "flour", "bran",
}

FORM_TYPE_MAP: dict[str, str] = {
    "whole": "raw",
    "organ": "raw",
    "dried": "raw",
    "concentrate": "raw",
    "starch": "raw",
    "fiber": "raw",
    "broth": "raw",
    "gluten": "raw",
    "derivative": "raw",
    "ground": "raw",
    "extract": "raw",
}


# ---------------------------------------------------------------------------
# Ingredient parsing (bracket-aware comma splitting)
# ---------------------------------------------------------------------------

def parse_ingredients(raw: str) -> list[str]:
    """Bracket-aware comma splitting of raw ingredient strings.

    Handles nested parentheses and square brackets so that ingredients
    like "Chicken Meal (source of Glucosamine, Chondroitin)" stay together.
    """
    if not raw:
        return []
    ingredients: list[str] = []
    depth = 0
    current: list[str] = []
    for ch in raw:
        if ch in "([":
            depth += 1
            current.append(ch)
        elif ch in ")]":
            depth = max(0, depth - 1)
            current.append(ch)
        elif ch == "," and depth == 0:
            ing = "".join(current).strip()
            if ing:
                ingredients.append(ing)
            current = []
        else:
            current.append(ch)
    last = "".join(current).strip()
    if last:
        ingredients.append(last)

    cleaned: list[str] = []
    for ing in ingredients:
        ing = ing.strip().rstrip(".").strip()
        if not ing:
            continue
        cleaned.append(ing)
    return cleaned


# ---------------------------------------------------------------------------
# Families lookup
# ---------------------------------------------------------------------------

class FamiliesLookup:
    """Case-insensitive lookup for ingredient families, ambiguous entries,
    and the ignore list."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.families_raw = data.get("families", {})
        self.ambiguous_raw = data.get("ambiguous", {})
        self.ignore_raw: list[str] = data.get("ignore_for_correlation", [])
        self.cross_reactivity: dict[str, list[str]] = data.get("cross_reactivity_groups", {})

        # Build case-insensitive member -> (family_name, member_info) lookup
        self._member_lookup: dict[str, tuple[str, dict[str, Any], dict[str, Any]]] = {}
        for family_name, family_data in self.families_raw.items():
            for member_name, member_info in family_data.get("members", {}).items():
                self._member_lookup[member_name.lower()] = (
                    family_name,
                    family_data,
                    member_info,
                )

        # Case-insensitive ambiguous lookup
        self._ambiguous_lookup: dict[str, dict[str, Any]] = {
            k.lower(): v for k, v in self.ambiguous_raw.items()
        }

        # Case-insensitive ignore set
        self._ignore_set: set[str] = {s.lower() for s in self.ignore_raw}

    def is_ignored(self, ingredient_name: str) -> bool:
        return ingredient_name.lower() in self._ignore_set

    def lookup(self, ingredient_name: str) -> dict[str, Any] | None:
        """Look up an ingredient and return its resolved metadata.

        Returns a dict with: family, source_group, form, is_hydrolyzed, is_ambiguous
        or None if not found anywhere.
        """
        key = ingredient_name.lower()

        # Check families first (exact match on member name)
        if key in self._member_lookup:
            family_name, family_data, member_info = self._member_lookup[key]
            return {
                "family": family_name,
                "source_group": self._map_source_group(family_data.get("source_group", "other")),
                "form": self._map_form(member_info.get("form", "raw")),
                "is_hydrolyzed": member_info.get("is_hydrolyzed", False),
                "is_ambiguous": False,
            }

        # Check ambiguous
        if key in self._ambiguous_lookup:
            amb = self._ambiguous_lookup[key]
            return {
                "family": None,
                "source_group": self._map_source_group(amb.get("source_group", "other")),
                "form": "raw",
                "is_hydrolyzed": False,
                "is_ambiguous": True,
            }

        return None

    @staticmethod
    def _map_source_group(sg: str) -> str:
        if sg in VALID_SOURCE_GROUPS:
            return sg
        return SOURCE_GROUP_MAP.get(sg, "other")

    @staticmethod
    def _map_form(form: str) -> str:
        if form in VALID_FORM_TYPES:
            return form
        return FORM_TYPE_MAP.get(form, "raw")


# ---------------------------------------------------------------------------
# Database operations
# ---------------------------------------------------------------------------

def upsert_brand(
    cur: psycopg2.extensions.cursor,
    name: str,
    website_url: str | None,
    country: str = "CA",
) -> str:
    """Upsert a brand and return its id."""
    brand_id = str(uuid4())
    cur.execute(
        """
        INSERT INTO brands (id, name, website_url, country)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (name) DO UPDATE SET
            website_url = EXCLUDED.website_url,
            country = EXCLUDED.country
        RETURNING id
        """,
        (brand_id, name, website_url, country),
    )
    row = cur.fetchone()
    return row[0]


def upsert_product(
    cur: psycopg2.extensions.cursor,
    brand_id: str,
    product: dict[str, Any],
    scraped_from: str | None,
    scraped_at: str | None,
) -> str:
    """Upsert a product and return its id."""
    product_id = str(uuid4())
    product_type = PRODUCT_TYPE_MAP.get(product.get("product_type", ""), None)
    channel = CHANNEL_MAP.get(product.get("channel", ""), None)

    cur.execute(
        """
        INSERT INTO products (
            id, brand_id, name, type, channel, lifestage,
            health_tags, raw_ingredient_string, guaranteed_analysis,
            calorie_content, image_urls, manufacturer_url,
            variants_json, scraped_from, scraped_at,
            is_discontinued, updated_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            false, NOW()
        )
        ON CONFLICT ON CONSTRAINT uq_product_name_brand DO UPDATE SET
            type = EXCLUDED.type,
            channel = EXCLUDED.channel,
            lifestage = EXCLUDED.lifestage,
            health_tags = EXCLUDED.health_tags,
            raw_ingredient_string = EXCLUDED.raw_ingredient_string,
            guaranteed_analysis = EXCLUDED.guaranteed_analysis,
            calorie_content = EXCLUDED.calorie_content,
            image_urls = EXCLUDED.image_urls,
            manufacturer_url = EXCLUDED.manufacturer_url,
            variants_json = EXCLUDED.variants_json,
            scraped_from = EXCLUDED.scraped_from,
            scraped_at = EXCLUDED.scraped_at,
            is_discontinued = false,
            discontinued_at = NULL,
            updated_at = NOW()
        RETURNING id
        """,
        (
            product_id,
            brand_id,
            product["name"],
            product_type,
            channel,
            product.get("life_stage"),
            product.get("health_tags"),
            product.get("ingredients_raw"),
            json.dumps(product.get("guaranteed_analysis")) if product.get("guaranteed_analysis") else None,
            product.get("calorie_content"),
            product.get("images"),
            product.get("url"),
            json.dumps(product.get("variants")) if product.get("variants") else None,
            scraped_from,
            scraped_at,
        ),
    )
    row = cur.fetchone()
    return row[0]


def upsert_ingredient(
    cur: psycopg2.extensions.cursor,
    normalized_name: str,
    family: str | None,
    source_group: str | None,
    form_type: str | None,
    is_hydrolyzed: bool,
) -> str:
    """Upsert an ingredient and return its id."""
    ingredient_id = str(uuid4())
    cur.execute(
        """
        INSERT INTO ingredients (id, normalized_name, family, source_group, form_type, is_hydrolyzed)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (normalized_name) DO UPDATE SET
            family = COALESCE(EXCLUDED.family, ingredients.family),
            source_group = COALESCE(EXCLUDED.source_group, ingredients.source_group),
            form_type = COALESCE(EXCLUDED.form_type, ingredients.form_type),
            is_hydrolyzed = EXCLUDED.is_hydrolyzed
        RETURNING id
        """,
        (ingredient_id, normalized_name, family, source_group, form_type, is_hydrolyzed),
    )
    row = cur.fetchone()
    return row[0]


def clear_product_ingredients(
    cur: psycopg2.extensions.cursor,
    product_id: str,
) -> None:
    """Delete all product_ingredients for a given product (before re-inserting)."""
    cur.execute(
        "DELETE FROM product_ingredients WHERE product_id = %s",
        (product_id,),
    )


def insert_product_ingredient(
    cur: psycopg2.extensions.cursor,
    product_id: str,
    ingredient_id: str,
    position: int,
) -> None:
    """Insert a product_ingredient row."""
    cur.execute(
        """
        INSERT INTO product_ingredients (id, product_id, ingredient_id, position)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT ON CONSTRAINT uq_product_ingredient DO NOTHING
        """,
        (str(uuid4()), product_id, ingredient_id, position),
    )


def upsert_cross_reactivity(
    cur: psycopg2.extensions.cursor,
    group_name: str,
    families: list[str],
) -> None:
    """Upsert a cross-reactivity group."""
    cur.execute(
        """
        INSERT INTO ingredient_cross_reactivity (id, group_name, families)
        VALUES (%s, %s, %s)
        ON CONFLICT (group_name) DO UPDATE SET
            families = EXCLUDED.families
        """,
        (str(uuid4()), group_name, families),
    )


def mark_discontinued(
    cur: psycopg2.extensions.cursor,
    loaded_product_keys: set[tuple[str, str]],
) -> tuple[int, int]:
    """Mark products not in the loaded set as discontinued, then delete
    discontinued products that have no user references.

    Args:
        loaded_product_keys: set of (product_name, brand_name) tuples that
            were present in the JSON files.

    Returns:
        Tuple of (newly_discontinued_count, deleted_count).
    """
    # Get all active products with their brand names
    cur.execute(
        """
        SELECT p.id, p.name, b.name AS brand_name
        FROM products p
        JOIN brands b ON p.brand_id = b.id
        WHERE p.is_discontinued = false
        """
    )
    rows = cur.fetchall()

    discontinued_count = 0
    for row in rows:
        product_id, product_name, brand_name = row
        if (product_name, brand_name) not in loaded_product_keys:
            cur.execute(
                """
                UPDATE products
                SET is_discontinued = true, discontinued_at = NOW(), updated_at = NOW()
                WHERE id = %s
                """,
                (product_id,),
            )
            discontinued_count += 1

    # Delete discontinued products with no user references
    cur.execute(
        """
        DELETE FROM product_ingredients
        WHERE product_id IN (
            SELECT p.id FROM products p
            WHERE p.is_discontinued = true
            AND p.id NOT IN (SELECT product_id FROM feeding_periods)
            AND p.id NOT IN (SELECT product_id FROM treat_logs WHERE product_id IS NOT NULL)
        )
        """
    )
    cur.execute(
        """
        DELETE FROM products
        WHERE is_discontinued = true
        AND id NOT IN (SELECT product_id FROM feeding_periods)
        AND id NOT IN (SELECT product_id FROM treat_logs WHERE product_id IS NOT NULL)
        RETURNING id
        """
    )
    deleted_count = cur.rowcount

    return discontinued_count, deleted_count


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def load_brand_file(
    cur: psycopg2.extensions.cursor,
    filepath: Path,
    families: FamiliesLookup,
    stats: dict[str, int],
    unknown_ingredients: set[str],
    loaded_product_keys: set[tuple[str, str]],
) -> None:
    """Load a single brand JSON file into the database."""
    with open(filepath) as f:
        data = json.load(f)

    brand_name = data["brand"]
    website_url = data.get("website_url") or None
    scraped_at = data.get("scraped_at")

    brand_id = upsert_brand(cur, brand_name, website_url)
    stats["brands"] += 1

    for product in data.get("products", []):
        # Use the product-level brand if different from file-level (manual_products.json)
        product_brand = product.get("brand", brand_name)
        if product_brand != brand_name:
            product_brand_id = upsert_brand(cur, product_brand, None)
        else:
            product_brand_id = brand_id

        product_id = upsert_product(
            cur,
            product_brand_id,
            product,
            scraped_from=str(filepath.name),
            scraped_at=scraped_at,
        )
        stats["products"] += 1
        loaded_product_keys.add((product["name"], product_brand))

        # Parse and process ingredients
        raw_ingredients = product.get("ingredients_raw", "")
        if not raw_ingredients:
            continue

        parsed = parse_ingredients(raw_ingredients)

        # Clear existing product_ingredients for this product (handles re-ordering)
        clear_product_ingredients(cur, product_id)

        seen_ingredient_ids: set[str] = set()
        for position, ingredient_name in enumerate(parsed):
            # Skip ignored ingredients
            if families.is_ignored(ingredient_name):
                continue

            info = families.lookup(ingredient_name)
            if info is not None:
                ingredient_id = upsert_ingredient(
                    cur,
                    normalized_name=ingredient_name,
                    family=info["family"],
                    source_group=info["source_group"],
                    form_type=info["form"],
                    is_hydrolyzed=info["is_hydrolyzed"],
                )
            else:
                # Unknown ingredient — still insert with minimal info
                unknown_ingredients.add(ingredient_name)
                ingredient_id = upsert_ingredient(
                    cur,
                    normalized_name=ingredient_name,
                    family=None,
                    source_group=None,
                    form_type=None,
                    is_hydrolyzed=False,
                )

            # Avoid duplicate product_ingredient rows for the same ingredient
            # in the same product (take first position)
            if ingredient_id not in seen_ingredient_ids:
                insert_product_ingredient(cur, product_id, ingredient_id, position)
                seen_ingredient_ids.add(ingredient_id)

            if info is not None:
                stats["ingredients_known"] += 1
            else:
                stats["ingredients_unknown"] += 1


def main() -> None:
    # Load families
    if not FAMILIES_PATH.exists():
        print(f"ERROR: {FAMILIES_PATH} not found. Run build_families.py first.", file=sys.stderr)
        sys.exit(1)

    with open(FAMILIES_PATH) as f:
        families_data = json.load(f)
    families = FamiliesLookup(families_data)

    # Collect all brand JSON files
    brand_files = sorted(BRANDS_DIR.glob("*.json"))
    all_files: list[Path] = list(brand_files)
    if MANUAL_PRODUCTS_PATH.exists():
        all_files.append(MANUAL_PRODUCTS_PATH)

    if not all_files:
        print("No brand JSON files found.", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(all_files)} data files to load.")

    # Connect to database
    conn = psycopg2.connect(DATABASE_URL)
    stats: dict[str, int] = {
        "brands": 0,
        "products": 0,
        "ingredients_known": 0,
        "ingredients_unknown": 0,
        "discontinued": 0,
        "deleted": 0,
    }
    unknown_ingredients: set[str] = set()
    loaded_product_keys: set[tuple[str, str]] = set()

    try:
        # Process each brand file in its own transaction
        for filepath in all_files:
            print(f"  Loading {filepath.name}...")
            cur = conn.cursor()
            try:
                load_brand_file(
                    cur, filepath, families, stats,
                    unknown_ingredients, loaded_product_keys,
                )
                conn.commit()
            except Exception:
                conn.rollback()
                print(f"  ERROR loading {filepath.name}:", file=sys.stderr)
                raise
            finally:
                cur.close()

        # Cross-reactivity groups
        cur = conn.cursor()
        try:
            for group_name, family_list in families.cross_reactivity.items():
                upsert_cross_reactivity(cur, group_name, family_list)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()

        # Discontinued detection
        cur = conn.cursor()
        try:
            stats["discontinued"], stats["deleted"] = mark_discontinued(cur, loaded_product_keys)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()

    finally:
        conn.close()

    # Print unknown ingredients to stderr
    if unknown_ingredients:
        print(f"\n--- Unknown ingredients ({len(unknown_ingredients)}) ---", file=sys.stderr)
        for ing in sorted(unknown_ingredients):
            print(f"  {ing}", file=sys.stderr)

    # Summary
    print(f"\n=== Build Summary ===")
    print(f"  Brands loaded:        {stats['brands']}")
    print(f"  Products loaded:      {stats['products']}")
    print(f"  Ingredients (known):  {stats['ingredients_known']}")
    print(f"  Ingredients (unknown):{stats['ingredients_unknown']}")
    print(f"  Unknown unique:       {len(unknown_ingredients)}")
    print(f"  Discontinued:         {stats['discontinued']}")
    print(f"  Deleted (unreferenced): {stats['deleted']}")
    print(f"=== Done ===")


if __name__ == "__main__":
    main()
