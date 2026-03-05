"""Tests for scrapers.gosolutions — Go! Solutions parsing logic."""

from scrapers.gosolutions import (
    _detect_product_type,
    _parse_calorie_content,
    _parse_ga,
    _parse_images,
    _parse_ingredients,
    _parse_product,
    _parse_product_line,
    _parse_variants,
)


class TestDetectProductType:
    def test_dry(self) -> None:
        assert _detect_product_type("dog-food/dry/some-recipe") == "dry"

    def test_wet(self) -> None:
        assert _detect_product_type("dog-food/wet/some-recipe") == "wet"

    def test_toppers_are_supplements(self) -> None:
        assert _detect_product_type("dog-food/toppers/some-topper") == "supplements"

    def test_treats(self) -> None:
        assert _detect_product_type("dog-food/treats/some-treat") == "treats"

    def test_default_dry(self) -> None:
        assert _detect_product_type("dog-food/unknown") == "dry"


class TestParseIngredients:
    def test_from_cat2recipe(self) -> None:
        fields = {
            "cat2Recipe": [
                {"fields": {"label": "de-boned turkey"}},
                {"fields": {"label": "turkey meal"}},
                {"fields": {"label": "tapioca"}},
            ]
        }
        result = _parse_ingredients(fields)
        assert result == "de-boned turkey, turkey meal, tapioca"

    def test_fallback_to_cat3recipe(self) -> None:
        fields = {
            "cat2Recipe": [],
            "cat3Recipe": [
                {"fields": {"label": "chicken"}},
                {"fields": {"label": "rice"}},
            ],
        }
        result = _parse_ingredients(fields)
        assert result == "chicken, rice"

    def test_composite_ingredients_expanded(self) -> None:
        """Vitamin/mineral premix entries with compositeList are expanded."""
        fields = {
            "cat2Recipe": [
                {"fields": {"label": "de-boned turkey"}},
                {"fields": {"label": "peas"}},
                {
                    "fields": {
                        "label": "vitamins",
                        "compositeList": [
                            {"fields": {"label": "vitamin E supplement"}},
                            {"fields": {"label": "niacin"}},
                            {"fields": {"label": "vitamin A supplement"}},
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
                {"fields": {"label": "dried rosemary"}},
            ]
        }
        result = _parse_ingredients(fields)
        assert result is not None
        assert "vitamins (vitamin E supplement, niacin, vitamin A supplement)" in result
        assert "minerals (zinc proteinate, iron proteinate)" in result
        assert result.startswith("de-boned turkey, peas")
        assert result.endswith("dried rosemary")

    def test_composite_empty_list_uses_label(self) -> None:
        """compositeList present but empty falls back to plain label."""
        fields = {
            "cat2Recipe": [
                {"fields": {"label": "vitamins", "compositeList": []}},
            ]
        }
        result = _parse_ingredients(fields)
        assert result == "vitamins"

    def test_empty_returns_none(self) -> None:
        assert _parse_ingredients({}) is None
        assert _parse_ingredients({"cat2Recipe": []}) is None


class TestParseGa:
    def test_standard_ga(self) -> None:
        fields = {
            "guaranteedAnalysis": [
                {"fields": {"label": "Crude protein (min) 26%", "ingredient": {"fields": {"label": "Crude protein (min)"}}, "quantity": "26%"}},
                {"fields": {"label": "Crude fat (min) 14%", "ingredient": {"fields": {"label": "Crude fat (min)"}}, "quantity": "14%"}},
                {"fields": {"label": "Crude fibre (max) 4%", "ingredient": {"fields": {"label": "Crude fibre (max)"}}, "quantity": "4%"}},
                {"fields": {"label": "Moisture (max) 10%", "ingredient": {"fields": {"label": "Moisture (max)"}}, "quantity": "10%"}},
            ]
        }
        ga = _parse_ga(fields)
        assert ga is not None
        assert ga["crude_protein_min"] == 26.0
        assert ga["crude_fat_min"] == 14.0
        assert ga["crude_fiber_max"] == 4.0
        assert ga["moisture_max"] == 10.0

    def test_omega_fields(self) -> None:
        fields = {
            "guaranteedAnalysis": [
                {"fields": {"label": "*Omega-6 (min) 2.4%", "quantity": "2.4%"}},
                {"fields": {"label": "*Omega-3 (min) 0.4%", "quantity": "0.4%"}},
            ]
        }
        ga = _parse_ga(fields)
        assert ga is not None
        assert ga["omega_6_min"] == 2.4
        assert ga["omega_3_min"] == 0.4

    def test_comma_in_number_parsed_correctly(self) -> None:
        """Values like '1,000 mg/kg' must parse as 1000.0, not 1.0."""
        fields = {
            "guaranteedAnalysis": [
                {"fields": {"label": "*Glucosamine (min) 1,000 mg/kg", "quantity": "1,000 mg/kg"}},
                {"fields": {"label": "*Chondroitin (min) 500 mg/kg", "quantity": "500 mg/kg"}},
            ]
        }
        ga = _parse_ga(fields)
        assert ga is not None
        assert ga["glucosamine_min"] == 1000.0
        assert ga["chondroitin_min"] == 500.0

    def test_large_comma_number(self) -> None:
        """Values like '198,000,000 CFU/kg' should not crash."""
        fields = {
            "guaranteedAnalysis": [
                {"fields": {"label": "*Microorganisms (min)", "quantity": "198,000,000 CFU/kg"}},
            ]
        }
        # This doesn't map to any known GA field, so it should be ignored gracefully
        ga = _parse_ga(fields)
        # No crash — returns None since no recognized fields
        assert ga is None

    def test_empty_returns_none(self) -> None:
        assert _parse_ga({}) is None
        assert _parse_ga({"guaranteedAnalysis": []}) is None


class TestParseCalorieContent:
    def test_standard_format(self) -> None:
        fields = {"calorieContent": "ME (calculated) = 4098 kcal/kg or 451 kcal/cup (250 ml)"}
        result = _parse_calorie_content(fields)
        assert result is not None
        assert "4098 kcal/kg" in result
        assert "451 kcal/cup" in result

    def test_empty(self) -> None:
        assert _parse_calorie_content({}) is None
        assert _parse_calorie_content({"calorieContent": ""}) is None


class TestParseImages:
    def test_product_image(self) -> None:
        fields = {
            "productImage": {
                "fields": {
                    "file": {"url": "//images.ctfassets.net/sa0sroutfts9/test/product.png"}
                }
            }
        }
        images = _parse_images(fields)
        assert len(images) == 1
        assert images[0] == "https://images.ctfassets.net/sa0sroutfts9/test/product.png"

    def test_carousel_images(self) -> None:
        fields = {
            "productImage": {"fields": {"file": {"url": "//cdn.test/main.jpg"}}},
            "carouselImages": [
                {"fields": {"file": {"url": "//cdn.test/img1.jpg"}}},
                {"fields": {"file": {"url": "//cdn.test/img2.jpg"}}},
            ],
        }
        images = _parse_images(fields)
        assert len(images) == 3

    def test_empty(self) -> None:
        assert _parse_images({}) == []


class TestParseProductLine:
    def test_from_eyebrow(self) -> None:
        assert _parse_product_line({"titleEyebrow": "Sensitivities"}) == "Sensitivities"

    def test_empty(self) -> None:
        assert _parse_product_line({}) is None
        assert _parse_product_line({"titleEyebrow": ""}) is None


class TestParseVariants:
    def test_multiple_lb_sizes(self) -> None:
        fields = {"packaging": "Available in 3.5 lb, 12 lb and 22 lb bag sizes"}
        variants = _parse_variants(fields)
        assert len(variants) == 3
        assert variants[0]["size_description"] == "3.5 lb"
        assert variants[0]["size_kg"] == round(3.5 * 0.453592, 3)
        assert variants[1]["size_description"] == "12 lb"
        assert variants[2]["size_description"] == "22 lb"

    def test_oz_with_parenthetical_g(self) -> None:
        """Parenthetical metric equivalent should be skipped."""
        fields = {"packaging": "Available in 2.8 oz (79 g) single-serve pouches"}
        variants = _parse_variants(fields)
        assert len(variants) == 1
        assert variants[0]["size_description"] == "2.8 oz"
        assert variants[0]["size_kg"] == round(2.8 * 0.0283495, 3)

    def test_oz_carton(self) -> None:
        fields = {"packaging": "Available in 12.5 oz (354 g) carton"}
        variants = _parse_variants(fields)
        assert len(variants) == 1
        assert variants[0]["size_description"] == "12.5 oz"

    def test_empty_packaging(self) -> None:
        assert _parse_variants({}) == []
        assert _parse_variants({"packaging": ""}) == []

    def test_non_string_packaging(self) -> None:
        assert _parse_variants({"packaging": 42}) == []


class TestParseProduct:
    def test_full_product_name_prefixed_with_product_line(self) -> None:
        fields = {
            "productName": "Turkey Grain-Free Limited Ingredient Dog Food",
            "titleEyebrow": "Sensitivities",
            "cat2Recipe": [
                {"fields": {"label": "de-boned turkey"}},
                {"fields": {"label": "turkey meal"}},
            ],
            "guaranteedAnalysis": [
                {"fields": {"label": "Crude protein (min) 26%", "quantity": "26%"}},
            ],
            "calorieContent": "ME (calculated) = 4098 kcal/kg or 451 kcal/cup (250 ml)",
            "productImage": {"fields": {"file": {"url": "//cdn.test/product.png"}}},
            "externalIDs": {"sku": "1303121"},
        }
        slug = "dog-food/dry/sensitivities-limited-ingredient-grain-free-turkey-recipe"
        result = _parse_product(fields, slug)
        assert result is not None
        assert result["name"] == "Sensitivities - Turkey Grain-Free Limited Ingredient Dog Food"
        assert result["brand"] == "Go! Solutions"
        assert result["product_type"] == "dry"
        assert result["product_line"] == "Sensitivities"
        assert result["ingredients_raw"] == "de-boned turkey, turkey meal"
        assert result["source_id"] == "1303121"

    def test_no_product_line_uses_plain_name(self) -> None:
        fields = {
            "productName": "Some Dog Food",
        }
        result = _parse_product(fields, "dog-food/dry/some-food")
        assert result is not None
        assert result["name"] == "Some Dog Food"
        assert "product_line" not in result

    def test_variants_extracted(self) -> None:
        fields = {
            "productName": "Turkey Dog Food",
            "titleEyebrow": "Sensitivities",
            "packaging": "Available in 3.5 lb, 12 lb and 22 lb bag sizes",
        }
        result = _parse_product(fields, "dog-food/dry/turkey")
        assert result is not None
        assert "variants" in result
        assert len(result["variants"]) == 3

    def test_returns_none_for_missing_name(self) -> None:
        assert _parse_product({}, "some-slug") is None
        assert _parse_product({"productName": ""}, "some-slug") is None
