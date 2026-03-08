"""Tests for build.py — ingredient parsing, type mapping, families lookup, and idempotency."""

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, call, patch

import pytest

from build import (
    CHANNEL_MAP,
    PRODUCT_TYPE_MAP,
    FamiliesLookup,
    parse_ingredients,
    upsert_brand,
    upsert_ingredient,
    upsert_product,
    clear_product_ingredients,
    insert_product_ingredient,
    load_brand_file,
)


# ---------------------------------------------------------------------------
# Ingredient parsing
# ---------------------------------------------------------------------------


class TestParseIngredients:
    def test_simple_list(self) -> None:
        raw = "Chicken, Rice, Peas"
        assert parse_ingredients(raw) == ["Chicken", "Rice", "Peas"]

    def test_empty_string(self) -> None:
        assert parse_ingredients("") == []

    def test_single_ingredient(self) -> None:
        assert parse_ingredients("Chicken") == ["Chicken"]

    def test_parenthetical_content_kept_together(self) -> None:
        raw = "Chicken Meal (source of Glucosamine, Chondroitin), Rice, Peas"
        result = parse_ingredients(raw)
        assert result == [
            "Chicken Meal (source of Glucosamine, Chondroitin)",
            "Rice",
            "Peas",
        ]

    def test_nested_brackets(self) -> None:
        raw = "Vitamins (Vitamin A [Retinyl Acetate], Vitamin D), Minerals (Zinc [Zinc Oxide])"
        result = parse_ingredients(raw)
        assert result == [
            "Vitamins (Vitamin A [Retinyl Acetate], Vitamin D)",
            "Minerals (Zinc [Zinc Oxide])",
        ]

    def test_deeply_nested(self) -> None:
        raw = "A (B (C, D), E), F"
        result = parse_ingredients(raw)
        assert result == ["A (B (C, D), E)", "F"]

    def test_square_brackets(self) -> None:
        raw = "Chicken, Vitamins [A, B12, D3], Rice"
        result = parse_ingredients(raw)
        assert result == ["Chicken", "Vitamins [A, B12, D3]", "Rice"]

    def test_mixed_brackets(self) -> None:
        raw = "Minerals (Iron [Ferrous Sulfate], Zinc [Zinc Oxide]), Chicken"
        result = parse_ingredients(raw)
        assert result == [
            "Minerals (Iron [Ferrous Sulfate], Zinc [Zinc Oxide])",
            "Chicken",
        ]

    def test_trailing_period_stripped(self) -> None:
        raw = "Chicken, Rice, Mixed Tocopherols for freshness."
        result = parse_ingredients(raw)
        assert result[-1] == "Mixed Tocopherols for freshness"

    def test_extra_whitespace(self) -> None:
        raw = "  Chicken ,  Rice  ,  Peas  "
        assert parse_ingredients(raw) == ["Chicken", "Rice", "Peas"]

    def test_empty_segments_skipped(self) -> None:
        raw = "Chicken,, Rice, , Peas"
        assert parse_ingredients(raw) == ["Chicken", "Rice", "Peas"]

    def test_unbalanced_bracket_handled(self) -> None:
        """Unbalanced closing bracket shouldn't crash — depth floors at 0."""
        raw = "Chicken), Rice, Peas"
        result = parse_ingredients(raw)
        assert result == ["Chicken)", "Rice", "Peas"]

    def test_real_world_hills_ingredients(self) -> None:
        raw = (
            "Peas, Beef, Potatoes, Glycerin, Carrots, Sweet Potatoes, "
            "Cane Molasses, Chicken Fat, Pork Gelatin, Natural Flavors, "
            "Caramel color, Mixed Tocopherols for freshness."
        )
        result = parse_ingredients(raw)
        assert len(result) == 12
        assert result[0] == "Peas"
        assert result[-1] == "Mixed Tocopherols for freshness"


# ---------------------------------------------------------------------------
# Product type mapping
# ---------------------------------------------------------------------------


class TestProductTypeMapping:
    def test_food_passthrough(self) -> None:
        assert PRODUCT_TYPE_MAP["food"] == "food"

    def test_treat_passthrough(self) -> None:
        assert PRODUCT_TYPE_MAP["treat"] == "treat"

    def test_supplement_passthrough(self) -> None:
        assert PRODUCT_TYPE_MAP["supplement"] == "supplement"

    def test_unknown_type_returns_none(self) -> None:
        assert PRODUCT_TYPE_MAP.get("mystery") is None

    def test_all_db_types_covered(self) -> None:
        """Every valid DB enum value should appear in the map's values."""
        db_types = {"food", "treat", "supplement"}
        mapped_values = set(PRODUCT_TYPE_MAP.values())
        assert mapped_values == db_types


class TestChannelMapping:
    def test_valid_channels(self) -> None:
        assert CHANNEL_MAP["retail"] == "retail"
        assert CHANNEL_MAP["vet"] == "vet"
        assert CHANNEL_MAP["seed"] == "seed"

    def test_unknown_channel(self) -> None:
        assert CHANNEL_MAP.get("wholesale") is None


# ---------------------------------------------------------------------------
# FamiliesLookup
# ---------------------------------------------------------------------------


def _sample_families_data() -> dict[str, Any]:
    """Minimal families data for testing."""
    return {
        "families": {
            "chicken": {
                "source_group": "poultry",
                "members": {
                    "Chicken": {"form": "raw"},
                    "Chicken Meal": {"form": "meal"},
                    "Hydrolyzed Chicken Liver": {
                        "form": "hydrolyzed",
                        "is_hydrolyzed": True,
                    },
                    "Chicken Fat": {"form": "fat"},
                },
            },
            "beef": {
                "source_group": "red_meat",
                "members": {
                    "Beef": {"form": "raw"},
                    "Beef Meal": {"form": "meal"},
                    "beef bone broth": {"form": "broth"},
                },
            },
            "apple": {
                "source_group": "fruit",
                "members": {
                    "apple": {"form": "whole"},
                    "Dried Apple": {"form": "dried"},
                },
            },
            "kangaroo": {
                "source_group": "exotic",
                "members": {
                    "Kangaroo": {"form": "raw"},
                },
            },
            "flaxseed": {
                "source_group": "seed",
                "members": {
                    "Flaxseed": {"form": "whole"},
                },
            },
        },
        "ambiguous": {
            "Animal Fat": {
                "could_be": ["beef", "pork", "chicken"],
                "source_group": "animal",
            },
            "Fish Oil": {
                "could_be": ["salmon", "herring"],
                "source_group": "fish",
            },
        },
        "ignore_for_correlation": [
            "Vitamin A Supplement",
            "Mixed Tocopherols for freshness",
        ],
        "cross_reactivity_groups": {
            "poultry": ["chicken", "duck", "turkey"],
            "ruminant": ["beef", "bison", "lamb"],
        },
    }


class TestFamiliesLookup:
    def setup_method(self) -> None:
        self.lookup = FamiliesLookup(_sample_families_data())

    def test_known_ingredient_exact(self) -> None:
        info = self.lookup.lookup("Chicken")
        assert info is not None
        assert info["family"] == "chicken"
        assert info["source_group"] == "poultry"
        assert info["form"] == "raw"
        assert info["is_hydrolyzed"] is False
        assert info["is_ambiguous"] is False

    def test_case_insensitive(self) -> None:
        info = self.lookup.lookup("chicken")
        assert info is not None
        assert info["family"] == "chicken"

        info2 = self.lookup.lookup("CHICKEN MEAL")
        assert info2 is not None
        assert info2["family"] == "chicken"
        assert info2["form"] == "meal"

    def test_hydrolyzed(self) -> None:
        info = self.lookup.lookup("Hydrolyzed Chicken Liver")
        assert info is not None
        assert info["is_hydrolyzed"] is True
        assert info["form"] == "hydrolyzed"

    def test_ambiguous_ingredient(self) -> None:
        info = self.lookup.lookup("Animal Fat")
        assert info is not None
        assert info["family"] is None
        assert info["source_group"] == "other"  # "animal" maps to "other"
        assert info["is_ambiguous"] is True

    def test_ambiguous_case_insensitive(self) -> None:
        info = self.lookup.lookup("fish oil")
        assert info is not None
        assert info["is_ambiguous"] is True
        assert info["source_group"] == "fish"

    def test_unknown_ingredient(self) -> None:
        info = self.lookup.lookup("Fairy Dust Extract")
        assert info is None

    def test_ignored(self) -> None:
        assert self.lookup.is_ignored("Vitamin A Supplement") is True
        assert self.lookup.is_ignored("vitamin a supplement") is True
        assert self.lookup.is_ignored("Chicken") is False

    def test_source_group_mapping_exotic(self) -> None:
        info = self.lookup.lookup("Kangaroo")
        assert info is not None
        assert info["source_group"] == "other"  # exotic -> other

    def test_source_group_mapping_seed(self) -> None:
        info = self.lookup.lookup("Flaxseed")
        assert info is not None
        assert info["source_group"] == "other"  # seed -> other

    def test_form_mapping_whole(self) -> None:
        info = self.lookup.lookup("apple")
        assert info is not None
        assert info["form"] == "raw"  # whole -> raw

    def test_form_mapping_dried(self) -> None:
        info = self.lookup.lookup("Dried Apple")
        assert info is not None
        assert info["form"] == "raw"  # dried -> raw

    def test_form_mapping_broth(self) -> None:
        info = self.lookup.lookup("beef bone broth")
        assert info is not None
        assert info["form"] == "raw"  # broth -> raw

    def test_form_fat_passthrough(self) -> None:
        info = self.lookup.lookup("Chicken Fat")
        assert info is not None
        assert info["form"] == "fat"  # fat is valid, no mapping


# ---------------------------------------------------------------------------
# Unknown ingredient flagging
# ---------------------------------------------------------------------------


class TestUnknownIngredientFlagging:
    """Tests that unknown ingredients are tracked properly during load."""

    def test_unknown_ingredients_collected(self) -> None:
        families = FamiliesLookup(_sample_families_data())
        unknown: set[str] = set()

        test_ingredients = ["Chicken", "Fairy Dust", "Magic Powder", "Beef"]
        for ing in test_ingredients:
            if families.is_ignored(ing):
                continue
            info = families.lookup(ing)
            if info is None:
                unknown.add(ing)

        assert unknown == {"Fairy Dust", "Magic Powder"}

    def test_ignored_not_flagged_as_unknown(self) -> None:
        families = FamiliesLookup(_sample_families_data())
        unknown: set[str] = set()

        test_ingredients = ["Vitamin A Supplement", "Mixed Tocopherols for freshness"]
        for ing in test_ingredients:
            if families.is_ignored(ing):
                continue
            info = families.lookup(ing)
            if info is None:
                unknown.add(ing)

        assert unknown == set()


# ---------------------------------------------------------------------------
# DB upsert idempotency (mocked cursor)
# ---------------------------------------------------------------------------


class MockCursor:
    """Minimal mock of a psycopg2 cursor for upsert tests."""

    def __init__(self) -> None:
        self.queries: list[str] = []
        self.params: list[tuple[Any, ...]] = []
        self._return_values: list[Any] = []
        self._return_idx = 0

    def set_return_values(self, values: list[Any]) -> None:
        self._return_values = values
        self._return_idx = 0

    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> None:
        self.queries.append(query)
        self.params.append(params)

    def fetchone(self) -> tuple[Any, ...] | None:
        if self._return_idx < len(self._return_values):
            val = self._return_values[self._return_idx]
            self._return_idx += 1
            return val
        return None

    def fetchall(self) -> list[tuple[Any, ...]]:
        return []


class TestUpsertIdempotency:
    def test_brand_upsert_uses_on_conflict(self) -> None:
        cur = MockCursor()
        cur.set_return_values([("brand-id-1",), ("brand-id-1",)])

        # First insert
        id1 = upsert_brand(cur, "Hill's", "https://hillspet.ca")
        # Second insert (simulates re-run)
        id2 = upsert_brand(cur, "Hill's", "https://hillspet.ca/updated")

        assert id1 == "brand-id-1"
        assert id2 == "brand-id-1"
        # Both queries should contain ON CONFLICT
        for q in cur.queries:
            assert "ON CONFLICT" in q

    def test_ingredient_upsert_uses_coalesce(self) -> None:
        """COALESCE in the upsert ensures existing non-null values are preserved."""
        cur = MockCursor()
        cur.set_return_values([("ing-id-1",)])

        upsert_ingredient(cur, "Chicken", "chicken", "poultry", "raw", False)

        assert len(cur.queries) == 1
        assert "ON CONFLICT" in cur.queries[0]
        assert "COALESCE" in cur.queries[0]

    def test_product_upsert_clears_discontinued(self) -> None:
        """Re-upserting a product should reset is_discontinued to false."""
        cur = MockCursor()
        cur.set_return_values([("product-id-1",)])

        product = {
            "name": "Test Food",
            "product_type": "food",
            "product_format": "dry",
            "channel": "retail",
        }
        upsert_product(cur, "brand-id-1", product, "test.json", "2026-03-02T00:00:00Z")

        # Verify the query sets is_discontinued = false on update
        query = cur.queries[0]
        assert "is_discontinued = false" in query
        assert "discontinued_at = NULL" in query

    def test_product_ingredients_cleared_before_reinsertion(self) -> None:
        cur = MockCursor()
        clear_product_ingredients(cur, "product-id-1")

        assert len(cur.queries) == 1
        assert "DELETE FROM product_ingredients" in cur.queries[0]
        assert cur.params[0] == ("product-id-1",)


# ---------------------------------------------------------------------------
# Integration-like test for load_brand_file
# ---------------------------------------------------------------------------


class TestLoadBrandFile:
    def test_load_with_mocked_cursor(self, tmp_path: Path) -> None:
        """Test load_brand_file with a mock cursor to verify the full flow."""
        brand_json = {
            "brand": "TestBrand",
            "website_url": "https://testbrand.ca",
            "scraped_at": "2026-03-02T00:00:00Z",
            "products": [
                {
                    "name": "Test Kibble",
                    "brand": "TestBrand",
                    "product_type": "food",
                    "product_format": "dry",
                    "channel": "retail",
                    "ingredients_raw": "Chicken, Rice, Peas",
                    "life_stage": "adult",
                }
            ],
        }
        filepath = tmp_path / "testbrand.json"
        filepath.write_text(json.dumps(brand_json))

        families = FamiliesLookup(_sample_families_data())

        # Mock cursor that returns IDs for each upsert
        cur = MockCursor()
        # brand upsert, product upsert, 3 ingredient upserts
        cur.set_return_values([
            ("brand-1",),    # brand
            ("product-1",),  # product
            ("ing-1",),      # Chicken
            ("ing-2",),      # Rice (unknown)
            ("ing-3",),      # Peas (unknown)
        ])

        stats: dict[str, int] = {
            "brands": 0,
            "products": 0,
            "ingredients_known": 0,
            "ingredients_unknown": 0,
        }
        unknown: set[str] = set()
        loaded_keys: set[tuple[str, str]] = set()

        load_brand_file(cur, filepath, families, stats, unknown, loaded_keys)

        assert stats["brands"] == 1
        assert stats["products"] == 1
        assert stats["ingredients_known"] == 1  # Chicken
        assert stats["ingredients_unknown"] == 2  # Rice, Peas
        assert unknown == {"Rice", "Peas"}
        assert ("Test Kibble", "TestBrand") in loaded_keys

    def test_ignored_ingredients_skipped(self, tmp_path: Path) -> None:
        """Ignored ingredients shouldn't create DB records."""
        brand_json = {
            "brand": "TestBrand",
            "website_url": "",
            "scraped_at": "2026-03-02T00:00:00Z",
            "products": [
                {
                    "name": "Vitamin Food",
                    "brand": "TestBrand",
                    "product_type": "food",
                    "product_format": "dry",
                    "channel": "retail",
                    "ingredients_raw": "Chicken, Vitamin A Supplement, Mixed Tocopherols for freshness.",
                }
            ],
        }
        filepath = tmp_path / "testbrand.json"
        filepath.write_text(json.dumps(brand_json))

        families = FamiliesLookup(_sample_families_data())

        cur = MockCursor()
        # Only brand + product + 1 ingredient (Chicken) — the other 2 are ignored
        cur.set_return_values([
            ("brand-1",),
            ("product-1",),
            ("ing-1",),  # Chicken only
        ])

        stats: dict[str, int] = {
            "brands": 0,
            "products": 0,
            "ingredients_known": 0,
            "ingredients_unknown": 0,
        }
        unknown: set[str] = set()
        loaded_keys: set[tuple[str, str]] = set()

        load_brand_file(cur, filepath, families, stats, unknown, loaded_keys)

        assert stats["ingredients_known"] == 1
        assert stats["ingredients_unknown"] == 0
        assert unknown == set()

    def test_manual_products_brand_override(self, tmp_path: Path) -> None:
        """Products with a different brand than the file-level brand get their
        own brand upsert (like manual_products.json with brand='Whole Food')."""
        brand_json = {
            "brand": "Manual",
            "website_url": "",
            "scraped_at": "2026-03-02T00:00:00Z",
            "products": [
                {
                    "name": "Boiled Chicken Breast",
                    "brand": "Whole Food",
                    "product_type": "food",
                    "product_format": "wet",
                    "channel": "seed",
                    "ingredients_raw": "Chicken",
                }
            ],
        }
        filepath = tmp_path / "manual_products.json"
        filepath.write_text(json.dumps(brand_json))

        families = FamiliesLookup(_sample_families_data())

        cur = MockCursor()
        # brand upsert (Manual), brand upsert (Whole Food), product, ingredient
        cur.set_return_values([
            ("brand-manual",),
            ("brand-wholefood",),
            ("product-1",),
            ("ing-1",),
        ])

        stats = {"brands": 0, "products": 0, "ingredients_known": 0, "ingredients_unknown": 0}
        unknown: set[str] = set()
        loaded_keys: set[tuple[str, str]] = set()

        load_brand_file(cur, filepath, families, stats, unknown, loaded_keys)

        # Should have 2 brand upserts (Manual + Whole Food)
        brand_queries = [q for q in cur.queries if "INSERT INTO brands" in q]
        assert len(brand_queries) == 2
        assert ("Boiled Chicken Breast", "Whole Food") in loaded_keys
