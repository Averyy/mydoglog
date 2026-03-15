#!/usr/bin/env python3
"""
Seed all product and medication data into PostgreSQL from committed JSON files.

This is the DB-only seeding logic extracted from build.py. It handles:
- Brands, products, ingredients, product_ingredients
- Ingredient cross-reactivity groups
- Discontinued product detection + orphan cleanup
- Medication products

No image processing — images are committed to public/ and baked into the
Docker image separately.

Idempotent: all upserts use ON CONFLICT. Safe to re-run on every deploy.

Usage:
    cd scraper && uv run python seed_db.py          # local dev
    python3 /app/scraper/seed_db.py                 # Docker startup
"""

import json
import os
import re
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
DATA_DIR = SCRIPT_DIR / "data"
BRANDS_DIR = DATA_DIR / "brands"
MANUAL_PRODUCTS_PATH = DATA_DIR / "manual_products.json"
FAMILIES_PATH = DATA_DIR / "ingredient_families.json"
MEDICATIONS_PATH = DATA_DIR / "medications.json"

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://mydoglog:password@localhost:5433/mydoglog",
)

# ---------------------------------------------------------------------------
# Enum mappings — map JSON values to DB enum values
# ---------------------------------------------------------------------------

PRODUCT_TYPE_MAP: dict[str, str] = {
    "food": "food",
    "treat": "treat",
    "supplement": "supplement",
}

CHANNEL_MAP: dict[str, str] = {
    "retail": "retail",
    "vet": "vet",
    "seed": "seed",
}

VALID_SOURCE_GROUPS = {
    "poultry", "red_meat", "fish", "crustacean", "mollusk",
    "grain", "legume", "root", "fruit", "dairy", "egg",
    "other", "additive", "fiber", "vegetable", "seed",
}

SOURCE_GROUP_MAP: dict[str, str] = {
    "insect": "other",
    "mammal": "red_meat",
    "animal": "other",
    "unknown": "other",
}

VALID_FORM_TYPES = {
    "raw", "meal", "by_product", "fat", "oil", "hydrolyzed", "flour", "bran",
    "protein_isolate", "starch", "fiber", "gluten",
}

FORM_TYPE_MAP: dict[str, str] = {
    "whole": "raw",
    "organ": "raw",
    "dried": "raw",
    "concentrate": "protein_isolate",
    "broth": "raw",
    "derivative": "raw",
    "ground": "raw",
    "extract": "raw",
}


# ---------------------------------------------------------------------------
# Ingredient display normalization
# ---------------------------------------------------------------------------

_UPPERCASE_PREFIXES = re.compile(r"^(DL-|L-|D-)", re.IGNORECASE)
_LOWERCASE_WORDS = {"and", "or", "of", "for", "with", "in", "the"}


def _title_case_word(word: str) -> str:
    """Title-case a single word, preserving chemical prefixes and vitamin refs."""
    if word.startswith("(") or word.startswith("["):
        return word
    m = _UPPERCASE_PREFIXES.match(word)
    if m:
        prefix = m.group(1).upper()
        rest = word[m.end():]
        return prefix + rest[:1].upper() + rest[1:].lower() if rest else prefix
    if re.match(r"^[A-Z]-\d", word):
        return word
    return word[:1].upper() + word[1:].lower()


def title_case_ingredients(raw: str) -> str:
    """Title-case a raw ingredient string while preserving bracket structure."""
    if not raw:
        return raw

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
            ingredients.append("".join(current))
            current = []
        else:
            current.append(ch)
    ingredients.append("".join(current))

    result: list[str] = []
    for ing in ingredients:
        stripped = ing.strip()
        if not stripped:
            continue

        bracket_m = re.match(
            r"^(MINERALS|VITAMINS|Minerals|Vitamins)\s*\[([^\]]*)\](.*)$",
            stripped,
            re.IGNORECASE,
        )
        if bracket_m:
            label = bracket_m.group(1).capitalize()
            contents = bracket_m.group(2)
            rest = bracket_m.group(3)
            tc_contents = " ".join(
                _title_case_word(w) if w.lower() not in _LOWERCASE_WORDS else w.lower()
                for w in contents.split()
            )
            result.append(f"{label} ({tc_contents}){rest}")
            continue

        words = stripped.split()
        tc_words = []
        for i, w in enumerate(words):
            if i == 0:
                tc_words.append(_title_case_word(w))
            elif w.lower() in _LOWERCASE_WORDS:
                tc_words.append(w.lower())
            else:
                tc_words.append(_title_case_word(w))
        result.append(" ".join(tc_words))

    return ", ".join(result)


# ---------------------------------------------------------------------------
# Ingredient parsing (bracket-aware comma splitting)
# ---------------------------------------------------------------------------

def parse_ingredients(raw: str) -> list[str]:
    """Bracket-aware comma splitting of raw ingredient strings."""
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
    and the ignore list (explicit + pattern-based)."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.families_raw = data.get("families", {})
        self.ambiguous_raw = data.get("ambiguous", {})
        self.ignore_raw: list[str] = data.get("ignore_for_correlation", [])
        self.cross_reactivity: dict[str, list[str]] = data.get("cross_reactivity_groups", {})

        self._member_lookup: dict[str, tuple[str, dict[str, Any], dict[str, Any]]] = {}
        for family_name, family_data in self.families_raw.items():
            members = family_data.get("members", {})
            if isinstance(members, list):
                for member_name in members:
                    self._member_lookup[member_name.lower()] = (
                        family_name, family_data, {},
                    )
            else:
                for member_name, member_info in members.items():
                    self._member_lookup[member_name.lower()] = (
                        family_name, family_data, member_info,
                    )

        self._ambiguous_lookup: dict[str, dict[str, Any]] = {
            k.lower(): v for k, v in self.ambiguous_raw.items()
        }

        self._ignore_set: set[str] = {s.lower() for s in self.ignore_raw}

        self._ignore_patterns: list[re.Pattern[str]] = [
            re.compile(p, re.IGNORECASE) for p in data.get("ignore_patterns", [])
        ]

    def is_ignored(self, ingredient_name: str) -> bool:
        key = ingredient_name.lower()
        if len(key) <= 1:
            return True
        if key in self._member_lookup or key in self._ambiguous_lookup:
            return False
        if key in self._ignore_set:
            return True
        for pattern in self._ignore_patterns:
            if pattern.search(ingredient_name):
                return True
        return False

    def lookup(self, ingredient_name: str) -> dict[str, Any] | None:
        key = ingredient_name.lower()
        if key in self._member_lookup:
            family_name, family_data, member_info = self._member_lookup[key]
            return {
                "family": family_name,
                "source_group": self._map_source_group(family_data.get("source_group", "other")),
                "form": self._map_form(member_info.get("form", "raw")),
                "is_hydrolyzed": member_info.get("is_hydrolyzed", False),
                "is_ambiguous": False,
                "category": family_data.get("category"),
            }
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

def upsert_brand(cur, name: str, website_url: str | None, country: str = "CA") -> str:
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
    return cur.fetchone()[0]


def upsert_product(cur, brand_id: str, product: dict[str, Any], scraped_from: str | None, scraped_at: str | None) -> str:
    product_id = str(uuid4())
    raw_type = product.get("product_type", "")
    product_type = PRODUCT_TYPE_MAP.get(raw_type, None)
    channel = CHANNEL_MAP.get(product.get("channel", ""), None)

    product_format = product.get("product_format")
    if not product_format:
        print(f"  WARNING: Missing product_format for {product.get('name', '?')}, defaulting to 'dry'", file=sys.stderr)
        product_format = "dry"

    cur.execute(
        """
        INSERT INTO products (
            id, brand_id, name, type, format, channel, lifestage,
            health_tags, raw_ingredient_string, guaranteed_analysis,
            calorie_content, image_urls, manufacturer_url,
            variants_json, scraped_from, scraped_at,
            is_discontinued, updated_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            false, NOW()
        )
        ON CONFLICT ON CONSTRAINT uq_product_name_brand DO UPDATE SET
            type = EXCLUDED.type,
            format = EXCLUDED.format,
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
            product_id, brand_id, product["name"], product_type,
            product_format, channel, product.get("life_stage"),
            product.get("health_tags"),
            title_case_ingredients(product.get("ingredients_raw", "") or "") or None,
            json.dumps(product.get("guaranteed_analysis")) if product.get("guaranteed_analysis") else None,
            product.get("calorie_content"),
            product.get("images"),
            product.get("url"),
            json.dumps(product.get("variants")) if product.get("variants") else None,
            scraped_from, scraped_at,
        ),
    )
    return cur.fetchone()[0]


def upsert_ingredient(cur, normalized_name: str, family: str | None, source_group: str | None, form_type: str | None, is_hydrolyzed: bool, category: str | None = None) -> str:
    ingredient_id = str(uuid4())
    cur.execute(
        """
        INSERT INTO ingredients (id, normalized_name, family, source_group, form_type, is_hydrolyzed, category)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (normalized_name) DO UPDATE SET
            family = COALESCE(EXCLUDED.family, ingredients.family),
            source_group = COALESCE(EXCLUDED.source_group, ingredients.source_group),
            form_type = COALESCE(EXCLUDED.form_type, ingredients.form_type),
            is_hydrolyzed = EXCLUDED.is_hydrolyzed,
            category = COALESCE(EXCLUDED.category, ingredients.category)
        RETURNING id
        """,
        (ingredient_id, normalized_name, family, source_group, form_type, is_hydrolyzed, category),
    )
    return cur.fetchone()[0]


def clear_product_ingredients(cur, product_id: str) -> None:
    cur.execute("DELETE FROM product_ingredients WHERE product_id = %s", (product_id,))


def insert_product_ingredient(cur, product_id: str, ingredient_id: str, position: int) -> None:
    cur.execute(
        """
        INSERT INTO product_ingredients (id, product_id, ingredient_id, position)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT ON CONSTRAINT uq_product_ingredient DO NOTHING
        """,
        (str(uuid4()), product_id, ingredient_id, position),
    )


def upsert_cross_reactivity(cur, group_name: str, families: list[str]) -> None:
    cur.execute(
        """
        INSERT INTO ingredient_cross_reactivity (id, group_name, families)
        VALUES (%s, %s, %s)
        ON CONFLICT (group_name) DO UPDATE SET
            families = EXCLUDED.families
        """,
        (str(uuid4()), group_name, families),
    )


def mark_discontinued(cur, loaded_product_keys: set[tuple[str, str]]) -> tuple[int, int]:
    """Mark products not in the loaded set as discontinued, then delete
    discontinued products that have no user references."""
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


def seed_medications(conn) -> int:
    """Upsert medications from JSON into medication_products table."""
    with open(MEDICATIONS_PATH) as f:
        medications = json.load(f)

    cur = conn.cursor()
    count = 0
    try:
        for med in medications:
            cur.execute(
                """
                INSERT INTO medication_products (
                    id, name, generic_name, manufacturer, category,
                    drug_class, dosage_form, default_intervals,
                    description, common_side_effects, side_effects_sources,
                    suppresses_itch, has_gi_side_effects
                ) VALUES (
                    %s, %s, %s, %s, %s::medication_category,
                    %s, %s::dosage_form, %s::dosing_interval[],
                    %s, %s, %s,
                    %s, %s
                )
                ON CONFLICT (name) DO UPDATE SET
                    generic_name = EXCLUDED.generic_name,
                    manufacturer = EXCLUDED.manufacturer,
                    category = EXCLUDED.category,
                    drug_class = EXCLUDED.drug_class,
                    dosage_form = EXCLUDED.dosage_form,
                    default_intervals = EXCLUDED.default_intervals,
                    description = EXCLUDED.description,
                    common_side_effects = EXCLUDED.common_side_effects,
                    side_effects_sources = EXCLUDED.side_effects_sources,
                    suppresses_itch = EXCLUDED.suppresses_itch,
                    has_gi_side_effects = EXCLUDED.has_gi_side_effects
                """,
                (
                    str(uuid4()),
                    med["name"],
                    med["generic_name"],
                    med.get("manufacturer"),
                    med["category"],
                    med.get("drug_class"),
                    med["dosage_form"],
                    med["default_intervals"],
                    med.get("description"),
                    med.get("common_side_effects"),
                    med.get("side_effects_sources"),
                    med.get("suppresses_itch", False),
                    med.get("has_gi_side_effects", False),
                ),
            )
            count += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()

    return count


# ---------------------------------------------------------------------------
# Brand file loading
# ---------------------------------------------------------------------------

def load_brand_file(
    cur,
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
        product_brand = product.get("brand", brand_name)
        if product_brand != brand_name:
            product_brand_id = upsert_brand(cur, product_brand, None)
        else:
            product_brand_id = brand_id

        product_id = upsert_product(
            cur, product_brand_id, product,
            scraped_from=str(filepath.name),
            scraped_at=scraped_at,
        )
        stats["products"] += 1
        loaded_product_keys.add((product["name"], product_brand))

        raw_ingredients = product.get("ingredients_raw", "")
        if not raw_ingredients:
            continue

        parsed = parse_ingredients(raw_ingredients)
        clear_product_ingredients(cur, product_id)

        seen_ingredient_ids: set[str] = set()
        for position, ingredient_name in enumerate(parsed, start=1):
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
                    category=info.get("category"),
                )
            else:
                unknown_ingredients.add(ingredient_name)
                ingredient_id = upsert_ingredient(
                    cur,
                    normalized_name=ingredient_name,
                    family=None, source_group=None,
                    form_type=None, is_hydrolyzed=False,
                )

            if ingredient_id not in seen_ingredient_ids:
                insert_product_ingredient(cur, product_id, ingredient_id, position)
                seen_ingredient_ids.add(ingredient_id)

            if info is not None:
                stats["ingredients_known"] += 1
            else:
                stats["ingredients_unknown"] += 1


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if not FAMILIES_PATH.exists():
        print(f"ERROR: {FAMILIES_PATH} not found.", file=sys.stderr)
        sys.exit(1)

    with open(FAMILIES_PATH) as f:
        families_data = json.load(f)
    families = FamiliesLookup(families_data)

    brand_files = sorted(BRANDS_DIR.glob("*.json"))
    all_files: list[Path] = list(brand_files)
    if MANUAL_PRODUCTS_PATH.exists():
        all_files.append(MANUAL_PRODUCTS_PATH)

    if not all_files:
        print("No brand JSON files found.", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(all_files)} data files to load.")

    conn = psycopg2.connect(DATABASE_URL)
    stats: dict[str, int] = {
        "brands": 0,
        "products": 0,
        "ingredients_known": 0,
        "ingredients_unknown": 0,
        "discontinued": 0,
        "deleted": 0,
        "orphaned_ingredients": 0,
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
            valid_group_names = list(families.cross_reactivity.keys())
            cur.execute(
                "DELETE FROM ingredient_cross_reactivity WHERE group_name != ALL(%s)",
                (valid_group_names,),
            )
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

        # Clean orphaned ingredients
        cur = conn.cursor()
        try:
            cur.execute(
                """
                DELETE FROM ingredients
                WHERE id NOT IN (SELECT DISTINCT ingredient_id FROM product_ingredients)
                RETURNING id
                """
            )
            stats["orphaned_ingredients"] = cur.rowcount
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()

        # Seed medications
        print("\nSeeding medication products...")
        med_count = seed_medications(conn)
        stats["medication_products"] = med_count

    finally:
        conn.close()

    if unknown_ingredients:
        print(f"\n--- Unknown ingredients ({len(unknown_ingredients)}) ---", file=sys.stderr)
        for ing in sorted(unknown_ingredients):
            print(f"  {ing}", file=sys.stderr)

    print(f"\n=== Seed Summary ===")
    print(f"  Brands:               {stats['brands']}")
    print(f"  Products:             {stats['products']}")
    print(f"  Ingredients (known):  {stats['ingredients_known']}")
    print(f"  Ingredients (unknown):{stats['ingredients_unknown']}")
    print(f"  Unknown unique:       {len(unknown_ingredients)}")
    print(f"  Discontinued:         {stats['discontinued']}")
    print(f"  Deleted (unreferenced): {stats['deleted']}")
    print(f"  Orphaned ingredients:   {stats['orphaned_ingredients']}")
    print(f"  Medication products:  {stats.get('medication_products', 0)}")
    print(f"=== Done ===")


if __name__ == "__main__":
    main()
