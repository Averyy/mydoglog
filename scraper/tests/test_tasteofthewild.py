"""Tests for scrapers.tasteofthewild — Taste of the Wild parsing logic."""

from scrapers.tasteofthewild import (
    _detect_life_stage,
    _detect_product_type,
    _detect_sub_brand,
    _parse_aafco,
    _parse_calorie_content,
    _parse_ga,
    _parse_ingredients,
    _parse_product,
)
from bs4 import BeautifulSoup


class TestDetectSubBrand:
    def test_taste_of_the_wild(self) -> None:
        assert _detect_sub_brand("https://tasteofthewildpetfood.com/dog/taste-of-the-wild/high-prairie") == "Taste of the Wild"

    def test_ancient_grains(self) -> None:
        assert _detect_sub_brand("https://tasteofthewildpetfood.com/dog/ancient-grains/ancient-prairie") == "Ancient Grains"

    def test_prey(self) -> None:
        assert _detect_sub_brand("https://tasteofthewildpetfood.com/dog/prey/angus-beef") == "PREY"

    def test_grain_free(self) -> None:
        assert _detect_sub_brand("https://tasteofthewildpetfood.com/dog/grain-free/high-prairie") == "Taste of the Wild"


class TestDetectProductType:
    def test_dry(self) -> None:
        assert _detect_product_type("https://example.com/dog/dry", "Prairie Recipe") == "dry"

    def test_wet_from_url(self) -> None:
        assert _detect_product_type("https://example.com/dog/wet-food", "Recipe") == "wet"

    def test_wet_from_title(self) -> None:
        assert _detect_product_type("https://example.com/dog/food", "Bison in Gravy Canine Recipe") == "wet"

    def test_treats_from_title(self) -> None:
        assert _detect_product_type("https://example.com/dog/food", "Turkey Treats") == "treats"

    def test_wetlands_is_dry_not_wet(self) -> None:
        """'Wetlands' should NOT match 'wet' — it's a dry product name."""
        assert _detect_product_type(
            "https://example.com/dog/grain-free/wetlands-with-roasted-fowl",
            "Wetlands Canine Recipe with Roasted Fowl",
        ) == "dry"

    def test_canned_is_wet(self) -> None:
        assert _detect_product_type("https://example.com/dog/canned", "Recipe") == "wet"

    def test_stew_is_wet(self) -> None:
        assert _detect_product_type("https://example.com/dog/food", "Beef Stew Recipe") == "wet"


class TestParseIngredients:
    def test_extracts_from_all_ingredients_list(self) -> None:
        """Test extraction from the real TOTW 'All Ingredients' accordion structure."""
        html = """
        <div id="collapseIngredients" class="accordion-collapse collapse">
            <div class="accordion-body all-ingred-accord">
                <div class="all-ingrd-pill-cont">
                    <ul class="nav-like nav-pills" id="all-ingred-pills-list">
                        <li class="nav-item">
                            <a class="nav-link" id="pill-tab-igred-all-330" href="#">
                                Water Buffalo
                            </a>
                        </li>
                        <li class="nav-item">
                            <a class="nav-link" id="pill-tab-igred-all-59" href="#">
                                Lamb Meal
                            </a>
                        </li>
                        <li class="nav-item">
                            <a class="nav-link" id="pill-tab-igred-all-45" href="#">
                                Chicken Meal
                            </a>
                        </li>
                        <li class="nav-item">
                            <a class="nav-link" id="pill-tab-igred-all-121" href="#">
                                Sweet Potatoes
                            </a>
                        </li>
                        <li class="nav-item">
                            <a class="nav-link" id="pill-tab-igred-all-43" href="#">
                                Chicken Fat (preserved with mixed tocopherols)
                            </a>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_ingredients(soup)
        assert result is not None
        assert result == "Water Buffalo, Lamb Meal, Chicken Meal, Sweet Potatoes, Chicken Fat (preserved with mixed tocopherols)"

    def test_ignores_featured_ingredients(self) -> None:
        """Featured Ingredients (marketing descriptions) must NOT be included."""
        html = """
        <div>
            <h3>Featured Ingredients</h3>
            <div class="featured-ingrd-pill-cont">
                <ul class="nav-like nav-pills" id="key-ingred-pills">
                    <li class="nav-item">
                        <a class="nav-link" id="pill-tab-igred-124" href="#">Roasted Bison</a>
                    </li>
                </ul>
                <div class="tab-content">
                    <p>Bison is a highly digestible protein that enhances palatability.</p>
                </div>
            </div>
        </div>
        <div id="collapseIngredients" class="accordion-collapse collapse">
            <div class="accordion-body all-ingred-accord">
                <div class="all-ingrd-pill-cont">
                    <ul class="nav-like nav-pills" id="all-ingred-pills-list">
                        <li class="nav-item">
                            <a class="nav-link" href="#">Water Buffalo</a>
                        </li>
                        <li class="nav-item">
                            <a class="nav-link" href="#">Lamb Meal</a>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_ingredients(soup)
        assert result is not None
        assert result == "Water Buffalo, Lamb Meal"
        # Ensure marketing descriptions are NOT in the result
        assert "digestible" not in result
        assert "palatability" not in result

    def test_returns_none_for_no_ingredients(self) -> None:
        soup = BeautifulSoup("<div>No data here</div>", "html.parser")
        assert _parse_ingredients(soup) is None

    def test_comma_separated_clean_format(self) -> None:
        """Result should be clean comma-separated ingredient names, no HTML junk."""
        html = """
        <ul id="all-ingred-pills-list">
            <li class="nav-item"><a class="nav-link" href="#">Salt</a></li>
            <li class="nav-item"><a class="nav-link" href="#">Taurine</a></li>
            <li class="nav-item"><a class="nav-link" href="#">Vitamin E Supplement</a></li>
        </ul>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_ingredients(soup)
        assert result == "Salt, Taurine, Vitamin E Supplement"


class TestParseGa:
    def test_parses_html_table(self) -> None:
        html = """
        <table>
            <tr><td>Crude Protein</td><td>32.0% minimum</td></tr>
            <tr><td>Crude Fat</td><td>18.0% minimum</td></tr>
            <tr><td>Crude Fiber</td><td>4.0% maximum</td></tr>
            <tr><td>Moisture</td><td>10.0% maximum</td></tr>
        </table>
        """
        soup = BeautifulSoup(html, "html.parser")
        ga = _parse_ga(soup)
        assert ga is not None
        assert ga["crude_protein_min"] == 32.0
        assert ga["crude_fat_min"] == 18.0
        assert ga["crude_fiber_max"] == 4.0
        assert ga["moisture_max"] == 10.0

    def test_returns_none_for_no_table(self) -> None:
        soup = BeautifulSoup("<div>No table</div>", "html.parser")
        assert _parse_ga(soup) is None


class TestParseCalorieContent:
    def test_standard_format(self) -> None:
        html = """
        <div>
            <p>Calorie Content: 3,719 kcal/kg (422 kcal/cup) Calculated Metabolizable Energy</p>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_calorie_content(soup)
        assert result is not None
        assert "3719 kcal/kg" in result
        assert "422 kcal/cup" in result


class TestParseAafco:
    def test_extracts_from_aafco_tab_pane(self) -> None:
        """Test the primary extraction path: AAFCO tab pane with h3 heading."""
        html = """
        <div id="aafco-tab-pane" role="tabpanel">
            <div class="accordion-body">
                <h3>AAFCO Statement</h3>
                <p style="font-size:20px">Taste of the Wild High Prairie Canine Recipe is formulated to meet the
                nutritional levels established by the AAFCO Dog Food Nutrient Profiles for maintenance.</p>
            </div>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_aafco(soup)
        assert result is not None
        assert "AAFCO" in result
        assert "maintenance" in result
        assert result.startswith("Taste of the Wild")
        # Should NOT contain navigation junk
        assert "Where to Buy" not in result
        assert "nav" not in result.lower()

    def test_extracts_from_heading_fallback(self) -> None:
        """Fallback: h3 heading without the specific tab pane ID."""
        html = """
        <div>
            <h3>AAFCO Statement</h3>
            <p>This food is formulated to meet the AAFCO Dog Food Nutrient Profiles for all life stages.</p>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_aafco(soup)
        assert result is not None
        assert "AAFCO" in result
        assert "all life stages" in result

    def test_excludes_nav_menu_junk(self) -> None:
        """Ensure nav menu text doesn't pollute the AAFCO statement."""
        html = """
        <nav>
            <a href="/dog/taste-of-the-wild/">Dog Recipes</a>
            <a href="/where-to-buy/">Where to Buy</a>
        </nav>
        <div id="aafco-tab-pane" role="tabpanel">
            <h3>AAFCO Statement</h3>
            <p>Taste of the Wild PREY Angus Beef is formulated to meet the nutritional
            levels established by the AAFCO Dog Food Nutrient Profiles for maintenance.</p>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_aafco(soup)
        assert result is not None
        assert "Dog Recipes" not in result
        assert "Where to Buy" not in result
        assert len(result) < 300  # Should be just the statement, not page dump


class TestDetectLifeStage:
    def test_puppy_from_name(self) -> None:
        assert _detect_life_stage("High Prairie Puppy Recipe", None) == "puppy"

    def test_puppy_from_name_overrides_aafco(self) -> None:
        assert _detect_life_stage(
            "High Prairie Puppy Recipe",
            "...AAFCO...for All Life Stages...",
        ) == "puppy"

    def test_adult_from_aafco_maintenance(self) -> None:
        assert _detect_life_stage(
            "High Prairie Canine Recipe",
            "formulated to meet AAFCO Dog Food Nutrient Profiles for maintenance.",
        ) == "adult"

    def test_all_life_stages_from_aafco(self) -> None:
        assert _detect_life_stage(
            "Some Recipe",
            "formulated to meet AAFCO Dog Food Nutrient Profiles for All Life Stages.",
        ) == "all life stages"

    def test_all_life_stages_from_growth_and_maintenance(self) -> None:
        assert _detect_life_stage(
            "Bison in Gravy Recipe",
            "formulated to meet AAFCO Dog Food Nutrient Profiles for growth and maintenance.",
        ) == "all life stages"

    def test_puppy_from_aafco_growth(self) -> None:
        assert _detect_life_stage(
            "Some Recipe",
            "formulated to meet AAFCO Dog Food Nutrient Profiles for growth.",
        ) == "puppy"

    def test_senior_from_name(self) -> None:
        assert _detect_life_stage("Senior Recipe", None) == "senior"

    def test_none_when_no_signal(self) -> None:
        assert _detect_life_stage("Some Recipe", None) is None


class TestParseProduct:
    def test_full_product_with_real_structure(self) -> None:
        """Test with HTML structure matching the real TOTW product page layout."""
        html = """
        <html>
        <head>
            <meta property="og:image" content="https://example.com/product.jpg" />
        </head>
        <body>
            <h1>High Prairie Canine Recipe with Roasted Bison &amp; Roasted Venison</h1>
            <div id="collapseIngredients" class="accordion-collapse collapse">
                <div class="accordion-body all-ingred-accord">
                    <div class="all-ingrd-pill-cont">
                        <ul class="nav-like nav-pills" id="all-ingred-pills-list">
                            <li class="nav-item">
                                <a class="nav-link" href="#">Water Buffalo</a>
                            </li>
                            <li class="nav-item">
                                <a class="nav-link" href="#">Lamb Meal</a>
                            </li>
                            <li class="nav-item">
                                <a class="nav-link" href="#">Chicken Meal</a>
                            </li>
                            <li class="nav-item">
                                <a class="nav-link" href="#">Sweet Potatoes</a>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
            <table>
                <tr><td>Crude Protein</td><td>32.0% minimum</td></tr>
                <tr><td>Crude Fat</td><td>18.0% minimum</td></tr>
            </table>
            <p>3,719 kcal/kg (422 kcal/cup)</p>
            <div id="aafco-tab-pane" role="tabpanel">
                <h3>AAFCO Statement</h3>
                <p>Taste of the Wild High Prairie Canine Recipe is formulated to meet the
                nutritional levels established by the AAFCO Dog Food Nutrient Profiles for maintenance.</p>
            </div>
        </body>
        </html>
        """
        url = "https://www.tasteofthewildpetfood.com/dog/grain-free/high-prairie-with-roasted-bison-roasted-venison"
        result = _parse_product(url, html)
        assert result is not None
        assert result["name"] == "High Prairie Canine Recipe with Roasted Bison & Roasted Venison"
        assert result["brand"] == "Taste of the Wild"
        assert result["sub_brand"] == "Taste of the Wild"
        assert result["product_type"] == "dry"
        assert result["ingredients_raw"] == "Water Buffalo, Lamb Meal, Chicken Meal, Sweet Potatoes"
        assert result["guaranteed_analysis"]["crude_protein_min"] == 32.0
        assert result["aafco_statement"] is not None
        assert "AAFCO" in result["aafco_statement"]
        assert result["life_stage"] == "adult"
        assert result["images"] == ["https://example.com/product.jpg"]

    def test_wetlands_product_is_dry(self) -> None:
        """Wetlands products should be classified as dry, not wet."""
        html = """
        <html><body>
            <h1>Wetlands Canine Recipe with Roasted Fowl</h1>
        </body></html>
        """
        url = "https://www.tasteofthewildpetfood.com/dog/grain-free/wetlands-with-roasted-fowl"
        result = _parse_product(url, html)
        assert result is not None
        assert result["product_type"] == "dry"

    def test_puppy_product_life_stage(self) -> None:
        """Puppy products should get life_stage='puppy'."""
        html = """
        <html><body>
            <h1>High Prairie Puppy Recipe with Roasted Bison &amp; Roasted Venison</h1>
            <div id="aafco-tab-pane" role="tabpanel">
                <h3>AAFCO Statement</h3>
                <p>Taste of the Wild High Prairie Puppy Recipe is formulated to meet the
                nutritional levels established by the AAFCO Dog Food Nutrient Profiles for
                All Life Stages including growth of large size dogs.</p>
            </div>
        </body></html>
        """
        url = "https://www.tasteofthewildpetfood.com/dog/grain-free/high-prairie-puppy"
        result = _parse_product(url, html)
        assert result is not None
        assert result["life_stage"] == "puppy"

    def test_returns_none_for_no_h1(self) -> None:
        assert _parse_product("https://example.com", "<html><body></body></html>") is None
