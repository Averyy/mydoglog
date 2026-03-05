"""Tests for scrapers.nowfresh — Now Fresh parsing logic."""

from scrapers.nowfresh import _parse_product


class TestParseProduct:
    def test_prepends_product_line_to_name(self) -> None:
        """Product line is prepended to avoid name collisions."""
        fields = {
            "productName": "Turkey, Salmon & Duck Grain-Free Dry Dog Food",
            "titleEyebrow": "Large Breed Senior",
            "cat2Recipe": [
                {"fields": {"label": "de-boned turkey"}},
            ],
            "guaranteedAnalysis": [
                {"fields": {"label": "Crude protein (min) 25%", "quantity": "25%"}},
            ],
            "externalIDs": {"sku": "1303140"},
        }
        slug = "dog-food/dry/grain-free-large-breed-senior-recipe-with-turkey-salmon-duck"
        result = _parse_product(fields, slug)
        assert result is not None
        assert result["name"] == "Large Breed Senior Turkey, Salmon & Duck Grain-Free Dry Dog Food"
        assert result["product_line"] == "Large Breed Senior"
        assert result["brand"] == "Now Fresh"

    def test_no_product_line_uses_plain_name(self) -> None:
        """Without product_line, name is unchanged."""
        fields = {
            "productName": "Some Unique Dog Food",
            "cat2Recipe": [{"fields": {"label": "chicken"}}],
        }
        slug = "dog-food/dry/some-unique-recipe"
        result = _parse_product(fields, slug)
        assert result is not None
        assert result["name"] == "Some Unique Dog Food"
        assert "product_line" not in result

    def test_expanded_ingredients(self) -> None:
        """Composite ingredients (vitamins/minerals) are fully expanded."""
        fields = {
            "productName": "Test Dog Food",
            "titleEyebrow": "Adult",
            "cat2Recipe": [
                {"fields": {"label": "de-boned turkey"}},
                {
                    "fields": {
                        "label": "vitamins",
                        "compositeList": [
                            {"fields": {"label": "vitamin E supplement"}},
                            {"fields": {"label": "niacin"}},
                        ],
                    }
                },
                {
                    "fields": {
                        "label": "minerals",
                        "compositeList": [
                            {"fields": {"label": "zinc proteinate"}},
                            {"fields": {"label": "iron proteinate"}},
                        ],
                    }
                },
            ],
        }
        slug = "dog-food/dry/test-recipe"
        result = _parse_product(fields, slug)
        assert result is not None
        assert "vitamins (vitamin E supplement, niacin)" in result["ingredients_raw"]
        assert "minerals (zinc proteinate, iron proteinate)" in result["ingredients_raw"]

    def test_glucosamine_comma_parsing(self) -> None:
        """GA values with commas like '1,000 mg/kg' parse correctly."""
        fields = {
            "productName": "Test Dog Food",
            "titleEyebrow": "Large Breed Senior",
            "guaranteedAnalysis": [
                {"fields": {"label": "*Glucosamine (min) 1,000 mg/kg", "quantity": "1,000 mg/kg"}},
                {"fields": {"label": "*Chondroitin (min) 300 mg/kg", "quantity": "300 mg/kg"}},
            ],
        }
        slug = "dog-food/dry/test-recipe"
        result = _parse_product(fields, slug)
        assert result is not None
        ga = result["guaranteed_analysis"]
        assert ga["glucosamine_min"] == 1000.0
        assert ga["chondroitin_min"] == 300.0

    def test_returns_none_for_missing_name(self) -> None:
        assert _parse_product({}, "some-slug") is None
        assert _parse_product({"productName": ""}, "some-slug") is None
