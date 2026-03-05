"""Tests for scrapers.hills — Hill's parsing logic."""

from unittest.mock import MagicMock

from bs4 import BeautifulSoup

from scrapers.hills import (
    _ca_url_to_us_url,
    _extract_datalayer,
    _find_accordion_content,
    _parse_channel,
    _parse_ga,
    _parse_health_tags,
    _parse_hills_weight,
    _parse_ingredients,
    _parse_product_type,
    _supplement_from_us_site,
)


class TestExtractDatalayer:
    def test_extracts_product_data(self) -> None:
        html = """
        <html><head>
        <script>
        window.dataLayer = [{"itemBrand":"pd","productForm":"dry","condition":"giDisorders","sku":"BK34100"}];
        </script>
        </head><body></body></html>
        """
        result = _extract_datalayer(html)
        assert result is not None
        assert result["itemBrand"] == "pd"
        assert result["productForm"] == "dry"
        assert result["condition"] == "giDisorders"
        assert result["sku"] == "BK34100"

    def test_multiline_datalayer(self) -> None:
        html = """
        <script>
        window.dataLayer = [
            {
                "itemBrand": "sd",
                "productForm": "treat"
            }
        ];
        </script>
        """
        result = _extract_datalayer(html)
        assert result is not None
        assert result["itemBrand"] == "sd"

    def test_no_datalayer_returns_none(self) -> None:
        html = "<html><body>No script</body></html>"
        assert _extract_datalayer(html) is None

    def test_invalid_json_returns_none(self) -> None:
        html = '<script>window.dataLayer = [{broken json}];</script>'
        assert _extract_datalayer(html) is None


class TestParseChannel:
    def test_prescription_diet_is_vet(self) -> None:
        assert _parse_channel({"itemBrand": "pd"}) == "vet"

    def test_science_diet_is_retail(self) -> None:
        assert _parse_channel({"itemBrand": "sd"}) == "retail"

    def test_unknown_defaults_retail(self) -> None:
        assert _parse_channel({"itemBrand": "unknown"}) == "retail"
        assert _parse_channel({}) == "retail"
        assert _parse_channel(None) == "retail"


class TestParseProductType:
    def test_from_datalayer(self) -> None:
        assert _parse_product_type({"productForm": "dry"}, "") == "dry"
        assert _parse_product_type({"productForm": "stew"}, "") == "wet"
        assert _parse_product_type({"productForm": "canned"}, "") == "wet"
        assert _parse_product_type({"productForm": "treat"}, "") == "treats"

    def test_from_url_fallback(self) -> None:
        assert _parse_product_type({}, "https://hillspet.ca/en-ca/dog-food/treats/something") == "treats"

    def test_default_dry(self) -> None:
        assert _parse_product_type({}, "https://hillspet.ca/en-ca/dog-food/something") == "dry"
        assert _parse_product_type(None, "") == "dry"


class TestParseHealthTags:
    def test_gi_disorders(self) -> None:
        tags = _parse_health_tags({"condition": "giDisorders"})
        assert "digestive_health" in tags

    def test_multiple_conditions(self) -> None:
        tags = _parse_health_tags({"condition": "giDisorders|skinCoat|weight"})
        assert "digestive_health" in tags
        assert "skin_coat" in tags
        assert "weight_management" in tags

    def test_food_sensitivities(self) -> None:
        tags = _parse_health_tags({"condition": "foodSensitivities"})
        assert "food_sensitivities" in tags

    def test_empty_condition(self) -> None:
        assert _parse_health_tags({"condition": ""}) == []
        assert _parse_health_tags({}) == []
        assert _parse_health_tags(None) == []

    def test_kidney_and_urinary(self) -> None:
        tags = _parse_health_tags({"condition": "kidney|urinary"})
        assert "kidney_health" in tags
        assert "urinary_health" in tags


class TestParseHillsWeight:
    def test_lbs_to_kg(self) -> None:
        result = _parse_hills_weight("8.5 lbs")
        assert result is not None
        assert result == 3.86  # 8.5 / 2.20462 = 3.8555... rounds to 3.86

    def test_kg(self) -> None:
        assert _parse_hills_weight("3.86 kg") == 3.86

    def test_grams(self) -> None:
        assert _parse_hills_weight("354 g") == 0.354

    def test_ounces(self) -> None:
        result = _parse_hills_weight("12.5 oz")
        assert result is not None
        assert 0.35 < result < 0.36

    def test_pounds_variant(self) -> None:
        result = _parse_hills_weight("17.6 lb")
        assert result is not None
        assert result == 7.98  # 17.6 / 2.20462 = 7.9833... rounds to 7.98

    def test_unparseable(self) -> None:
        assert _parse_hills_weight("") is None
        assert _parse_hills_weight("one can") is None


class TestFindAccordionContent:
    """Test AEM accordion panel extraction."""

    def _make_accordion_html(self, heading: str, content: str) -> str:
        return f"""
        <div class="cmp-accordion">
            <div class="cmp-accordion__item">
                <h3 class="cmp-accordion__header">
                    <button class="cmp-accordion__button" aria-controls="panel-1">{heading}</button>
                </h3>
                <div id="panel-1" class="cmp-accordion__panel">{content}</div>
            </div>
        </div>
        """

    def test_finds_ingredients_panel(self) -> None:
        html = self._make_accordion_html("Ingredients", "<p>Chicken, Rice, Corn</p>")
        soup = BeautifulSoup(html, "lxml")
        result = _find_accordion_content(soup, "Ingredients")
        assert result is not None
        assert "Chicken, Rice, Corn" in result

    def test_finds_nutrient_panel(self) -> None:
        html = self._make_accordion_html(
            "Average Nutrient & Caloric Content",
            "<table><tr><td>Protein</td><td>28%</td></tr></table>",
        )
        soup = BeautifulSoup(html, "lxml")
        result = _find_accordion_content(soup, "Nutrient")
        assert result is not None
        assert "Protein" in result

    def test_no_match_returns_none(self) -> None:
        html = self._make_accordion_html("Key Features", "<p>Great food</p>")
        soup = BeautifulSoup(html, "lxml")
        assert _find_accordion_content(soup, "Ingredients") is None


class TestParseIngredients:
    def test_parses_from_accordion(self) -> None:
        html = """
        <div class="cmp-accordion">
            <div class="cmp-accordion__item">
                <h3><button class="cmp-accordion__button" aria-controls="p1">Ingredients</button></h3>
                <div id="p1" class="cmp-accordion__panel">
                    <div class="segment none">Chicken, Rice, Corn, Barley</div>
                </div>
            </div>
        </div>
        """
        soup = BeautifulSoup(html, "lxml")
        result = _parse_ingredients(soup)
        assert result == "Chicken, Rice, Corn, Barley"


class TestParseGa:
    def test_parses_hills_nutrient_table(self) -> None:
        html = """
        <div class="cmp-accordion">
            <div class="cmp-accordion__item">
                <h3><button class="cmp-accordion__button" aria-controls="p1">Average Nutrient & Caloric Content</button></h3>
                <div id="p1" class="cmp-accordion__panel">
                    <table><tbody>
                        <tr><td><b>Nutrient</b></td><td><b>Dry Matter %</b></td></tr>
                        <tr><td>Protein</td><td>28.5 %</td></tr>
                        <tr><td>Fat</td><td>15.0 %</td></tr>
                        <tr><td>Crude Fiber</td><td>4.2 %</td></tr>
                    </tbody></table>
                </div>
            </div>
        </div>
        """
        soup = BeautifulSoup(html, "lxml")
        ga = _parse_ga(soup)
        assert ga is not None
        assert ga["crude_protein_min"] == 28.5
        assert ga["crude_fat_min"] == 15.0
        assert ga["crude_fiber_max"] == 4.2


class TestIntegration:
    """Test full product parsing with realistic HTML fixtures."""

    def test_parse_product_minimal(self) -> None:
        """Test _parse_product with minimal valid HTML."""
        from scrapers.hills import _parse_product

        html = """
        <html><head>
        <script>
        window.dataLayer = [{"itemBrand":"pd","productForm":"dry","condition":"giDisorders","sku":"BK34100"}];
        </script>
        </head>
        <body>
        <h1>Prescription Diet i/d Digestive Care Chicken Dry Dog Food</h1>
        </body></html>
        """
        product = _parse_product("https://hillspet.ca/en-ca/dog-food/pd-id-chicken-dry", html)
        assert product is not None
        assert product["name"] == "Prescription Diet i/d Digestive Care Chicken Dry Dog Food"
        assert product["brand"] == "Hill's"
        assert product["channel"] == "vet"
        assert product["product_type"] == "dry"
        assert product["sub_brand"] == "Prescription Diet"
        assert "digestive_health" in product["health_tags"]
        assert product["source_id"] == "BK34100"

    def test_parse_product_retail(self) -> None:
        from scrapers.hills import _parse_product

        html = """
        <html><head>
        <script>
        window.dataLayer = [{"itemBrand":"sd","productForm":"treat"}];
        </script>
        </head>
        <body>
        <h1>Science Diet Soft Savories Peanut Butter & Banana Dog Treats</h1>
        </body></html>
        """
        product = _parse_product("https://hillspet.ca/en-ca/dog-food/sd-treat-peanut", html)
        assert product is not None
        assert product["channel"] == "retail"
        assert product["product_type"] == "treats"
        assert product["sub_brand"] == "Science Diet"

    def test_parse_product_no_h1_returns_none(self) -> None:
        from scrapers.hills import _parse_product

        html = "<html><body><p>No product here</p></body></html>"
        product = _parse_product("https://hillspet.ca/en-ca/dog-food/x", html)
        assert product is None


class TestCaUrlToUsUrl:
    """Test CA → US URL conversion."""

    def test_converts_standard_url(self) -> None:
        ca = "https://www.hillspet.ca/en-ca/dog-food/science-diet-adult-original-dry"
        us = _ca_url_to_us_url(ca)
        assert us == "https://www.hillspet.com/dog-food/science-diet-adult-original-dry"

    def test_converts_prescription_diet_url(self) -> None:
        ca = "https://www.hillspet.ca/en-ca/dog-food/prescription-diet-kd-kidney-care-canned"
        us = _ca_url_to_us_url(ca)
        assert us == "https://www.hillspet.com/dog-food/prescription-diet-kd-kidney-care-canned"

    def test_converts_treats_url(self) -> None:
        ca = "https://www.hillspet.ca/en-ca/dog-food/hills-grain-free-soft-baked-naturals-chicken-carrots-adult-treats"
        us = _ca_url_to_us_url(ca)
        assert us == "https://www.hillspet.com/dog-food/hills-grain-free-soft-baked-naturals-chicken-carrots-adult-treats"

    def test_returns_none_for_non_ca_url(self) -> None:
        assert _ca_url_to_us_url("https://www.hillspet.com/dog-food/something") is None

    def test_returns_none_for_empty_slug(self) -> None:
        assert _ca_url_to_us_url("https://www.hillspet.ca/en-ca/dog-food/") is None

    def test_returns_none_for_non_dog_food_url(self) -> None:
        assert _ca_url_to_us_url("https://www.hillspet.ca/en-ca/cat-food/something") is None


class TestSupplementFromUsSite:
    """Test US site fallback supplementation."""

    _panel_counter = 0

    def _make_accordion_html(self, heading: str, content: str) -> str:
        TestSupplementFromUsSite._panel_counter += 1
        pid = f"panel-{TestSupplementFromUsSite._panel_counter}"
        return f"""
        <div class="cmp-accordion__item">
            <h3><button class="cmp-accordion__button" aria-controls="{pid}">{heading}</button></h3>
            <div id="{pid}" class="cmp-accordion__panel">{content}</div>
        </div>
        """

    def _make_us_page_html(
        self,
        *,
        ingredients: str | None = None,
        calories: str | None = None,
        ga_rows: str | None = None,
    ) -> str:
        """Build a minimal US page HTML with optional accordion panels."""
        parts = ["<html><body>"]
        if ingredients:
            parts.append(self._make_accordion_html("Ingredients", f"<p>{ingredients}</p>"))
        nutrient_content = ""
        if calories:
            nutrient_content += f"<p>{calories}</p>"
        if ga_rows:
            nutrient_content += f"<table><tbody>{ga_rows}</tbody></table>"
        if nutrient_content:
            parts.append(
                self._make_accordion_html(
                    "Average Nutrient & Caloric Content", nutrient_content
                )
            )
        parts.append("</body></html>")
        return "\n".join(parts)

    def _mock_session(self, html: str, status_ok: bool = True) -> MagicMock:
        mock_resp = MagicMock()
        mock_resp.ok = status_ok
        mock_resp.text = html
        mock_resp.status_code = 200 if status_ok else 404
        session = MagicMock()
        session.get.return_value = mock_resp
        return session

    def test_supplements_missing_calories(self) -> None:
        html = self._make_us_page_html(calories="3495 kcal/kg, 347 kcal/cup")
        session = self._mock_session(html)
        product = {
            "name": "Test Food",
            "brand": "Hill's",
            "url": "https://www.hillspet.ca/en-ca/dog-food/test-dry",
            "channel": "retail",
            "product_type": "dry",
        }
        result = _supplement_from_us_site(product, session)
        assert result is True
        assert "calorie_content" in product
        assert "3495 kcal/kg" in product["calorie_content"]

    def test_supplements_missing_ingredients(self) -> None:
        html = self._make_us_page_html(ingredients="Chicken, Rice, Corn, Barley, Oats")
        session = self._mock_session(html)
        product = {
            "name": "Test Food",
            "brand": "Hill's",
            "url": "https://www.hillspet.ca/en-ca/dog-food/test-dry",
            "channel": "retail",
            "product_type": "dry",
        }
        result = _supplement_from_us_site(product, session)
        assert result is True
        assert product["ingredients_raw"] == "Chicken, Rice, Corn, Barley, Oats"

    def test_supplements_missing_ga(self) -> None:
        ga_rows = """
        <tr><td>Protein</td><td>25.0 %</td></tr>
        <tr><td>Fat</td><td>15.0 %</td></tr>
        """
        html = self._make_us_page_html(ga_rows=ga_rows)
        session = self._mock_session(html)
        product = {
            "name": "Test Food",
            "brand": "Hill's",
            "url": "https://www.hillspet.ca/en-ca/dog-food/test-dry",
            "channel": "retail",
            "product_type": "dry",
        }
        result = _supplement_from_us_site(product, session)
        assert result is True
        assert "guaranteed_analysis" in product
        assert product["guaranteed_analysis"]["crude_protein_min"] == 25.0
        assert product["guaranteed_analysis_basis"] == "dry-matter"

    def test_skips_when_all_fields_present(self) -> None:
        session = MagicMock()
        product = {
            "name": "Test Food",
            "brand": "Hill's",
            "url": "https://www.hillspet.ca/en-ca/dog-food/test-dry",
            "channel": "retail",
            "product_type": "dry",
            "calorie_content": "3495 kcal/kg, 347 kcal/cup",
            "ingredients_raw": "Chicken, Rice",
            "guaranteed_analysis": {"crude_protein_min": 25.0},
        }
        result = _supplement_from_us_site(product, session)
        assert result is False
        session.get.assert_not_called()

    def test_handles_us_404(self) -> None:
        session = self._mock_session("", status_ok=False)
        product = {
            "name": "Test Food",
            "brand": "Hill's",
            "url": "https://www.hillspet.ca/en-ca/dog-food/test-dry",
            "channel": "retail",
            "product_type": "dry",
        }
        result = _supplement_from_us_site(product, session)
        assert result is False
        assert "calorie_content" not in product

    def test_does_not_overwrite_existing_fields(self) -> None:
        """Only fills missing fields, never overwrites existing ones."""
        html = self._make_us_page_html(
            ingredients="US Chicken, US Rice",
            calories="9999 kcal/kg, 999 kcal/cup",
        )
        session = self._mock_session(html)
        product = {
            "name": "Test Food",
            "brand": "Hill's",
            "url": "https://www.hillspet.ca/en-ca/dog-food/test-dry",
            "channel": "retail",
            "product_type": "dry",
            "ingredients_raw": "CA Chicken, CA Rice",  # already present
            # calorie_content is missing — should be supplemented
        }
        result = _supplement_from_us_site(product, session)
        assert result is True
        # Ingredients should NOT be overwritten
        assert product["ingredients_raw"] == "CA Chicken, CA Rice"
        # Calories should be filled from US
        assert "calorie_content" in product


