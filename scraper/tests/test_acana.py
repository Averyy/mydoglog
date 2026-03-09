"""Tests for scrapers.acana — Acana + Orijen parsing logic."""

from bs4 import BeautifulSoup

from unittest.mock import MagicMock

from scrapers.acana import (
    _detect_sub_brand,
    _parse_calorie_content,
    _parse_ga,
    _parse_images,
    _parse_ingredients,
    _parse_product,
)


def _make_page_html(
    *,
    h1: str = "ACANA Classics Prairie Poultry",
    ingredients: str = "Chicken, oats, barley",
    ga_table: str = "",
    calorie_text: str = "",
    og_image: str = "",
) -> str:
    """Build a realistic retailer (homesalive.ca) product page fixture."""
    parts = [f"<h1>{h1}</h1>"]

    if ingredients:
        parts.append(
            f'<h3>Ingredients</h3><div><p>{ingredients}</p></div>'
        )

    if ga_table:
        parts.append(ga_table)

    if calorie_text:
        parts.append(f"<p>{calorie_text}</p>")

    if og_image:
        parts.append(f'<meta property="og:image" content="{og_image}">')

    return f"<html><head></head><body>{''.join(parts)}</body></html>"


_GA_TABLE = """<table>
<tr><td>Crude Protein (min.)</td><td>31.0%</td></tr>
<tr><td>Crude Fat (min.)</td><td>17.0%</td></tr>
<tr><td>Crude Fiber (max.)</td><td>6.0%</td></tr>
<tr><td>Moisture (max.)</td><td>12.0%</td></tr>
</table>"""


# --- _parse_ingredients ---


class TestParseIngredients:
    def test_ingredients_tab_div(self):
        html = _make_page_html(ingredients="Chicken, chicken meal, oats, peas")
        soup = BeautifulSoup(html, "lxml")
        result = _parse_ingredients(soup)
        assert result is not None
        assert "Chicken" in result
        assert "chicken meal" in result

    def test_no_ingredients(self):
        html = "<html><body><h1>Test</h1></body></html>"
        soup = BeautifulSoup(html, "lxml")
        assert _parse_ingredients(soup) is None

    def test_heading_fallback(self):
        html = """<html><body>
        <h3>Ingredients</h3>
        <p>Deboned chicken, chicken meal, turkey meal, red lentils, green peas</p>
        </body></html>"""
        soup = BeautifulSoup(html, "lxml")
        result = _parse_ingredients(soup)
        assert result is not None
        assert "Deboned chicken" in result

    def test_rejects_short_text(self):
        """Short text should be rejected."""
        html = """<html><body>
        <div id="ingredients" data-role="content"><p>Just salt</p></div>
        </body></html>"""
        soup = BeautifulSoup(html, "lxml")
        assert _parse_ingredients(soup) is None


# --- _parse_ga ---


class TestParseGa:
    def test_standard_table(self):
        html = _make_page_html(ga_table=_GA_TABLE)
        soup = BeautifulSoup(html, "lxml")
        result = _parse_ga(soup)
        assert result is not None
        assert result["crude_protein_min"] == 31.0
        assert result["crude_fat_min"] == 17.0
        assert result["crude_fiber_max"] == 6.0
        assert result["moisture_max"] == 12.0

    def test_no_table(self):
        html = "<html><body><h1>Test</h1></body></html>"
        soup = BeautifulSoup(html, "lxml")
        assert _parse_ga(soup) is None


# --- _parse_calorie_content ---


class TestParseCalorieContent:
    def test_standard_format(self):
        html = _make_page_html(
            calorie_text="3,493 kcal/kg, 419 kcal/cup"
        )
        soup = BeautifulSoup(html, "lxml")
        result = _parse_calorie_content(soup)
        assert result is not None
        assert "3493 kcal/kg" in result
        assert "419 kcal/cup" in result

    def test_weight_prefix_cup(self):
        html = _make_page_html(
            calorie_text="3,790 kcal/kg, 455 kcal/ 120g cup"
        )
        soup = BeautifulSoup(html, "lxml")
        result = _parse_calorie_content(soup)
        assert result is not None
        assert "kcal/kg" in result

    def test_cal_not_kcal(self):
        html = _make_page_html(
            calorie_text="1,069 kcal/kg, 388 cal/can"
        )
        soup = BeautifulSoup(html, "lxml")
        result = _parse_calorie_content(soup)
        assert result is not None

    def test_no_calorie(self):
        html = "<html><body><h1>Test</h1></body></html>"
        soup = BeautifulSoup(html, "lxml")
        assert _parse_calorie_content(soup) is None


# --- _detect_sub_brand ---


class TestDetectSubBrand:
    def test_acana_singles(self):
        assert _detect_sub_brand("ACANA Singles Lamb & Apple", "acana") == "Singles"

    def test_acana_healthy_grains(self):
        assert (
            _detect_sub_brand("ACANA Healthy Grains Ranch-Raised Beef", "acana")
            == "Healthy Grains"
        )

    def test_orijen_amazing_grains(self):
        assert (
            _detect_sub_brand("ORIJEN Amazing Grains Original", "orijen")
            == "Amazing Grains"
        )

    def test_orijen_freeze_dried(self):
        assert (
            _detect_sub_brand("ORIJEN Freeze-Dried Original", "orijen")
            == "Freeze-Dried"
        )

    def test_no_sub_brand(self):
        assert _detect_sub_brand("ACANA Wild Prairie Dog Food", "acana") is None

    def test_orijen_no_sub_brand(self):
        assert _detect_sub_brand("ORIJEN Original Dog Food", "orijen") is None


# --- _parse_product (integration) ---


class TestParseProduct:
    def test_full_product(self):
        html = _make_page_html(
            h1="ACANA Classics Prairie Poultry",
            ingredients="Chicken, chicken meal, turkey meal, red lentils, green peas, chicken fat",
            ga_table=_GA_TABLE,
            calorie_text="3,493 kcal/kg, 419 kcal/cup",
            og_image="https://example.com/product.jpg",
        )
        result = _parse_product("https://homesalive.ca/acana-classics-prairie-poultry", html, "acana", MagicMock(), "https://www.acana.com")
        assert result is not None
        assert result["name"] == "Classics Prairie Poultry"
        assert result["brand"] == "Acana"
        assert result["channel"] == "retail"
        assert result["product_type"] == "food"
        assert "ingredients_raw" in result
        assert "guaranteed_analysis" in result
        assert "calorie_content" in result
        assert "images" in result

    def test_wet_product_type(self):
        html = _make_page_html(h1="ACANA Premium Chunks Chicken in Bone Broth")
        result = _parse_product("https://homesalive.ca/acana-chunks", html, "acana", MagicMock(), "https://www.acana.com")
        assert result is not None
        assert result["product_type"] == "food"

    def test_wet_type_can_word_boundary(self):
        """Ensure 'can' in 'acana' does not trigger wet type detection."""
        html = _make_page_html(h1="ACANA Classics Prairie Poultry")
        result = _parse_product("https://homesalive.ca/acana-classics", html, "acana", MagicMock(), "https://www.acana.com")
        assert result is not None
        assert result["product_type"] == "food"

    def test_no_h1_returns_none(self):
        html = "<html><body><p>No heading</p></body></html>"
        assert _parse_product("https://example.com", html, "acana", MagicMock(), "https://www.acana.com") is None

    def test_orijen_brand(self):
        html = _make_page_html(h1="ORIJEN Original Dog Food")
        result = _parse_product("https://homesalive.ca/orijen-original", html, "orijen", MagicMock(), "https://www.orijenpetfoods.com")
        assert result is not None
        assert result["brand"] == "Orijen"
