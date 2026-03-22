#!/usr/bin/env python3
"""
Seed medication_products table from medications.json.

Idempotent: ON CONFLICT (name) DO UPDATE.
Can be run standalone or called from build.py.

Usage:
    cd scraper && uv run python seed_medications.py
"""

import os

import psycopg2

from seed_db import seed_medications

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://mydoglog:password@localhost:5433/mydoglog",
)


def main():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        count = seed_medications(conn)
        print(f"Seeded {count} medication products.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
