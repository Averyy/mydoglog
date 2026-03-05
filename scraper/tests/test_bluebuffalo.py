"""Tests for scrapers.bluebuffalo — Blue Buffalo parsing logic."""

from unittest.mock import MagicMock

from bs4 import BeautifulSoup

from scrapers.bluebuffalo import (
    _BB_CHEWY_SKIP_KEYWORDS,
    _build_bb_chewy_query,
    _build_product_name,
    _detect_product_type,
    _detect_sub_brand,
    _extract_js_template,
    _extract_name_qualifier,
    _fill_missing_from_chewy,
    _parse_aafco_statement,
    _parse_calorie_content,
    _parse_ga,
    _parse_life_stage,
    _parse_product,
)


def _make_page_html(
    *,
    h1: str = "Life Protection Formula",
    h3_recipe: str = "Chicken and Brown Rice Recipe",
    hero_flag: str = "Adult Dog",
    ga_html: str = "",
    feeding_html: str = "",
    ingredients_json: str = "",
    extra_body: str = "",
) -> str:
    """Build a realistic Blue Buffalo product page HTML fixture."""
    body_parts = []

    # Hero section
    body_parts.append(f"""
    <div class="Hero">
        <h1>{h1}</h1>
        <div class="Hero-flag">{hero_flag}</div>
        <div class="Hero-info">
            <h3>{h3_recipe}</h3>
        </div>
    </div>
    """)

    # Script with JS template literals
    script_parts = []
    if ingredients_json:
        script_parts.append(f"ingredientsJson = {ingredients_json};")
    if ga_html:
        script_parts.append(f"window.guaranteedAnalysisHtml = `{ga_html}`")
    if feeding_html:
        script_parts.append(f"window.feedingGuidelinesHtml = `{feeding_html}`")
    if script_parts:
        body_parts.append(f"<script>{'  '.join(script_parts)}</script>")

    if extra_body:
        body_parts.append(extra_body)

    return f"<html><body>{''.join(body_parts)}</body></html>"


# --- Fixtures for GA and feeding HTML ---

_GA_TABLE_HTML = """
<div class="wrapper">
    <h2>Guaranteed Analysis</h2>
    <p>BLUE Life Protection Formula is formulated to meet the nutritional levels
    established by the AAFCO Dog Food Nutrient Profiles for maintenance.</p>
    <table>
        <tr class="sronly"><th>Ingredient</th><th>Percentage</th></tr>
        <tr role="row"><th role="cell" class="as-td">Crude Protein</th><td role="cell">24.0% min</td></tr>
        <tr role="row"><th role="cell" class="as-td">Crude Fat</th><td role="cell">14.0% min</td></tr>
        <tr role="row"><th role="cell" class="as-td">Crude Fibre</th><td role="cell">5.0% max</td></tr>
        <tr role="row"><th role="cell" class="as-td">Moisture</th><td role="cell">10.0% max</td></tr>
        <tr role="row"><th role="cell" class="as-td">Omega 3 Fatty Acids*</th><td role="cell">0.5% min</td></tr>
    </table>
    <p>*Not recognized as an essential nutrient by the AAFCO Dog Food Nutrient Profiles.</p>
</div>
"""

_FEEDING_HTML = """
<div class="wrapper">
    <div class="FeedingChart">
        <div class="FeedingChart-row">
            <span>4.5 - 9.1 kg</span>
            <span>130 - 195</span>
        </div>
    </div>
    <p><strong>Calorie Content:</strong> 3,613 Kcals/kg, 377 Kcals/cup</p>
</div>
"""

_FEEDING_HTML_CAN = """
<div class="wrapper">
    <p><strong>Calorie Content:</strong> 1,350 Kcals/kg, 478 Kcals/can</p>
</div>
"""


class TestExtractJsTemplate:
    def test_extracts_template_literal(self) -> None:
        html = "window.guaranteedAnalysisHtml = `<div>GA content</div>`"
        result = _extract_js_template(html, "guaranteedAnalysisHtml")
        assert result == "<div>GA content</div>"

    def test_extracts_multiline_template(self) -> None:
        html = "window.feedingGuidelinesHtml = `\n<div>\n  content\n</div>\n`"
        result = _extract_js_template(html, "feedingGuidelinesHtml")
        assert result is not None
        assert "<div>" in result

    def test_no_match_returns_none(self) -> None:
        html = "<script>var x = 1;</script>"
        assert _extract_js_template(html, "guaranteedAnalysisHtml") is None

    def test_wrong_var_name_returns_none(self) -> None:
        html = "window.feedingGuidelinesHtml = `<div>content</div>`"
        assert _extract_js_template(html, "guaranteedAnalysisHtml") is None


class TestBuildProductName:
    def test_combines_h1_and_h3(self) -> None:
        html = _make_page_html()
        soup = BeautifulSoup(html, "lxml")
        name = _build_product_name(soup)
        assert name == "Life Protection Formula Chicken and Brown Rice Recipe"

    def test_includes_qualifier_for_large_breed(self) -> None:
        html = _make_page_html(hero_flag="Large Breed Adult Dog")
        soup = BeautifulSoup(html, "lxml")
        name = _build_product_name(soup)
        assert name == "Life Protection Formula Large Breed Adult Dog Chicken and Brown Rice Recipe"

    def test_includes_qualifier_for_puppy(self) -> None:
        html = _make_page_html(hero_flag="Puppy")
        soup = BeautifulSoup(html, "lxml")
        name = _build_product_name(soup)
        assert name == "Life Protection Formula Puppy Chicken and Brown Rice Recipe"

    def test_no_qualifier_for_adult_dog(self) -> None:
        html = _make_page_html(hero_flag="Adult Dog")
        soup = BeautifulSoup(html, "lxml")
        name = _build_product_name(soup)
        # "Adult Dog" is the default — should not appear in the name
        assert "Adult Dog" not in name
        assert name == "Life Protection Formula Chicken and Brown Rice Recipe"

    def test_no_h1_returns_none(self) -> None:
        html = "<html><body><p>No product</p></body></html>"
        soup = BeautifulSoup(html, "lxml")
        assert _build_product_name(soup) is None

    def test_h1_only_no_h3(self) -> None:
        html = """<html><body><h1>BLUE Wilderness</h1></body></html>"""
        soup = BeautifulSoup(html, "lxml")
        name = _build_product_name(soup)
        assert name == "BLUE Wilderness"

    def test_treat_qualifier_included(self) -> None:
        html = _make_page_html(
            h1="BLUE True Chews",
            h3_recipe="Made with Real Chicken",
            hero_flag="Premium Jerky Cuts",
        )
        soup = BeautifulSoup(html, "lxml")
        name = _build_product_name(soup)
        assert name == "BLUE True Chews Premium Jerky Cuts Made with Real Chicken"


class TestExtractNameQualifier:
    def test_adult_dog_returns_none(self) -> None:
        html = _make_page_html(hero_flag="Adult Dog")
        soup = BeautifulSoup(html, "lxml")
        assert _extract_name_qualifier(soup) is None

    def test_adult_returns_none(self) -> None:
        html = _make_page_html(hero_flag="Adult")
        soup = BeautifulSoup(html, "lxml")
        assert _extract_name_qualifier(soup) is None

    def test_large_breed_adult(self) -> None:
        html = _make_page_html(hero_flag="Large Breed Adult Dog")
        soup = BeautifulSoup(html, "lxml")
        assert _extract_name_qualifier(soup) == "Large Breed Adult Dog"

    def test_puppy(self) -> None:
        html = _make_page_html(hero_flag="Puppy")
        soup = BeautifulSoup(html, "lxml")
        assert _extract_name_qualifier(soup) == "Puppy"

    def test_senior_dog(self) -> None:
        html = _make_page_html(hero_flag="Senior Dog")
        soup = BeautifulSoup(html, "lxml")
        assert _extract_name_qualifier(soup) == "Senior Dog"

    def test_no_hero_flag_returns_none(self) -> None:
        html = "<html><body><h1>Test</h1></body></html>"
        soup = BeautifulSoup(html, "lxml")
        assert _extract_name_qualifier(soup) is None


class TestParseLifeStage:
    def test_adult(self) -> None:
        html = _make_page_html(hero_flag="Adult Dog")
        soup = BeautifulSoup(html, "lxml")
        assert _parse_life_stage(soup) == "adult"

    def test_puppy(self) -> None:
        html = _make_page_html(hero_flag="Large Breed Puppy")
        soup = BeautifulSoup(html, "lxml")
        assert _parse_life_stage(soup) == "puppy"

    def test_senior(self) -> None:
        html = _make_page_html(hero_flag="Senior Dog")
        soup = BeautifulSoup(html, "lxml")
        assert _parse_life_stage(soup) == "senior"

    def test_no_flag_returns_none(self) -> None:
        html = "<html><body><h1>Test</h1></body></html>"
        soup = BeautifulSoup(html, "lxml")
        assert _parse_life_stage(soup) is None


class TestParseGa:
    def test_extracts_ga_from_js_template(self) -> None:
        html = _make_page_html(ga_html=_GA_TABLE_HTML)
        ga = _parse_ga(html)
        assert ga is not None
        assert ga["crude_protein_min"] == 24.0
        assert ga["crude_fat_min"] == 14.0
        assert ga["crude_fiber_max"] == 5.0
        assert ga["moisture_max"] == 10.0
        assert ga["omega_3_min"] == 0.5

    def test_no_ga_template_returns_none(self) -> None:
        html = _make_page_html()
        assert _parse_ga(html) is None

    def test_empty_ga_template_returns_none(self) -> None:
        html = "window.guaranteedAnalysisHtml = `<div>No table here</div>`"
        assert _parse_ga(html) is None


class TestParseAafcoStatement:
    def test_extracts_aafco_from_ga_template(self) -> None:
        html = _make_page_html(ga_html=_GA_TABLE_HTML)
        aafco = _parse_aafco_statement(html)
        assert aafco is not None
        assert "AAFCO" in aafco
        assert "formulated" in aafco.lower()

    def test_no_ga_template_returns_none(self) -> None:
        html = _make_page_html()
        assert _parse_aafco_statement(html) is None

    def test_ga_without_aafco_returns_none(self) -> None:
        ga_html = "<div><table><tr><td>Crude Protein</td><td>24%</td></tr></table></div>"
        html = f"window.guaranteedAnalysisHtml = `{ga_html}`"
        assert _parse_aafco_statement(html) is None


class TestParseCalorieContent:
    def test_extracts_kcal_per_cup(self) -> None:
        html = _make_page_html(feeding_html=_FEEDING_HTML)
        cal = _parse_calorie_content(html)
        assert cal is not None
        assert "3613 kcal/kg" in cal
        assert "377 kcal/cup" in cal

    def test_extracts_kcal_per_can(self) -> None:
        html = _make_page_html(feeding_html=_FEEDING_HTML_CAN)
        cal = _parse_calorie_content(html)
        assert cal is not None
        assert "1350 kcal/kg" in cal
        assert "478 kcal/can" in cal

    def test_no_feeding_template_returns_none(self) -> None:
        html = _make_page_html()
        assert _parse_calorie_content(html) is None


class TestDetectSubBrand:
    def test_wilderness(self) -> None:
        assert _detect_sub_brand("BLUE Wilderness", "/wilderness/") == "Wilderness"

    def test_life_protection(self) -> None:
        assert _detect_sub_brand("Life Protection Formula", "/life-protection-formula/") == "Life Protection"

    def test_basics(self) -> None:
        assert _detect_sub_brand("BLUE Basics", "/basics/") == "Basics"

    def test_freedom(self) -> None:
        assert _detect_sub_brand("BLUE Freedom", "/freedom/") == "Freedom"

    def test_true_solutions(self) -> None:
        assert _detect_sub_brand("BLUE True Solutions", "/true-solutions/") == "True Solutions"

    def test_unknown_returns_none(self) -> None:
        assert _detect_sub_brand("BLUE Something", "/something/") is None


class TestDetectProductType:
    def test_dry_from_url(self) -> None:
        assert _detect_product_type("/en-ca/dry-dog-food/lpf/chicken", "Chicken Recipe") == "dry"

    def test_wet_from_url(self) -> None:
        assert _detect_product_type("/en-ca/wet-dog-food/basics/turkey", "Turkey Recipe") == "wet"

    def test_treats_from_url(self) -> None:
        assert _detect_product_type("/en-ca/dog-treats/blue/bacon-stix", "Bacon Stix") == "treats"

    def test_stew_is_wet(self) -> None:
        assert _detect_product_type("/en-ca/wet-dog-food/x/stew", "Wolf Creek Stew") == "wet"


class TestParseProductIntegration:
    def test_full_dry_product(self) -> None:
        html = _make_page_html(
            h1="Life Protection Formula",
            h3_recipe="Chicken and Brown Rice Recipe",
            hero_flag="Adult Dog",
            ga_html=_GA_TABLE_HTML,
            feeding_html=_FEEDING_HTML,
            ingredients_json='{"ingredients":[{"name":"Chicken"},{"name":"Brown Rice"}]}',
        )
        url = "https://www.bluebuffalo.com/en-ca/dry-dog-food/life-protection-formula/chicken-brown-rice-recipe"
        product = _parse_product(url, html)

        assert product is not None
        assert product["name"] == "Life Protection Formula Chicken and Brown Rice Recipe"
        assert product["brand"] == "Blue Buffalo"
        assert product["product_type"] == "dry"
        assert product["channel"] == "retail"
        assert product["sub_brand"] == "Life Protection"
        assert product["life_stage"] == "adult"
        assert "Chicken" in product["ingredients_raw"]
        assert product["guaranteed_analysis"]["crude_protein_min"] == 24.0
        assert "3613 kcal/kg" in product["calorie_content"]
        assert "AAFCO" in product["aafco_statement"]

    def test_wet_product_has_wet_food_suffix(self) -> None:
        html = _make_page_html(
            h1="BLUE Basics",
            h3_recipe="Grain-Free Turkey and Potato Recipe",
            hero_flag="Adult Dog",
        )
        url = "https://www.bluebuffalo.com/en-ca/wet-dog-food/basics/turkey"
        product = _parse_product(url, html)
        assert product is not None
        assert product["name"].endswith("Wet Food")
        assert product["product_type"] == "wet"

    def test_large_breed_puppy_name(self) -> None:
        html = _make_page_html(
            h1="Life Protection Formula",
            h3_recipe="Chicken and Brown Rice Recipe",
            hero_flag="Large Breed Puppy",
        )
        url = "https://www.bluebuffalo.com/en-ca/dry-dog-food/life-protection-formula/large-breed-puppy-chicken-brown-rice-recipe"
        product = _parse_product(url, html)
        assert product is not None
        assert product["name"] == "Life Protection Formula Large Breed Puppy Chicken and Brown Rice Recipe"
        assert product["life_stage"] == "puppy"

    def test_no_h1_returns_none(self) -> None:
        html = "<html><body><p>Not a product page</p></body></html>"
        url = "https://www.bluebuffalo.com/en-ca/dry-dog-food/test/test"
        assert _parse_product(url, html) is None


def _make_chewy_page_html(
    *,
    calorie: str = "",
    ingredients: str = "",
) -> str:
    """Build a minimal Chewy product page HTML fixture."""
    parts = ["<html><body>"]
    if calorie:
        parts.append(f'<div id="CALORIC_CONTENT-section"><p>{calorie}</p></div>')
    if ingredients:
        parts.append(f'<div id="INGREDIENTS-section"><p>{ingredients}</p></div>')
    parts.append("</body></html>")
    return "\n".join(parts)


def _mock_chewy_session(
    product_html: str = "",
    product_url: str = "https://www.chewy.com/blue-buffalo-treat/dp/99999",
) -> MagicMock:
    """Create a mock session that returns search results then product page."""
    session = MagicMock()

    def get_side_effect(url: str) -> MagicMock:
        resp = MagicMock()
        resp.ok = True
        resp.status_code = 200
        if "chewy.com/s?" in url:
            resp.text = f'<a href="{product_url}">Product</a>'
        else:
            resp.text = product_html
        return resp

    session.get.side_effect = get_side_effect
    return session


class TestBuildBbChewyQuery:
    def test_treat_slug(self) -> None:
        product = {
            "name": "BLUE Stix Chicken Recipe",
            "brand": "Blue Buffalo",
            "url": "https://www.bluebuffalo.com/en-ca/dog-treats/blue/chicken-stix",
            "channel": "retail",
            "product_type": "treats",
        }
        assert _build_bb_chewy_query(product) == "blue buffalo chicken stix"

    def test_divine_delights_special_case(self) -> None:
        product = {
            "name": "Divine Delights Chicken Stew",
            "brand": "Blue Buffalo",
            "url": "https://www.bluebuffalo.com/en-ca/wet-dog-food/divine-delights/chicken-stew",
            "channel": "retail",
            "product_type": "wet",
        }
        query = _build_bb_chewy_query(product)
        assert "divine delights" in query


class TestFillMissingFromChewySeasonal:
    def test_skips_seasonal(self) -> None:
        """Santa Snacks and Boo items should be skipped."""
        products = [
            {
                "name": "BLUE Santa Snacks Oatmeal & Cinnamon",
                "brand": "Blue Buffalo",
                "url": "https://www.bluebuffalo.com/en-ca/dog-treats/blue/santa-snacks",
                "channel": "retail",
                "product_type": "treats",
            },
            {
                "name": "BLUE Boo Bars Pumpkin",
                "brand": "Blue Buffalo",
                "url": "https://www.bluebuffalo.com/en-ca/dog-treats/blue/boo-bars-pumpkin",
                "channel": "retail",
                "product_type": "treats",
            },
        ]
        session = MagicMock()
        count = _fill_missing_from_chewy(products, session)
        assert count == 0
        # Session should not be called for seasonal products
        session.get.assert_not_called()

    def test_fills_treat(self) -> None:
        """BeneBars-style product gets calories from Chewy."""
        product = {
            "name": "BLUE Health Bars Baked with Bacon Egg & Cheese",
            "brand": "Blue Buffalo",
            "url": "https://www.bluebuffalo.com/en-ca/dog-treats/blue/health-bars-bacon-egg-cheese",
            "channel": "retail",
            "product_type": "treats",
            "ingredients_raw": "Oatmeal, Barley, Rye, Canola Oil, Bacon",
        }
        chewy_html = _make_chewy_page_html(
            calorie="3,465 kcal/kg, One Bar = 70 kcal",
            ingredients="Oatmeal, Barley, Rye, Canola Oil, Bacon",
        )
        session = _mock_chewy_session(product_html=chewy_html)

        count = _fill_missing_from_chewy([product], session)
        assert count == 1
        assert "calorie_content" in product
        assert "3465 kcal/kg" in product["calorie_content"]
