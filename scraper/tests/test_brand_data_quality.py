"""Validate scraped brand JSON data quality.

Checks all brand JSON files for completeness, sane values, and data integrity
without making any HTTP requests.
"""

import json
import re
from pathlib import Path

import pytest

BRANDS_DIR = Path(__file__).parent.parent / "data" / "brands"

# PetSmart brands use the shared petsmart.py scraper with flat GA format
PETSMART_BRANDS = {
    "simplynourish",
    "naturalbalance",
    "instinct",
    "nulo",
    "canidae",
    "eukanuba",
}


def _load_all_brands() -> list[tuple[str, dict]]:
    """Load all PetSmart brand JSON files, returning (filename, data) pairs."""
    results = []
    for f in sorted(BRANDS_DIR.glob("*.json")):
        if f.stem in PETSMART_BRANDS:
            with open(f) as fh:
                data = json.load(fh)
            results.append((f.stem, data))
    return results


def _all_products() -> list[tuple[str, dict]]:
    """Yield (brand_name, product) for every product across all brands."""
    results = []
    for brand, data in _load_all_brands():
        for p in data["products"]:
            results.append((brand, p))
    return results


class TestCompleteness:
    """Every product should have ingredients, GA, and calories."""

    @pytest.mark.parametrize(
        "brand,product",
        _all_products(),
        ids=lambda x: x["name"][:60] if isinstance(x, dict) else x,
    )
    def test_has_ingredients(self, brand: str, product: dict) -> None:
        ing = product.get("ingredients_raw", "")
        assert ing and len(ing) > 3, (
            f"[{brand}] {product['name']}: missing or too-short ingredients"
        )

    @pytest.mark.parametrize(
        "brand,product",
        _all_products(),
        ids=lambda x: x["name"][:60] if isinstance(x, dict) else x,
    )
    def test_has_ga(self, brand: str, product: dict) -> None:
        ga = product.get("guaranteed_analysis")
        assert ga, f"[{brand}] {product['name']}: missing GA"
        assert "crude_protein_min" in ga, (
            f"[{brand}] {product['name']}: GA missing crude_protein_min"
        )

    @pytest.mark.parametrize(
        "brand,product",
        _all_products(),
        ids=lambda x: x["name"][:60] if isinstance(x, dict) else x,
    )
    def test_has_calories(self, brand: str, product: dict) -> None:
        cal = product.get("calorie_content", "")
        assert cal, f"[{brand}] {product['name']}: missing calorie_content"
        assert "kcal" in cal, (
            f"[{brand}] {product['name']}: calorie_content missing 'kcal': {cal}"
        )


class TestGASanity:
    """GA values should be within physically reasonable ranges."""

    @pytest.mark.parametrize(
        "brand,product",
        _all_products(),
        ids=lambda x: x["name"][:60] if isinstance(x, dict) else x,
    )
    def test_ga_values_reasonable(self, brand: str, product: dict) -> None:
        ga = product.get("guaranteed_analysis", {})
        if not ga:
            pytest.skip("no GA")

        for key, val in ga.items():
            # No percentage should exceed 99% (bone broths can be 98% moisture)
            if isinstance(val, (int, float)) and "%" not in key:
                assert val <= 99.0, (
                    f"[{brand}] {product['name']}: {key}={val} exceeds 99%"
                )

        # Fiber should be max, not min
        assert "crude_fiber_min" not in ga, (
            f"[{brand}] {product['name']}: has crude_fiber_min "
            f"(should be crude_fiber_max)"
        )
        # Moisture should be max, not min
        assert "moisture_min" not in ga, (
            f"[{brand}] {product['name']}: has moisture_min "
            f"(should be moisture_max)"
        )


class TestCalorieSanity:
    """Calorie values should be within reasonable ranges."""

    @pytest.mark.parametrize(
        "brand,product",
        _all_products(),
        ids=lambda x: x["name"][:60] if isinstance(x, dict) else x,
    )
    def test_calories_reasonable(self, brand: str, product: dict) -> None:
        cal = product.get("calorie_content", "")
        if not cal:
            pytest.skip("no calories")

        fmt = product.get("product_format", "dry")
        name_lower = product.get("name", "").lower()

        # Detect actual product type from name (product_format doesn't
        # distinguish freeze-dried/frozen from regular dry/wet)
        is_frozen = "frozen" in name_lower
        is_freeze_dried = (
            ("freeze" in name_lower and "dried" in name_lower)
            or ("raw boost" in name_lower and not is_frozen)
        )
        # Only match actual broth/puree products, not "chicken in broth"
        is_broth_or_puree = (
            "bone broth" in name_lower or "puree" in name_lower
        )

        kg_match = re.search(r"(\d+)\s*kcal/kg", cal)
        if kg_match:
            kcal_kg = int(kg_match.group(1))
            if is_freeze_dried:
                # Freeze-dried is calorie-dense like dry food
                assert 2500 <= kcal_kg <= 5500, (
                    f"[{brand}] {product['name']}: kcal/kg={kcal_kg} "
                    f"out of range for freeze-dried food"
                )
            elif is_frozen:
                # Frozen raw has wet-like calorie density
                assert 800 <= kcal_kg <= 2500, (
                    f"[{brand}] {product['name']}: kcal/kg={kcal_kg} "
                    f"out of range for frozen food"
                )
            elif is_broth_or_puree:
                # Bone broths and purees can be very low calorie
                assert 20 <= kcal_kg <= 1000, (
                    f"[{brand}] {product['name']}: kcal/kg={kcal_kg} "
                    f"out of range for broth/puree"
                )
            elif fmt == "dry":
                assert 2500 <= kcal_kg <= 5500, (
                    f"[{brand}] {product['name']}: kcal/kg={kcal_kg} "
                    f"out of range for dry food"
                )
            elif fmt == "wet":
                assert 400 <= kcal_kg <= 2500, (
                    f"[{brand}] {product['name']}: kcal/kg={kcal_kg} "
                    f"out of range for wet food"
                )

        # Should not contain raw unparsed formats
        assert "ME (" not in cal, (
            f"[{brand}] {product['name']}: unparsed calorie format: {cal}"
        )


class TestIngredientQuality:
    """Ingredient text should be clean and free of artifacts."""

    @pytest.mark.parametrize(
        "brand,product",
        _all_products(),
        ids=lambda x: x["name"][:60] if isinstance(x, dict) else x,
    )
    def test_no_mojibake(self, brand: str, product: dict) -> None:
        ing = product.get("ingredients_raw", "")
        # Allow en-dash (–) and em-dash (—) which PetSmart uses
        # Flag other non-ASCII as potential mojibake
        for i, ch in enumerate(ing):
            if ord(ch) > 127 and ch not in "–—®™°é·":
                context = ing[max(0, i - 15) : i + 15]
                pytest.fail(
                    f"[{brand}] {product['name']}: "
                    f"non-ASCII U+{ord(ch):04X} at pos {i}: ...{context}..."
                )

    @pytest.mark.parametrize(
        "brand,product",
        _all_products(),
        ids=lambda x: x["name"][:60] if isinstance(x, dict) else x,
    )
    def test_no_marketing_text(self, brand: str, product: dict) -> None:
        """Ingredients should not contain marketing copy."""
        ing = product.get("ingredients_raw", "")
        bad_patterns = [
            r"(?i)\bour\s+(healthy|premium|natural)\b",
            r"(?i)\bformulated\s+to\b",
            r"(?i)\bno\s+artificial\b",
            r"(?i)\b100%\s+complete\b",
        ]
        for pattern in bad_patterns:
            assert not re.search(pattern, ing), (
                f"[{brand}] {product['name']}: "
                f"marketing text in ingredients matching '{pattern}'"
            )
