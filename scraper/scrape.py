#!/usr/bin/env python3
"""Scrape dog food product data from manufacturer websites."""

import argparse
import logging
import sys
from pathlib import Path

from scrapers import SCRAPERS

logger = logging.getLogger(__name__)


def main() -> None:
    choices = list(SCRAPERS.keys()) + ["all"]
    parser = argparse.ArgumentParser(
        description="Scrape dog food product data from manufacturer websites"
    )
    parser.add_argument(
        "source",
        choices=choices,
        help="Brand to scrape, or 'all' for everything",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/brands"),
        help="Output directory for JSON files (default: data/brands)",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s [%(name)s] %(message)s",
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)

    sources = list(SCRAPERS.keys()) if args.source == "all" else [args.source]
    results: dict[str, int | str] = {}

    for key in sources:
        name, fn = SCRAPERS[key]
        try:
            logger.info(f"Scraping {name}...")
            count = fn(args.output_dir)
            results[name] = count
            logger.info(f"  {name}: {count} products")
        except Exception:
            logger.exception(f"FAILED: {name}")
            results[name] = "FAILED"

    # Summary
    print("\n--- Summary ---")
    for name, result in results.items():
        status = f"{result} products" if isinstance(result, int) else result
        print(f"  {name}: {status}")

    if any(r == "FAILED" for r in results.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
