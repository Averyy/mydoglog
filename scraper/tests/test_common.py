"""Tests for scrapers.common — shared utilities."""

import json
from pathlib import Path

from scrapers.common import (
    chewy_ingredients_match,
    clean_text,
    normalize_calorie_content,
    parse_chewy_nutrition,
    parse_ga_html_table,
    write_brand_json,
)


class TestCleanText:
    def test_strips_control_chars(self) -> None:
        assert clean_text("hello\x00world") == "helloworld"
        assert clean_text("test\x01\x02\x03data") == "testdata"

    def test_preserves_tab_newline_cr(self) -> None:
        assert clean_text("hello\tworld") == "hello world"
        assert clean_text("line1\nline2") == "line1 line2"

    def test_purina_hex_artifacts(self) -> None:
        # _x001F_ is a control char, should be stripped
        assert clean_text("chicken_x001F_meal") == "chickenmeal"
        # _x0041_ is 'A', should be preserved
        assert clean_text("_x0041_pple") == "Apple"

    def test_normalizes_whitespace(self) -> None:
        assert clean_text("  too   many   spaces  ") == "too many spaces"
        assert clean_text("tabs\t\tand  spaces") == "tabs and spaces"

    def test_collapses_blank_lines(self) -> None:
        assert clean_text("line1\n\n\nline2") == "line1 line2"

    def test_empty_string(self) -> None:
        assert clean_text("") == ""
        assert clean_text("   ") == ""


class TestParseGaHtmlTable:
    def test_two_column_table(self) -> None:
        html = """
        <table>
            <tr><td>Crude Protein (min)</td><td>26.0%</td></tr>
            <tr><td>Crude Fat (min)</td><td>16.0%</td></tr>
            <tr><td>Crude Fiber (max)</td><td>4.0%</td></tr>
            <tr><td>Moisture (max)</td><td>10.0%</td></tr>
        </table>
        """
        ga = parse_ga_html_table(html)
        assert ga["crude_protein_min"] == 26.0
        assert ga["crude_fat_min"] == 16.0
        assert ga["crude_fiber_max"] == 4.0
        assert ga["moisture_max"] == 10.0

    def test_without_percentage_sign(self) -> None:
        html = """
        <table>
            <tr><td>Crude Protein (min)</td><td>30</td></tr>
            <tr><td>Crude Fat (min)</td><td>18</td></tr>
        </table>
        """
        ga = parse_ga_html_table(html)
        assert ga["crude_protein_min"] == 30.0
        assert ga["crude_fat_min"] == 18.0

    def test_omega_and_special_nutrients(self) -> None:
        html = """
        <table>
            <tr><td>Omega-6 Fatty Acids (min)</td><td>3.5%</td></tr>
            <tr><td>Omega-3 Fatty Acids (min)</td><td>0.5%</td></tr>
            <tr><td>Glucosamine (min)</td><td>400</td></tr>
            <tr><td>DHA (min)</td><td>0.05%</td></tr>
        </table>
        """
        ga = parse_ga_html_table(html)
        assert ga["omega_6_min"] == 3.5
        assert ga["omega_3_min"] == 0.5
        assert ga["glucosamine_min"] == 400.0
        assert ga["dha_min"] == 0.05

    def test_empty_table_returns_empty(self) -> None:
        html = "<table><tr><td>No data</td></tr></table>"
        ga = parse_ga_html_table(html)
        assert ga == {}

    def test_min_max_in_label(self) -> None:
        html = """
        <table>
            <tr><td>Calcium min</td><td>1.0%</td></tr>
            <tr><td>Calcium max</td><td>1.5%</td></tr>
        </table>
        """
        ga = parse_ga_html_table(html)
        assert ga["calcium_min"] == 1.0
        assert ga["calcium_max"] == 1.5


class TestNormalizeCalorieContent:
    def test_standard_format(self) -> None:
        result = normalize_calorie_content("3,456 kcal ME/kg; 345 kcal ME/cup")
        assert result == "3456 kcal/kg, 345 kcal/cup"

    def test_verbose_format(self) -> None:
        result = normalize_calorie_content(
            "This food contains 3,456 kcal of metabolizable energy (ME) "
            "per kilogram or 345 kcal ME per cup"
        )
        assert result == "3456 kcal/kg, 345 kcal/cup"

    def test_kg_only(self) -> None:
        result = normalize_calorie_content("3800 kcal/kg")
        assert result == "3800 kcal/kg"

    def test_cup_only(self) -> None:
        result = normalize_calorie_content("350 kcal per standard cup")
        assert result == "350 kcal/cup"

    def test_pouch_serving(self) -> None:
        result = normalize_calorie_content("2723 kcal/kg 463 kcal/pouch")
        assert result == "2723 kcal/kg, 463 kcal/pouch"

    def test_can_serving(self) -> None:
        result = normalize_calorie_content("866 kcal/kg 319 kcal/can")
        assert result == "866 kcal/kg, 319 kcal/can"

    def test_empty_returns_none(self) -> None:
        assert normalize_calorie_content("") is None

    def test_unparseable_returns_stripped(self) -> None:
        result = normalize_calorie_content("  some random text  ")
        assert result == "some random text"

    def test_treat_serving(self) -> None:
        result = normalize_calorie_content("3,200 kcal/kg, 38 kcal/treat")
        assert result == "3200 kcal/kg, 38 kcal/treat"

    def test_piece_normalized_to_treat(self) -> None:
        result = normalize_calorie_content("2,996 kcal ME/kg; 86 kcal ME/piece")
        assert result == "2996 kcal/kg, 86 kcal/treat"

    def test_bar_normalized_to_treat(self) -> None:
        result = normalize_calorie_content("3,465 kcal/kg, One Bar = 70 kcal")
        assert result == "3465 kcal/kg, 70 kcal/treat"

    def test_bit_normalized_to_treat(self) -> None:
        result = normalize_calorie_content("3,050 kcal/kg, 4 kcal/bit")
        assert result == "3050 kcal/kg, 4 kcal/treat"

    def test_stix_normalized_to_treat(self) -> None:
        result = normalize_calorie_content("3,200 kcals/kg, 38 kcals/stix")
        assert result == "3200 kcal/kg, 38 kcal/treat"

    def test_bone_normalized_to_treat(self) -> None:
        result = normalize_calorie_content("2,580 kcal ME/kg, 65 kcal ME/bone")
        assert result == "2580 kcal/kg, 65 kcal/treat"

    def test_biscuit_normalized_to_treat(self) -> None:
        result = normalize_calorie_content("3,400 kcal/kg, 50 kcal/biscuit")
        assert result == "3400 kcal/kg, 50 kcal/treat"

    def test_box_serving(self) -> None:
        result = normalize_calorie_content("1030 kcal/kg, 365 kcal/box")
        assert result == "1030 kcal/kg, 365 kcal/box"


class TestWriteBrandJson:
    def test_writes_envelope(self, tmp_path: Path) -> None:
        products = [
            {
                "name": "Test Product",
                "brand": "Test Brand",
                "url": "https://example.com/test",
                "channel": "retail",
                "product_type": "dry",
            }
        ]
        write_brand_json("Test Brand", "https://example.com", products, tmp_path, slug="test")

        output = tmp_path / "test.json"
        assert output.exists()

        data = json.loads(output.read_text())
        assert data["brand"] == "Test Brand"
        assert data["website_url"] == "https://example.com"
        assert data["scraper_version"] == "0.1.0"
        assert "scraped_at" in data
        assert data["stats"]["product_count"] == 1
        assert data["stats"]["by_channel"] == {"retail": 1}
        assert data["stats"]["by_type"] == {"dry": 1}
        assert len(data["products"]) == 1
        assert data["products"][0]["name"] == "Test Product"

    def test_stats_counts(self, tmp_path: Path) -> None:
        products = [
            {"name": "A", "brand": "B", "url": "u", "channel": "retail", "product_type": "dry"},
            {"name": "B", "brand": "B", "url": "u", "channel": "vet", "product_type": "dry"},
            {"name": "C", "brand": "B", "url": "u", "channel": "vet", "product_type": "wet"},
        ]
        write_brand_json("B", "u", products, tmp_path, slug="stats")

        data = json.loads((tmp_path / "stats.json").read_text())
        assert data["stats"]["product_count"] == 3
        assert data["stats"]["by_channel"] == {"retail": 1, "vet": 2}
        assert data["stats"]["by_type"] == {"dry": 2, "wet": 1}

    def test_slug_from_brand_name(self, tmp_path: Path) -> None:
        write_brand_json("Hill's", "u", [], tmp_path)
        assert (tmp_path / "hills.json").exists()


class TestParseChewyNutrition:
    def test_wet_food(self) -> None:
        """Parse a Chewy wet food page with calorie, GA, and ingredients."""
        html = """
        <html><body>
        <div id="CALORIC_CONTENT-section">
            <p>305 kcal/can</p>
        </div>
        <div id="GUARANTEED_ANALYSIS-section">
            <table>
                <tr><td>Crude Protein (min)</td><td>8.0%</td></tr>
                <tr><td>Crude Fat (min)</td><td>5.5%</td></tr>
                <tr><td>Crude Fiber (max)</td><td>1.5%</td></tr>
                <tr><td>Moisture (max)</td><td>78.0%</td></tr>
            </table>
        </div>
        <div id="INGREDIENTS-section">
            <p>Water, Chicken, Chicken Liver, Rice, Corn Starch</p>
        </div>
        </body></html>
        """
        result = parse_chewy_nutrition(html)
        assert result["calorie_content"] == "305 kcal/can"
        assert result["guaranteed_analysis"]["crude_protein_min"] == 8.0
        assert result["guaranteed_analysis"]["crude_fat_min"] == 5.5
        assert result["guaranteed_analysis"]["crude_fiber_max"] == 1.5
        assert result["guaranteed_analysis"]["moisture_max"] == 78.0
        assert "Chicken" in result["ingredients"]

    def test_treat(self) -> None:
        """Parse a Chewy treat page with kcal/kg and kcal/piece format."""
        html = """
        <html><body>
        <div id="CALORIC_CONTENT-section">
            <p>3,290 kcal/kg, 35 kcal/piece</p>
        </div>
        <div id="INGREDIENTS-section">
            <p>Chicken, Glycerin, Rice Flour, Dried Plain Beet Pulp, Flaxseed</p>
        </div>
        </body></html>
        """
        result = parse_chewy_nutrition(html)
        assert result["calorie_content"] is not None
        assert "3290 kcal/kg" in result["calorie_content"]
        assert "35 kcal/treat" in result["calorie_content"]
        assert result["guaranteed_analysis"] is None

    def test_missing_sections(self) -> None:
        """Empty HTML returns all None."""
        result = parse_chewy_nutrition("<html><body></body></html>")
        assert result["calorie_content"] is None
        assert result["guaranteed_analysis"] is None
        assert result["ingredients"] is None


class TestChewyIngredientsMatch:
    def test_identical(self) -> None:
        """Exact match returns True."""
        ours = "Chicken, Brown Rice, Barley, Oatmeal, Chicken Meal"
        chewy = "Chicken, Brown Rice, Barley, Oatmeal, Chicken Meal"
        assert chewy_ingredients_match(ours, chewy) is True

    def test_ca_us_spelling(self) -> None:
        """'Flavour' vs 'Flavor' and 'Fibre' vs 'Fiber' returns True."""
        ours = "Chicken, Natural Flavour, Crude Fibre, Rice, Oatmeal"
        chewy = "Chicken, Natural Flavor, Crude Fiber, Rice, Oatmeal"
        assert chewy_ingredients_match(ours, chewy) is True

    def test_mismatch(self) -> None:
        """Different ingredient order returns False."""
        ours = "Chicken, Brown Rice, Barley, Oatmeal, Chicken Meal"
        chewy = "Brown Rice, Chicken, Barley, Oatmeal, Chicken Meal"
        assert chewy_ingredients_match(ours, chewy) is False

    def test_too_few_ingredients(self) -> None:
        """Gracefully handles lists shorter than n."""
        ours = "Chicken, Rice"
        chewy = "Chicken, Rice"
        assert chewy_ingredients_match(ours, chewy, n=5) is True

    def test_empty_returns_false(self) -> None:
        """Empty ingredients return False."""
        assert chewy_ingredients_match("", "Chicken, Rice") is False
        assert chewy_ingredients_match("Chicken", "") is False

    def test_singular_plural(self) -> None:
        """Potato vs Potatoes should match."""
        ours = "Chicken, Potatoes, Peas, Chicken Fat, Tomato Pomace"
        chewy = "Chicken, Potato, Peas, Chicken Fat, Tomato Pomace"
        assert chewy_ingredients_match(ours, chewy) is True
