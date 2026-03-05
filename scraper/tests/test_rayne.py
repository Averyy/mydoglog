"""Tests for scrapers.rayne — Rayne Clinical Nutrition parsing logic."""

from scrapers.rayne import (
    _detect_product_type,
    _get_ga_and_calories,
    _is_dog_product,
    _parse_ingredients,
    _parse_product,
    _parse_variants,
    _strip_marketing_copy,
)


class TestIsDogProduct:
    def test_dog_food(self) -> None:
        assert _is_dog_product({"title": "Crocodilia-MAINT Dry Dog Food", "product_type": "Dry"})

    def test_cat_food_excluded(self) -> None:
        assert not _is_dog_product({"title": "Rabbit-MAINT Canned Paté Cat Food", "product_type": "Wet"})

    def test_multi_species_included(self) -> None:
        assert _is_dog_product({"title": "Rabbit-DIAG Freeze-Dried Food For Dogs and Cats", "product_type": "Freeze-Dried"})

    def test_brochure_excluded(self) -> None:
        assert not _is_dog_product({"title": "Whole Food Pet Nutrition Brochure", "product_type": "Brochure"})


class TestDetectProductType:
    def test_dry(self) -> None:
        assert _detect_product_type({"product_type": "Dry"}) == "dry"

    def test_wet(self) -> None:
        assert _detect_product_type({"product_type": "Wet"}) == "wet"

    def test_stew_is_wet(self) -> None:
        assert _detect_product_type({"product_type": "Stew"}) == "wet"

    def test_treats(self) -> None:
        assert _detect_product_type({"product_type": "Treats"}) == "treats"

    def test_meatballs_are_treats(self) -> None:
        assert _detect_product_type({"product_type": "Meatballs"}) == "treats"

    def test_toppers_are_supplements(self) -> None:
        assert _detect_product_type({"product_type": "Toppers"}) == "supplements"

    def test_freeze_dried_is_dry(self) -> None:
        assert _detect_product_type({"product_type": "Freeze-Dried"}) == "dry"


class TestStripMarketingCopy:
    def test_no_marketing(self) -> None:
        text = "Dried chickpeas, alligator, dried peas, potato flour."
        assert _strip_marketing_copy(text) == text

    def test_strips_yup_marketing(self) -> None:
        text = "Kangaroo liver. Yup, that's it! Just one, real food ingredient in these treats."
        assert _strip_marketing_copy(text) == "Kangaroo liver."

    def test_strips_just_marketing(self) -> None:
        text = "Beef heart. Just one simple ingredient."
        assert _strip_marketing_copy(text) == "Beef heart."

    def test_preserves_multi_sentence_ingredients(self) -> None:
        # Ingredient text with periods that aren't marketing
        text = "Dried chickpeas, alligator."
        assert _strip_marketing_copy(text) == "Dried chickpeas, alligator."

    def test_no_period_returns_as_is(self) -> None:
        text = "Kangaroo liver, kangaroo heart"
        result = _strip_marketing_copy(text)
        # No ". " so returned as-is (with trailing period added)
        assert result == "Kangaroo liver, kangaroo heart"


class TestParseIngredients:
    def test_extracts_from_tab2(self) -> None:
        html = """
        <ul class="tabs-content">
            <li id="tab1">Description text</li>
            <li id="tab2">Dried chickpeas, alligator, dried peas, potato flour</li>
            <li id="tab3">GA image here</li>
        </ul>
        """
        result = _parse_ingredients(html)
        assert result is not None
        assert "alligator" in result
        assert "chickpeas" in result

    def test_strips_marketing_from_ingredients(self) -> None:
        html = '<ul><li id="tab2">Kangaroo liver. Yup, that\'s it! Just one, real food ingredient in these treats.</li></ul>'
        result = _parse_ingredients(html)
        assert result == "Kangaroo liver."
        assert "Yup" not in result

    def test_returns_none_for_empty_tab2(self) -> None:
        html = '<ul><li id="tab2">   </li></ul>'
        assert _parse_ingredients(html) is None

    def test_returns_none_for_no_body(self) -> None:
        assert _parse_ingredients("") is None


class TestParseVariants:
    def test_parses_shopify_variants(self) -> None:
        product = {
            "variants": [
                {"title": "6.6lb (bag)", "sku": "VC309M-3KG", "grams": 3175},
                {"title": "17.6lb (bag)", "sku": "VC309M-8KG", "grams": 7983},
            ]
        }
        variants = _parse_variants(product)
        assert len(variants) == 2
        assert variants[0]["size_kg"] == 3.175
        assert variants[0]["sku"] == "VC309M-3KG"
        assert variants[1]["size_kg"] == 7.983

    def test_empty_variants(self) -> None:
        assert _parse_variants({}) == []
        assert _parse_variants({"variants": []}) == []


class TestParseProduct:
    def test_full_product(self) -> None:
        product = {
            "id": 6005721006235,
            "title": "Crocodilia-MAINT Dry Dog Food",
            "handle": "crocodilia-maint-canine-bag",
            "product_type": "Dry",
            "body_html": '<ul class="tabs-content"><li id="tab2">Dried chickpeas, alligator</li></ul>',
            "images": [{"src": "https://cdn.shopify.com/test.jpg"}],
            "variants": [
                {"title": "6.6lb", "sku": "VC309M-3KG", "grams": 3000},
            ],
        }
        result = _parse_product(product)
        assert result is not None
        assert result["name"] == "Crocodilia-MAINT Dry Dog Food"
        assert result["brand"] == "Rayne"
        assert result["channel"] == "vet"
        assert result["product_type"] == "dry"
        assert result["ingredients_raw"] == "Dried chickpeas, alligator"
        assert len(result["images"]) == 1
        assert len(result["variants"]) == 1
        assert result["source_id"] == "6005721006235"

    def test_includes_ga_for_known_handle(self) -> None:
        product = {
            "id": 6005721006235,
            "title": "Crocodilia-MAINT Dry Dog Food",
            "handle": "crocodilia-maint-canine-bag",
            "product_type": "Dry",
            "body_html": '<ul><li id="tab2">Dried chickpeas, alligator</li></ul>',
            "images": [],
            "variants": [],
        }
        result = _parse_product(product)
        assert result is not None
        assert "guaranteed_analysis" in result
        ga = result["guaranteed_analysis"]
        assert ga["crude_protein_min"] == 20.9
        assert ga["crude_fat_min"] == 11.7
        assert ga["crude_fiber_max"] == 2.6
        assert ga["calcium_min"] == 0.79
        assert ga["phosphorus_min"] == 0.51
        assert ga["taurine_min"] == 0.13
        assert result["guaranteed_analysis_basis"] == "as-fed"

    def test_includes_calorie_content_for_dry_product(self) -> None:
        product = {
            "id": 123,
            "title": "Adult Health-RSS Dry Dog Food",
            "handle": "adult-health-rss-canine-bag",
            "product_type": "Dry",
            "body_html": "",
            "images": [],
            "variants": [],
        }
        result = _parse_product(product)
        assert result is not None
        assert "calorie_content" in result
        assert "3556 kcal/kg" in result["calorie_content"]
        assert "391 kcal/cup" in result["calorie_content"]

    def test_no_ga_for_unknown_handle(self) -> None:
        product = {
            "id": 999,
            "title": "Some Unknown Dog Food",
            "handle": "some-unknown-product",
            "product_type": "Dry",
            "body_html": "",
            "images": [],
            "variants": [],
        }
        result = _parse_product(product)
        assert result is not None
        assert "guaranteed_analysis" not in result
        assert "calorie_content" not in result

    def test_sample_inherits_ga_from_main(self) -> None:
        """Sample products should get GA data from the main product."""
        product = {
            "id": 456,
            "title": "Crocodilia-MAINT Canine Bag Sample",
            "handle": "crocodilia-maint-canine-bag-sample",
            "product_type": "Dry",
            "body_html": "",
            "images": [],
            "variants": [],
        }
        result = _parse_product(product)
        assert result is not None
        assert "guaranteed_analysis" in result
        assert result["guaranteed_analysis"]["crude_protein_min"] == 20.9
        assert "calorie_content" in result

    def test_returns_none_for_missing_title(self) -> None:
        assert _parse_product({"title": "", "handle": "test"}) is None

    def test_returns_none_for_missing_handle(self) -> None:
        assert _parse_product({"title": "Test", "handle": ""}) is None


class TestGetGaAndCalories:
    def test_direct_match(self) -> None:
        ga, cal = _get_ga_and_calories("crocodilia-maint-canine-bag")
        assert ga is not None
        assert ga["crude_protein_min"] == 20.9
        assert cal is not None
        assert "3524" in cal

    def test_sample_fallback(self) -> None:
        ga, cal = _get_ga_and_calories("rabbit-maint-canine-bag-sample")
        assert ga is not None
        assert ga["crude_protein_min"] == 26.2
        assert cal is not None

    def test_unknown_handle_returns_none(self) -> None:
        ga, cal = _get_ga_and_calories("nonexistent-product")
        assert ga is None
        assert cal is None

    def test_wet_product_with_calories(self) -> None:
        """Wet canned products have GA and calorie data from diet pages."""
        ga, cal = _get_ga_and_calories("crocodilia-maint-canine-cans-1")
        assert ga is not None
        assert ga["crude_protein_min"] == 7.0
        assert cal is not None
        assert "994 kcal/kg" in cal

    def test_all_dry_products_have_calories(self) -> None:
        """All dry products in _GA_DATA should have calorie content."""
        from scrapers.rayne import _GA_DATA

        dry_handles = [
            "crocodilia-maint-canine-bag",
            "adult-health-rss-canine-bag",
            "rabbit-maint-canine-bag",
            "low-fat-kangaroo-maint-canine-bag",
            "growth-sensitive-gi-canine-bag",
        ]
        for handle in dry_handles:
            ga, cal = _GA_DATA[handle]
            assert ga is not None, f"{handle} missing GA"
            assert cal is not None, f"{handle} missing calorie data"
            assert "kcal/kg" in cal, f"{handle} calorie data missing kcal/kg"
            assert "kcal/cup" in cal, f"{handle} calorie data missing kcal/cup"

    def test_diag_products_calorie_only(self) -> None:
        """DIAG (diagnostic elimination) products have calories but no GA."""
        diag_handles = [
            "rabbit-diag-dual-species-cans-1",
            "kangaroo-diag-dual-species-chunky-stew",
            "rabbit-diag-dual-species-freeze-dried",
            "kangaroo-diag-dual-species-freeze-dried",
        ]
        for handle in diag_handles:
            ga, cal = _get_ga_and_calories(handle)
            assert ga == {}, f"{handle} should have empty GA dict"
            assert cal is not None, f"{handle} missing calorie data"

    def test_dental_chews_have_ga(self) -> None:
        """Dental chews have full GA and calorie data."""
        ga, cal = _get_ga_and_calories("rabbit-dental-chews-for-dogs")
        assert ga is not None
        assert ga["crude_protein_min"] == 6.4
        assert cal is not None
        assert "2845 kcal/kg" in cal

    def test_ga_values_are_reasonable(self) -> None:
        """Sanity check that GA values are in realistic ranges."""
        from scrapers.rayne import _GA_DATA

        for handle, (ga, _cal) in _GA_DATA.items():
            if not ga:  # Skip calorie-only entries (DIAG, treats)
                continue

            protein = ga.get("crude_protein_min", 0)
            fat = ga.get("crude_fat_min", 0)
            fiber = ga.get("crude_fiber_max", 0)

            # Protein should be between 5% (wet) and 50% (dry)
            assert 5.0 <= protein <= 50.0, (
                f"{handle}: protein {protein}% outside 5-50% range"
            )
            # Fat should be between 1% and 25%
            assert 1.0 <= fat <= 25.0, (
                f"{handle}: fat {fat}% outside 1-25% range"
            )
            # Fiber should be between 0% and 10%
            assert 0.0 <= fiber <= 10.0, (
                f"{handle}: fiber {fiber}% outside 0-10% range"
            )
