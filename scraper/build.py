#!/usr/bin/env python3
"""
Full build: seed DB from JSON + process product images.

This is the local dev entrypoint that does everything:
1. Seeds all product/ingredient/medication data via seed_db.py
2. Processes source images → WebP (small + large)

For deploy (Docker), only seed_db.py runs (images are pre-committed).

Usage:
    cd scraper && uv run python build.py
"""

from scrapers.common import IMAGES_DATA_DIR, _process_brand_images
from seed_db import main as seed_main


def main() -> None:
    # Step 1: Seed DB (products, ingredients, cross-reactivity, medications)
    seed_main()

    # Step 2: Process images (source → small/large WebP)
    print("\nProcessing product images...")
    if IMAGES_DATA_DIR.is_dir():
        for brand_dir in sorted(IMAGES_DATA_DIR.iterdir()):
            if brand_dir.is_dir():
                _process_brand_images(brand_dir.name, remove_bg=True)

    print("\nBuild complete (DB seeded + images processed).")


if __name__ == "__main__":
    main()
