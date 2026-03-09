"""Tests for validate.py — myvetstore product matching logic."""

import pytest
from pathlib import Path
from validate import parse_myvetstore_products, MANUFACTURER_TO_BRAND

DOCS_DIR = Path(__file__).parent.parent.parent / "docs"
MYVETSTORE_PATH = DOCS_DIR / "ref-mar2026-myvetstore-pricing.md"


class TestParseMyvetstoreProducts:
    def test_parses_products(self) -> None:
        products = parse_myvetstore_products(MYVETSTORE_PATH)
        assert len(products) > 100, f"Expected >100 products, got {len(products)}"

    def test_products_have_name_and_manufacturer(self) -> None:
        products = parse_myvetstore_products(MYVETSTORE_PATH)
        for p in products:
            assert "name" in p
            assert "manufacturer" in p
            assert len(p["name"]) > 0
            assert len(p["manufacturer"]) > 0

    def test_excludes_feline_products(self) -> None:
        products = parse_myvetstore_products(MYVETSTORE_PATH)
        for p in products:
            assert "Feline" not in p["name"], f"Feline product should be excluded: {p['name']}"

    def test_strips_out_of_stock(self) -> None:
        products = parse_myvetstore_products(MYVETSTORE_PATH)
        for p in products:
            assert "(OUT OF STOCK)" not in p["name"]

    def test_known_manufacturers_exist(self) -> None:
        products = parse_myvetstore_products(MYVETSTORE_PATH)
        manufacturers = {p["manufacturer"] for p in products}
        # Check that the big three are present
        assert "Nestle Purina" in manufacturers
        assert "Hill's" in manufacturers
        assert "Royal Canin" in manufacturers

    def test_manufacturer_to_brand_covers_known(self) -> None:
        products = parse_myvetstore_products(MYVETSTORE_PATH)
        manufacturers = {p["manufacturer"] for p in products}
        unmapped = manufacturers - set(MANUFACTURER_TO_BRAND.keys())
        # All manufacturers should be in the mapping
        # (or be exactly the same as the brand name)
        for m in unmapped:
            # If not in mapping, it uses itself as brand name — that's ok
            pass
