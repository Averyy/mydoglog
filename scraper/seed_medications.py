#!/usr/bin/env python3
"""
Seed medication_products table from medications.json.

Idempotent: ON CONFLICT (name) DO UPDATE.
Can be run standalone or called from build.py.

Usage:
    cd scraper && uv run python seed_medications.py
"""

import json
import os
from pathlib import Path
from uuid import uuid4

import psycopg2

SCRIPT_DIR = Path(__file__).parent
MEDICATIONS_PATH = SCRIPT_DIR / "data" / "medications.json"

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://mydoglog:password@localhost:5433/mydoglog",
)


def seed_medications(conn) -> int:
    """Upsert medications from JSON into medication_products table. Returns count."""
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


def main():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        count = seed_medications(conn)
        print(f"Seeded {count} medication products.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
