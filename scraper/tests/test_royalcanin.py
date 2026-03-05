"""Tests for scrapers.royalcanin — Royal Canin parsing logic."""

from scrapers.royalcanin import (
    _parse_aafco,
    _parse_calorie_content,
    _parse_channel,
    _parse_ga,
    _parse_images,
    _parse_ingredients,
    _parse_product,
    _parse_product_type,
    _parse_variants,
    _parse_weight_kg,
)


class TestParseChannel:
    def test_retail_from_list(self) -> None:
        assert _parse_channel({"product_pillar": [{"code": "sptretail", "label": "SPT"}]}) == "retail"

    def test_vet_from_list(self) -> None:
        assert _parse_channel({"product_pillar": [{"code": "vet", "label": "VET"}]}) == "vet"

    def test_string_fallback(self) -> None:
        assert _parse_channel({"product_pillar": "sptretail"}) == "retail"

    def test_empty_defaults_retail(self) -> None:
        assert _parse_channel({"product_pillar": []}) == "retail"
        assert _parse_channel({}) == "retail"


class TestParseProductType:
    def test_dry_food(self) -> None:
        assert _parse_product_type({"digital_sub_category": {"code": "dry_food"}}) == "dry"

    def test_wet_food(self) -> None:
        assert _parse_product_type({"digital_sub_category": {"code": "wet_food"}}) == "wet"

    def test_treats_from_family(self) -> None:
        assert _parse_product_type({"digital_sub_category": {}, "is_treat": True}) == "treats"

    def test_default_dry(self) -> None:
        assert _parse_product_type({}) == "dry"


class TestParseIngredients:
    def test_from_composition(self) -> None:
        detail = {
            "composition": [
                {"ingredients": "Chicken by-product meal, brown rice, brewers rice"}
            ]
        }
        result = _parse_ingredients(detail)
        assert result == "Chicken by-product meal, brown rice, brewers rice"

    def test_no_ingredients(self) -> None:
        assert _parse_ingredients({"composition": [{"calorie_content": "x"}]}) is None
        assert _parse_ingredients({}) is None


class TestParseGa:
    def test_parses_standard_format(self) -> None:
        detail = {
            "composition": [{
                "guaranteed_analysis": (
                    "Crude Protein (min.) 28.0%, Crude Fat (min.) 14.0%, "
                    "Crude Fiber (max.) 3.9%, Moisture (max.) 10.0%"
                )
            }]
        }
        ga = _parse_ga(detail)
        assert ga is not None
        assert ga["crude_protein_min"] == 28.0
        assert ga["crude_fat_min"] == 14.0
        assert ga["crude_fiber_max"] == 3.9
        assert ga["moisture_max"] == 10.0

    def test_with_special_units(self) -> None:
        detail = {
            "composition": [{
                "guaranteed_analysis": (
                    "Crude Protein (min.) 28.0%, Vitamin E (min.) 420 IU/kg, "
                    "Glucosamine* (min.) 371 mg/kg"
                )
            }]
        }
        ga = _parse_ga(detail)
        assert ga is not None
        assert ga["crude_protein_min"] == 28.0

    def test_empty(self) -> None:
        assert _parse_ga({"composition": []}) is None
        assert _parse_ga({}) is None


class TestParseCalorieContent:
    def test_from_composition(self) -> None:
        detail = {
            "composition": [{
                "calorie_content": (
                    "This diet contains 3649 kilocalories of metabolizable energy (ME) "
                    "per kilogram or 369 kilocalories ME per cup on an as fed basis (calculated)."
                )
            }]
        }
        result = _parse_calorie_content(detail)
        assert result == "3649 kcal/kg, 369 kcal/cup"

    def test_rejects_ga_text_in_calorie_field(self) -> None:
        """API sometimes populates calorie_content with GA text instead of actual
        calorie data (e.g. product 1480 — GI High Fiber Loaf In Sauce).
        The parser must reject this because the text lacks 'kcal'."""
        detail = {
            "composition": [{
                "calorie_content": (
                    "Crude Protein (min.)3.96%,\u00a0Crude Fat (min.)1.21%,"
                    "\u00a0Crude Fiber (min.)1.3%,\u00a0Crude Fiber (max.)3.8%,"
                    "\u00a0Moisture (max.)78.0%"
                )
            }]
        }
        result = _parse_calorie_content(detail)
        assert result is None

    def test_empty_composition(self) -> None:
        assert _parse_calorie_content({"composition": []}) is None
        assert _parse_calorie_content({}) is None


class TestParseAafco:
    def test_from_composition(self) -> None:
        detail = {
            "composition": [{
                "aafco_statement": "100% COMPLETE AND BALANCED NUTRITION"
            }]
        }
        assert _parse_aafco(detail) == "100% COMPLETE AND BALANCED NUTRITION"

    def test_from_top_level(self) -> None:
        detail = {"aafco_statement": "AAFCO Dog Food Nutrient Profiles"}
        assert _parse_aafco(detail) == "AAFCO Dog Food Nutrient Profiles"


class TestParseWeightKg:
    def test_kg(self) -> None:
        assert _parse_weight_kg("3.5 kg") == 3.5
        assert _parse_weight_kg("10kg") == 10.0

    def test_grams(self) -> None:
        assert _parse_weight_kg("380 g") == 0.38

    def test_pounds(self) -> None:
        result = _parse_weight_kg("8.5 lbs")
        assert result is not None
        assert 3.8 < result < 3.9

    def test_unparseable(self) -> None:
        assert _parse_weight_kg("") is None


class TestParseVariants:
    def test_parses_packs(self) -> None:
        detail = {
            "packs": [
                {
                    "ean": "030111451958",
                    "converted_weight": "1.1",
                    "base_pack_size": "1.1 kg",
                    "scode": "P451925B",
                },
                {
                    "ean": "030111451965",
                    "converted_weight": "5.9",
                    "base_pack_size": "5.9 kg",
                    "scode": "P451926B",
                },
            ]
        }
        variants = _parse_variants(detail)
        assert len(variants) == 2
        assert variants[0]["size_kg"] == 1.1
        assert variants[0]["upc"] == "030111451958"
        assert variants[0]["sku"] == "P451925B"
        assert variants[1]["size_kg"] == 5.9

    def test_weight_in_grams_fallback(self) -> None:
        detail = {
            "packs": [{"weight_in_grams": 85, "ean": "123"}]
        }
        variants = _parse_variants(detail)
        assert len(variants) == 1
        assert variants[0]["size_kg"] == 0.085

    def test_empty_packs(self) -> None:
        assert _parse_variants({}) == []
        assert _parse_variants({"packs": []}) == []


class TestParseImages:
    def test_extracts_bag_and_kibble(self) -> None:
        detail = {
            "bag_image": {"url": "https://cdn.royalcanin.com/bag.jpg"},
            "thumbnail": {"url": "https://cdn.royalcanin.com/thumb.jpg"},
            "kibble_image": {"url": "https://cdn.royalcanin.com/kibble.jpg"},
        }
        images = _parse_images(detail)
        assert len(images) == 3

    def test_skips_empty(self) -> None:
        assert _parse_images({}) == []
        assert _parse_images({"bag_image": {}}) == []


class TestParseProduct:
    def test_full_product(self) -> None:
        listing = {
            "title": "Gastrointestinal Low Fat",
            "titleUrl": "gastrointestinal-low-fat-dry-dog-food",
            "bvProductId": "40467",
        }
        detail = {
            "product_title": "Gastrointestinal Low Fat Dry Dog Food",
            "product_pillar": [{"code": "vet"}],
            "digital_sub_category": {"code": "dry_food"},
            "composition": [
                {"ingredients": "Brewers rice, chicken by-product meal"},
                {"guaranteed_analysis": "Crude Protein (min.) 26.0%"},
                {"calorie_content": "3300 kcal/kg or 280 kcal/cup"},
            ],
            "bag_image": {"url": "https://cdn.royalcanin.com/gi-lf.jpg"},
            "packs": [
                {"converted_weight": "1.5", "ean": "1234567890123", "base_pack_size": "1.5 kg"},
                {"converted_weight": "8.0", "ean": "1234567890124", "base_pack_size": "8 kg"},
            ],
            "lifestage": [{"code": "adult", "label": "Adult"}],
        }
        product = _parse_product(listing, detail)

        assert product["name"] == "Gastrointestinal Low Fat Dry Dog Food"
        assert product["brand"] == "Royal Canin"
        assert product["channel"] == "vet"
        assert product["product_type"] == "dry"
        assert product["source_id"] == "40467"
        assert product["ingredients_raw"] == "Brewers rice, chicken by-product meal"
        assert len(product["images"]) == 1
        assert len(product["variants"]) == 2
        assert product["life_stage"] == "Adult"

    def test_minimal_product(self) -> None:
        listing = {"title": "Basic Food", "titleUrl": "basic", "bvProductId": "1"}
        detail = {"product_title": "Basic Food"}
        product = _parse_product(listing, detail)

        assert product["name"] == "Basic Food"
        assert product["channel"] == "retail"
        assert product["product_type"] == "dry"
