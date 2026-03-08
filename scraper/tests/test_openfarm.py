"""Tests for scrapers.openfarm -- Open Farm parsing logic."""

from scrapers.openfarm import (
    _detect_format,
    _detect_product_line,
    _detect_type,
    _extract_tag_value,
    _is_dog_product,
    _parse_calorie_html,
    _parse_ga_html,
    _parse_ingredients_from_modal,
    _parse_ingredients_html,
    _parse_product,
    _parse_size_description,
    _parse_variants,
    _detect_life_stage,
    _url_encode_handle,
)


class TestIsDogProduct:
    def test_dog_from_tags(self) -> None:
        assert _is_dog_product({"title": "Chicken Recipe", "tags": ["product_dog", "category::Dry Dog Food"]})

    def test_cat_excluded(self) -> None:
        assert not _is_dog_product({"title": "Chicken Recipe", "tags": ["product_cat", "category::Dry Cat Food"]})

    def test_dog_from_title(self) -> None:
        assert _is_dog_product({"title": "Chicken Dog Food", "tags": []})


class TestExtractTagValue:
    def test_found(self) -> None:
        assert _extract_tag_value(["_protein::salmon", "_lifestage::adult"], "_protein::") == "salmon"

    def test_not_found(self) -> None:
        assert _extract_tag_value(["_protein::salmon"], "_lifestage::") is None


class TestDetectType:
    def test_dry_is_food(self) -> None:
        assert _detect_type(["_productType::dry"], "Recipe") == "food"

    def test_wet_is_food(self) -> None:
        assert _detect_type(["_productType::wet"], "Recipe") == "food"

    def test_treats_from_tag(self) -> None:
        assert _detect_type(["_productType::treat"], "Recipe") == "treat"

    def test_rawmix_is_food(self) -> None:
        assert _detect_type(["_productType::rawmix"], "Recipe") == "food"

    def test_default_food(self) -> None:
        assert _detect_type([], "Recipe") == "food"

    def test_supplement_from_title(self) -> None:
        assert _detect_type([], "Bone Broth Recipe") == "supplement"

    def test_topper_is_supplement(self) -> None:
        assert _detect_type(["_productType::topper"], "Recipe") == "supplement"


class TestDetectFormat:
    def test_dry_from_tag(self) -> None:
        assert _detect_format(["_productType::dry"], "Recipe") == "dry"

    def test_wet_from_tag(self) -> None:
        assert _detect_format(["_productType::wet"], "Recipe") == "wet"

    def test_rawmix_is_dry(self) -> None:
        assert _detect_format(["_productType::rawmix"], "Recipe") == "dry"

    def test_default_dry(self) -> None:
        assert _detect_format([], "Recipe") == "dry"

    def test_pate_is_wet(self) -> None:
        assert _detect_format([], "Chicken Pâté Recipe") == "wet"

    def test_stew_is_wet(self) -> None:
        assert _detect_format(["_productType::stew"], "Hearty Stew") == "wet"


class TestDetectProductLine:
    def test_from_brand_tag(self) -> None:
        assert _detect_product_line(["_brand::GoodGut"], "Some Title") == "GoodGut"

    def test_none_without_tag(self) -> None:
        assert _detect_product_line([], "Some Title") is None

    def test_goodbowl_normalized(self) -> None:
        """Lowercase brand tags get title-cased."""
        assert _detect_product_line(["_brand::goodbowl"], "Some Title") == "Goodbowl"

    def test_hearty_stew_from_title(self) -> None:
        assert _detect_product_line([], "Chicken Hearty Stew Wet Dog Food") == "Hearty Stew"

    def test_healthy_weight_from_title(self) -> None:
        assert _detect_product_line([], "Chicken Healthy Weight Dog Kibble") == "Healthy Weight"

    def test_digestive_health_from_title(self) -> None:
        assert _detect_product_line([], "Pollock Digestive Health Dog Kibble") == "Digestive Health"

    def test_skin_coat_from_title(self) -> None:
        assert _detect_product_line([], "Salmon Skin & Coat Health Dog Kibble") == "Skin & Coat Health"

    def test_dietary_needs_fallback(self) -> None:
        """_dietaryneeds:: tag maps to product line when no _brand:: or title match."""
        assert _detect_product_line(["_dietaryneeds::weightmanagement"], "Chicken Pate") == "Healthy Weight"

    def test_rustic_stew_from_title(self) -> None:
        assert _detect_product_line([], "Grass-Fed Beef Rustic Stew Wet Dog Food") == "Rustic Stew"

    def test_icelandic_from_title(self) -> None:
        assert _detect_product_line([], "Icelandic Cod & Herring Wet Food") == "Icelandic"

    def test_freshly_crafted_from_title(self) -> None:
        assert _detect_product_line([], "Harvest Chicken Freshly Crafted Dog Food") == "Freshly Crafted"

    def test_freeze_dried_raw_from_title(self) -> None:
        assert _detect_product_line([], "Grass-Fed Beef Freeze Dried Raw Morsels") == "Freeze Dried Raw"

    def test_bone_broth_from_title(self) -> None:
        assert _detect_product_line([], "Homestead Turkey Bone Broth For Dogs") == "Bone Broth"

    def test_brand_tag_takes_priority(self) -> None:
        """_brand:: tag should win over title-based inference."""
        assert _detect_product_line(["_brand::RawMix"], "Hearty Stew Recipe") == "RawMix"


class TestDetectLifeStage:
    def test_adult_only(self) -> None:
        assert _detect_life_stage(["_lifestage::adult"], "Recipe") == "Adult"

    def test_all_lifestages_tag(self) -> None:
        assert _detect_life_stage(["_lifestage::all_lifestages", "_lifestage::adult"], "Recipe") == "All Life Stages"

    def test_puppy_and_adult_is_all(self) -> None:
        """Products with both puppy and adult stages are All Life Stages."""
        tags = ["_lifestage::adult", "_lifestage::puppy", "_lifestage::puppymedium", "_lifestage::senior"]
        assert _detect_life_stage(tags, "Recipe") == "All Life Stages"

    def test_puppy_only(self) -> None:
        tags = ["_lifestage::puppy", "_lifestage::puppysmall"]
        assert _detect_life_stage(tags, "Recipe") == "Puppy"

    def test_puppy_from_title(self) -> None:
        """Title fallback when no tags present."""
        assert _detect_life_stage([], "Puppy Recipe") == "Puppy"

    def test_no_stage(self) -> None:
        assert _detect_life_stage([], "Recipe") is None

    def test_adult_and_senior_without_puppy(self) -> None:
        """Adult + senior but no puppy is just Adult."""
        tags = ["_lifestage::adult", "_lifestage::senior"]
        assert _detect_life_stage(tags, "Recipe") == "Adult"


class TestParseSizeDescription:
    def test_lb(self) -> None:
        assert _parse_size_description("3.5 lb") == round(3.5 * 0.45359237, 3)

    def test_large_lb(self) -> None:
        assert _parse_size_description("22 lb") == round(22 * 0.45359237, 3)

    def test_oz(self) -> None:
        assert _parse_size_description("12.5 oz") == round(12.5 * 0.02834952, 3)

    def test_oz_case(self) -> None:
        """Case multiplier is ignored -- per-unit weight only."""
        result = _parse_size_description("12.5 oz (Case of 12)")
        assert result == round(12.5 * 0.02834952, 3)

    def test_kg(self) -> None:
        assert _parse_size_description("2.5 kg") == 2.5

    def test_fl_oz(self) -> None:
        """Fluid ounces (bone broth) converted to kg."""
        result = _parse_size_description("12 fl oz")
        assert result == round(12 * 0.02834952, 3)

    def test_fl_oz_large(self) -> None:
        result = _parse_size_description("33.8 fl oz")
        assert result == round(33.8 * 0.02834952, 3)

    def test_empty(self) -> None:
        assert _parse_size_description("") == 0.0

    def test_no_unit(self) -> None:
        assert _parse_size_description("Default Title") == 0.0


class TestUrlEncodeHandle:
    def test_plain_handle(self) -> None:
        assert _url_encode_handle("chicken-recipe") == "chicken-recipe"

    def test_trademark_encoded(self) -> None:
        encoded = _url_encode_handle("goodbowl\u2122-chicken-pate")
        assert "%E2%84%A2" in encoded
        assert "goodbowl" in encoded

    def test_tilde_preserved(self) -> None:
        assert _url_encode_handle("test~handle") == "test~handle"


class TestParseIngredientsFromModal:
    def test_full_modal(self) -> None:
        html = """
        <div class="ingredients-modal">
            <div>
                <h4 class="flex-35%">Chicken</h4>
                <h4 class="flex-35%">Chicken Meal</h4>
                <h4 class="flex-35%">Sweet Potatoes</h4>
                <h4 class="flex-35%">Peas</h4>
                <h4 class="flex-35%">Chickpeas</h4>
            </div>
        </div>
        """
        result = _parse_ingredients_from_modal(html)
        assert result is not None
        assert result == "Chicken, Chicken Meal, Sweet Potatoes, Peas, Chickpeas"

    def test_no_modal(self) -> None:
        html = "<div>No modal here</div>"
        assert _parse_ingredients_from_modal(html) is None

    def test_two_ingredients(self) -> None:
        """Simple treats may only have 2 ingredients -- that's valid."""
        html = """
        <div class="ingredients-modal">
            <h4>Cod</h4>
            <h4>Blueberries</h4>
        </div>
        """
        result = _parse_ingredients_from_modal(html)
        assert result == "Cod, Blueberries"

    def test_empty_modal(self) -> None:
        html = """
        <div class="ingredients-modal">
        </div>
        """
        assert _parse_ingredients_from_modal(html) is None


class TestParseIngredientsHtml:
    def test_modal_takes_priority(self) -> None:
        """Modal extraction should be preferred over inline heading-based extraction."""
        html = """
        <div>
            <h3>Ingredients</h3>
            <p>Chicken, chicken meal, sweet potatoes</p>
        </div>
        <div class="ingredients-modal">
            <h4>Chicken</h4>
            <h4>Chicken Meal</h4>
            <h4>Sweet Potatoes</h4>
            <h4>Peas</h4>
            <h4>Chickpeas</h4>
            <h4>Canola Oil</h4>
        </div>
        """
        result = _parse_ingredients_html(html)
        assert result is not None
        # Modal result has all 6 ingredients
        assert "Canola Oil" in result
        assert result.count(",") == 5

    def test_fallback_to_heading(self) -> None:
        """Falls back to heading-based extraction when no modal exists."""
        html = """
        <div>
            <h3>Ingredients</h3>
            <p>Chicken, chicken meal, sweet potatoes, peas, chickpeas, canola oil</p>
        </div>
        """
        result = _parse_ingredients_html(html)
        assert result is not None
        assert "Chicken" in result
        assert "sweet potatoes" in result


class TestParseGaHtml:
    def test_standard_table(self) -> None:
        html = """
        <table>
            <tr><td>Crude Protein (min)</td><td>30.0%</td></tr>
            <tr><td>Crude Fat (min)</td><td>16.0%</td></tr>
            <tr><td>Crude Fiber (max)</td><td>5.0%</td></tr>
            <tr><td>Moisture (max)</td><td>10.0%</td></tr>
        </table>
        """
        ga = _parse_ga_html(html)
        assert ga is not None
        assert ga["crude_protein_min"] == 30.0
        assert ga["crude_fat_min"] == 16.0


class TestParseCalorieHtml:
    def test_standard_format(self) -> None:
        html = "<p>3,700 kcal/kg (425 kcal/cup) Calculated Metabolizable Energy</p>"
        result = _parse_calorie_html(html)
        assert result is not None
        assert "3700 kcal/kg" in result
        assert "425 kcal/cup" in result


class TestParseVariants:
    def test_from_shopify_with_grams(self) -> None:
        product = {
            "variants": [
                {"title": "3.5 lb", "sku": "12010", "grams": 1588},
                {"title": "22 lb", "sku": "12011", "grams": 9979},
            ]
        }
        variants = _parse_variants(product)
        assert len(variants) == 2
        assert variants[0]["sku"] == "12010"
        assert variants[0]["size_kg"] == 1.588

    def test_from_shopify_zero_grams(self) -> None:
        """When grams=0, parse from title string."""
        product = {
            "variants": [
                {"title": "3.5 lb", "sku": "12010", "grams": 0},
                {"title": "18 lb", "sku": "12011", "grams": 0},
            ]
        }
        variants = _parse_variants(product)
        assert len(variants) == 2
        assert variants[0]["size_kg"] == round(3.5 * 0.45359237, 3)
        assert variants[1]["size_kg"] == round(18 * 0.45359237, 3)

    def test_oz_variant(self) -> None:
        """Ounce variants are converted correctly."""
        product = {
            "variants": [
                {"title": "12.5 oz (Case of 12)", "sku": "12020", "grams": 0},
            ]
        }
        variants = _parse_variants(product)
        assert len(variants) == 1
        assert variants[0]["size_kg"] == round(12.5 * 0.02834952, 3)

    def test_empty(self) -> None:
        assert _parse_variants({}) == []


class TestParseProduct:
    def test_minimal_product(self) -> None:
        shopify_product = {
            "id": 12345,
            "title": "Homestead Turkey & Chicken Recipe",
            "handle": "homestead-turkey-chicken",
            "tags": ["product_dog", "_productType::dry", "_brand::Original", "_lifestage::adult"],
            "images": [{"src": "https://cdn.shopify.com/test.jpg"}],
            "variants": [{"title": "3.5 lb", "sku": "12010", "grams": 1588}],
        }
        result = _parse_product(shopify_product, None)
        assert result is not None
        assert result["name"] == "Homestead Turkey & Chicken Recipe"
        assert result["brand"] == "Open Farm"
        assert result["product_type"] == "food"
        assert result["product_line"] == "Original"
        assert result["life_stage"] == "Adult"
        assert result["source_id"] == "12345"

    def test_with_html(self) -> None:
        shopify_product = {
            "id": 12345,
            "title": "Chicken Recipe",
            "handle": "chicken-recipe",
            "tags": ["product_dog"],
            "images": [],
            "variants": [],
        }
        html = """
        <div>
            <h3>Ingredients</h3>
            <p>Chicken, chicken meal, potatoes</p>
            <table>
                <tr><td>Crude Protein (min)</td><td>30.0%</td></tr>
                <tr><td>Crude Fat (min)</td><td>16.0%</td></tr>
            </table>
            <p>3,700 kcal/kg (425 kcal/cup)</p>
        </div>
        """
        result = _parse_product(shopify_product, html)
        assert result is not None
        assert "Chicken" in result.get("ingredients_raw", "")
        assert result["guaranteed_analysis"]["crude_protein_min"] == 30.0

    def test_trademark_handle_url_encoded(self) -> None:
        """Handles with trademark symbols should be URL-encoded in the URL."""
        shopify_product = {
            "id": 99999,
            "title": "Goodbowl\u2122 Chicken Pate",
            "handle": "goodbowl\u2122-chicken-pate",
            "tags": ["product_dog", "_brand::goodbowl", "_productType::wet"],
            "images": [],
            "variants": [],
        }
        result = _parse_product(shopify_product, None)
        assert result is not None
        assert "%E2%84%A2" in result["url"]
        assert result["product_line"] == "Goodbowl"

    def test_all_lifestages_detection(self) -> None:
        """Products with puppy + adult + senior tags should be All Life Stages."""
        shopify_product = {
            "id": 11111,
            "title": "RawMix Puppy Kibble",
            "handle": "rawmix-puppy-kibble",
            "tags": [
                "product_dog",
                "_brand::RawMix",
                "_lifestage::adult",
                "_lifestage::all_lifestages",
                "_lifestage::puppy",
                "_lifestage::puppylarge",
                "_lifestage::senior",
            ],
            "images": [],
            "variants": [],
        }
        result = _parse_product(shopify_product, None)
        assert result is not None
        assert result["life_stage"] == "All Life Stages"

    def test_product_line_from_title(self) -> None:
        """Products without _brand:: tag should get product_line from title."""
        shopify_product = {
            "id": 22222,
            "title": "Chicken & Grass-Fed Beef Hearty Stew Wet Dog Food",
            "handle": "chicken-beef-hearty-stew",
            "tags": ["product_dog", "_productType::wet"],
            "images": [],
            "variants": [],
        }
        result = _parse_product(shopify_product, None)
        assert result is not None
        assert result["product_line"] == "Hearty Stew"

    def test_zero_grams_variants_parsed(self) -> None:
        """Variants with grams=0 should still get size_kg from title parsing."""
        shopify_product = {
            "id": 33333,
            "title": "Some Kibble",
            "handle": "some-kibble",
            "tags": ["product_dog"],
            "images": [],
            "variants": [
                {"title": "3.5 lb", "sku": "ABC", "grams": 0},
                {"title": "18 lb", "sku": "DEF", "grams": 0},
            ],
        }
        result = _parse_product(shopify_product, None)
        assert result is not None
        variants = result["variants"]
        assert variants[0]["size_kg"] > 1.5  # 3.5 lb ~= 1.59 kg
        assert variants[1]["size_kg"] > 8.0  # 18 lb ~= 8.16 kg
