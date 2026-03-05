"""Tests for scrapers.firstmate — FirstMate parsing logic."""

from scrapers.firstmate import (
    _detect_product_type,
    _detect_sub_brand,
    _is_dog_product,
    _parse_aafco,
    _parse_ga,
    _parse_ingredients,
    _parse_product,
)
from bs4 import BeautifulSoup


class TestDetectSubBrand:
    def test_firstmate(self) -> None:
        assert _detect_sub_brand("https://firstmate.com/product/chicken", "Chicken Meal Formula") == "FirstMate"

    def test_kasiks(self) -> None:
        assert _detect_sub_brand("https://firstmate.com/product/kasiks-salmon", "KASIKS Salmon Formula") == "KASIKS"


class TestDetectProductType:
    def test_dry(self) -> None:
        assert _detect_product_type("https://firstmate.com/product/chicken-formula/", "Chicken Formula") == "dry"

    def test_canned_url(self) -> None:
        assert _detect_product_type("https://firstmate.com/product/turkey-12oz/", "Turkey 12.2oz - 12 Cans") == "wet"

    def test_canned_by_can_count_in_title(self) -> None:
        """Products with '12 Cans' in the name should be classified as wet."""
        assert _detect_product_type(
            "https://firstmate.com/product/kasiks-cage-free-chicken-formula-12-cans/",
            "KASIKS Cage-Free Chicken Formula 12.2oz - 12 Cans",
        ) == "wet"

    def test_canned_24_cans(self) -> None:
        assert _detect_product_type(
            "https://firstmate.com/product/kasiks-grub-formula-cats-24-cans/",
            "KASIKS Grub Formula 5.5oz - 24 Cans",
        ) == "wet"

    def test_treats(self) -> None:
        assert _detect_product_type("https://firstmate.com/product/chicken-treats/", "Chicken & Blueberries Treats") == "treats"


class TestIsDogProduct:
    def test_dog_product_by_url(self) -> None:
        html = '<html><body><h1>Wild Salmon Formula for Dogs</h1></body></html>'
        soup = BeautifulSoup(html, "html.parser")
        assert _is_dog_product("https://firstmate.com/product/wild-salmon-formula-for-dogs/", soup) is True

    def test_cat_product_for_cats_url(self) -> None:
        html = '<html><body><h1>Salmon Formula for Cats</h1></body></html>'
        soup = BeautifulSoup(html, "html.parser")
        assert _is_dog_product("https://firstmate.com/product/salmon-formula-for-cats/", soup) is False

    def test_indoor_cat_formula_filtered(self) -> None:
        """Indoor Cat Formula should be filtered out despite no 'for-cats' in URL."""
        html = '<html><body><h1>Indoor Cat Formula</h1></body></html>'
        soup = BeautifulSoup(html, "html.parser")
        assert _is_dog_product("https://firstmate.com/product/indoor-cat-formula/", soup) is False

    def test_cat_kitten_formula_filtered(self) -> None:
        """Cat & Kitten Formula should be filtered out."""
        html = '<html><body><h1>Cat &amp; Kitten Formula</h1></body></html>'
        soup = BeautifulSoup(html, "html.parser")
        assert _is_dog_product("https://firstmate.com/product/cat-kitten-formula/", soup) is False

    def test_cats_cans_url_filtered(self) -> None:
        """URLs ending in '-cats-24-cans' should be filtered out."""
        html = '<html><body><h1>Wild Salmon Formula</h1></body></html>'
        soup = BeautifulSoup(html, "html.parser")
        assert _is_dog_product("https://firstmate.com/product/kasiks-grub-formula-cats-24-cans/", soup) is False

    def test_dog_cans_not_filtered(self) -> None:
        """URLs with '-12-cans' but no 'cat' should pass."""
        html = '<html><body><h1>Wild Salmon Formula</h1><nav><a href="/dog-food/">Dog Food</a></nav></body></html>'
        soup = BeautifulSoup(html, "html.parser")
        assert _is_dog_product("https://firstmate.com/product/kasiks-cage-free-chicken-formula-12-cans/", soup) is True


class TestParseIngredients:
    def test_extracts_from_product_ingredients_list(self) -> None:
        """Test extraction from the actual FirstMate HTML structure with <a> tags."""
        html = """
        <div class="tab-pane tab-pane--ingredients" id="ingredients">
          <div class="product-ingredients">
            <div class="row">
              <div class="col-sm-6">
                <ul class="product-ingredients-list list-ingredients">
                  <li><a href="#" data-title="Chicken Meal" data-content="desc">Chicken Meal</a></li>
                  <li><a href="#" data-title="Burbank Potato" data-content="desc">Burbank Potato</a></li>
                  <li><a href="#" data-title="Norkotah Potato" data-content="desc">Norkotah Potato</a></li>
                  <li><a href="#" data-title="Chicken Fat" data-content="desc">Chicken Fat (preserved with mixed tocopherols)</a></li>
                  <li><a href="#" data-title="Whole Blueberries" data-content="desc">Whole Blueberries</a></li>
                </ul>
              </div>
            </div>
          </div>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_ingredients(soup)
        assert result is not None
        assert "Chicken Meal" in result
        assert "Burbank Potato" in result
        assert "Whole Blueberries" in result
        # Should NOT contain marketing text
        assert "Limited Ingredient" not in result
        assert "Single Meat Protein" not in result

    def test_handles_nested_sublists(self) -> None:
        """Test sub-ingredient parsing (minerals/vitamins groups)."""
        html = """
        <ul class="product-ingredients-list list-ingredients">
          <li><a href="#">Chicken Meal</a></li>
          <li><a href="#">Potato</a></li>
          <li><span>Minerals</span></li>
          <li class="sub-ingredient parent--51">
            <ul>
              <li class="sub-ingredient parent--51">(<a href="#">Zinc Proteinate</a></li>
              <li class="sub-ingredient parent--51"><a href="#">Iron Proteinate</a></li>
              <li class="sub-ingredient parent--51"><a href="#">Calcium Iodate</a>)</li>
            </ul>
          </li>
          <li><span>Vitamins</span></li>
          <li class="sub-ingredient parent--50">
            <ul>
              <li class="sub-ingredient parent--50">(<a href="#">Vitamin E Supplement</a></li>
              <li class="sub-ingredient parent--50"><a href="#">Niacin</a>)</li>
            </ul>
          </li>
        </ul>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_ingredients(soup)
        assert result is not None
        assert "Chicken Meal" in result
        assert "Zinc Proteinate" in result
        assert "Vitamin E Supplement" in result
        # Category labels should be excluded
        assert result.startswith("Chicken Meal")
        assert "Minerals" not in result.split(", ")
        assert "Vitamins" not in result.split(", ")

    def test_does_not_pick_up_marketing_badges(self) -> None:
        """The marketing highlight badges at the top should NOT be parsed as ingredients."""
        html = """
        <ul class="list-check product-blue">
          <li>Grain & Pea Free</li>
          <li>Single Meat Protein</li>
          <li>Limited Ingredient Formula</li>
        </ul>
        <ul class="product-ingredients-list list-ingredients">
          <li><a href="#">Chicken Meal</a></li>
          <li><a href="#">Potato</a></li>
        </ul>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_ingredients(soup)
        assert result is not None
        assert "Grain & Pea Free" not in result
        assert "Single Meat Protein" not in result
        assert "Chicken Meal" in result


class TestParseGa:
    def test_four_column_table(self) -> None:
        html = """
        <div class="entry-content">
            <table>
                <tr><td>Crude Protein (min)</td><td>25.0%</td><td>Ash (max)</td><td>9.0%</td></tr>
                <tr><td>Crude Fat (min)</td><td>14.0%</td><td>Calcium (min)</td><td>1.5%</td></tr>
                <tr><td>Crude Fibre (max)</td><td>4.0%</td><td>Phosphorous (min)</td><td>1.0%</td></tr>
                <tr><td>Moisture (max)</td><td>10.0%</td><td></td><td></td></tr>
                <tr><td colspan="4" class="text-center">ME (calculated): 3400 kcal/ kg | 527 kcal/cup</td></tr>
            </table>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        ga, cal = _parse_ga(soup)
        assert ga is not None
        assert ga["crude_protein_min"] == 25.0
        assert ga["crude_fat_min"] == 14.0
        assert ga["crude_fiber_max"] == 4.0
        assert ga["moisture_max"] == 10.0
        assert ga["ash_max"] == 9.0
        assert ga["calcium_min"] == 1.5
        assert ga["phosphorus_min"] == 1.0
        assert cal is not None
        assert "3400 kcal/kg" in cal

    def test_colspan_calorie_extraction(self) -> None:
        """Calorie content in a colspan=4 row should be extracted."""
        html = """
        <table>
            <tr><td>Crude Protein (min)</td><td>10.0%</td><td>Crude Fat (min)</td><td>7.0%</td></tr>
            <tr><td colspan="4" class="text-center">901 kcal/kg | 311 kcal/345g can</td></tr>
        </table>
        """
        soup = BeautifulSoup(html, "html.parser")
        ga, cal = _parse_ga(soup)
        assert ga is not None
        assert cal is not None
        assert "901 kcal/kg" in cal

    def test_ratio_row_not_parsed(self) -> None:
        """Calcium/Phosphorous ratio row should be skipped, not parsed as GA."""
        html = """
        <table>
            <tr><td>Crude Protein (min)</td><td>25.0%</td><td>Calcium (min)</td><td>1.5%</td></tr>
            <tr><td>Moisture (max)</td><td>10.0%</td><td>Calcium / Phosphorous ratio</td><td>1.5:1.0</td></tr>
        </table>
        """
        soup = BeautifulSoup(html, "html.parser")
        ga, _ = _parse_ga(soup)
        assert ga is not None
        assert ga["calcium_min"] == 1.5
        # The ratio should not override the actual calcium value
        assert ga.get("calcium_min") == 1.5


class TestParseAafco:
    def test_extracts_from_guidelines_box(self) -> None:
        """AAFCO should be extracted from the product__guidelines__box div."""
        html = """
        <div class="product__guidelines__box">
          FirstMate Chicken Meal with Blueberries Formula is formulated to meet the
          nutritional levels established by the AAFCO Dog Food Nutrient Profiles for All Life Stages.
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_aafco(soup)
        assert result is not None
        assert "AAFCO" in result
        assert "All Life Stages" in result
        # Should be a clean statement, not a full page dump
        assert len(result) < 500

    def test_does_not_return_page_dump(self) -> None:
        """AAFCO extraction should not return thousands of chars of page text."""
        html = """
        <div class="product__guidelines__box">
          FirstMate Chicken Formula is formulated to meet the AAFCO Dog Food Nutrient Profiles for All Life Stages.
        </div>
        <div class="lots-of-other-content">
        """ + "x" * 5000 + """
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_aafco(soup)
        assert result is not None
        assert len(result) < 500

    def test_fallback_regex(self) -> None:
        """Falls back to regex when no guidelines box exists."""
        html = """
        <div>
            <p>FirstMate Chicken Meal with Blueberries Formula is formulated to meet the
            nutritional levels established by the AAFCO Dog Food Nutrient Profiles for All Life Stages.</p>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_aafco(soup)
        assert result is not None
        assert "AAFCO" in result


class TestParseProduct:
    def test_full_product(self) -> None:
        html = """
        <html>
        <head><meta property="og:image" content="https://example.com/product.jpg" /></head>
        <body>
            <h1 class="product__title">Limited Ingredient Chicken Meal with Blueberries Formula</h1>
            <nav><a href="/dog-food/">Dog Food</a></nav>
            <ul class="list-check product-blue">
                <li>Grain & Pea Free</li>
                <li>Single Meat Protein</li>
                <li>Limited Ingredient Formula</li>
            </ul>
            <div class="product__guidelines__box">
              FirstMate Chicken Meal with Blueberries Formula is formulated to meet the AAFCO Dog Food Nutrient Profiles for All Life Stages.
            </div>
            <ul class="product-ingredients-list list-ingredients">
                <li><a href="#">Chicken Meal</a></li>
                <li><a href="#">Burbank Potato</a></li>
                <li><a href="#">Whole Blueberries</a></li>
            </ul>
            <table>
                <tr><td>Crude Protein (min)</td><td>25.0%</td><td>Ash (max)</td><td>9.0%</td></tr>
                <tr><td>Crude Fat (min)</td><td>14.0%</td><td>Calcium (min)</td><td>1.5%</td></tr>
                <tr><td colspan="4" class="text-center">ME (calculated): 3400 kcal/kg | 527 kcal/cup</td></tr>
            </table>
        </body>
        </html>
        """
        url = "https://firstmate.com/product/chicken-meal-with-blueberries-formula/"
        result = _parse_product(url, html)
        assert result is not None
        assert result["name"] == "Limited Ingredient Chicken Meal with Blueberries Formula"
        assert result["brand"] == "FirstMate"
        assert result["sub_brand"] == "FirstMate"
        assert result["product_type"] == "dry"
        # Ingredients should be actual ingredients, not marketing
        assert "Chicken Meal" in result["ingredients_raw"]
        assert "Grain & Pea Free" not in result.get("ingredients_raw", "")
        # Calorie content should be present
        assert "calorie_content" in result
        assert "3400 kcal/kg" in result["calorie_content"]
        # AAFCO should be a clean statement
        assert "aafco_statement" in result
        assert "AAFCO" in result["aafco_statement"]
        assert len(result["aafco_statement"]) < 500

    def test_cat_product_filtered(self) -> None:
        html = """
        <html><body>
            <h1>Indoor Cat Formula</h1>
            <nav><a href="/cat-food/">Cat Food</a></nav>
        </body></html>
        """
        url = "https://firstmate.com/product/indoor-cat-formula/"
        result = _parse_product(url, html)
        assert result is None

    def test_canned_product_type(self) -> None:
        html = """
        <html><body>
            <h1>KASIKS Cage-Free Chicken Formula 12.2oz - 12 Cans</h1>
            <nav><a href="/dog-food/">Dog Food</a></nav>
            <ul class="product-ingredients-list list-ingredients">
                <li><a href="#">Chicken</a></li>
            </ul>
            <table>
                <tr><td>Crude Protein (min)</td><td>10.0%</td><td>Crude Fat (min)</td><td>7.0%</td></tr>
                <tr><td colspan="4">901 kcal/kg | 311 kcal/345g can</td></tr>
            </table>
        </body></html>
        """
        url = "https://firstmate.com/product/kasiks-cage-free-chicken-formula-12-cans/"
        result = _parse_product(url, html)
        assert result is not None
        assert result["product_type"] == "wet"
