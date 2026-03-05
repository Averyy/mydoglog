"""Tests for scrapers.canadiannaturals — Canadian Naturals parsing logic."""

from bs4 import BeautifulSoup

from scrapers.canadiannaturals import (
    _SUPPLEMENTARY_CALORIES,
    _detect_product_line,
    _detect_product_type,
    _map_ga_field,
    _parse_ga_text,
    _parse_images,
    _parse_ingredients,
    _parse_name,
    _parse_product,
)


# --- Realistic HTML fragments matching actual Canadian Naturals page structure ---

_SPEAKER_BIO_HTML = """
<div class="speaker-bio">
    <h3>Chicken &amp; Brown Rice Recipe for Dogs</h3>
    <p>Value Series</p>
</div>
"""

_INGREDIENTS_HTML = """
<div class="speaker-bio" id="dog-vs-cr">
    <p><strong>Ingredients:</strong>Chicken meal, ground oats, brown rice, potato,
    chicken fat (stabilized with mixed tocopherols), millet, rye, fresh chicken,
    natural flavour, whole dried egg, flaxseed.</p>
</div>
"""

_GA_HTML = """
<div>Guaranteed Analysis:</div>
<ul class="cbox double-column-list">
    <li>Protein 24%min</li>
    <li>Fat 14%min</li>
    <li>Fibre 3.5%max</li>
    <li>Moisture 10%max</li>
    <li>Calcium 1.6%min</li>
    <li>Omega-6 fatty acids 2.1%min</li>
    <li>Omega-3 fatty acids .40%min</li>
    <li>Phosphorus 1.0%min</li>
    <li>Calorie Content: 3746 kcal per kg (400 kcal per cup)</li>
</ul>
"""

_PRODUCT_IMAGE_HTML = """
<div class="single-team-details">
    <img src="https://canadiannaturals.com/wp-content/uploads/2020/05/dog-value-chickenrice2-NoBG-600x600.png"
         class="vc_single_image-img" />
    <img src="https://canadiannaturals.com/wp-content/uploads/2020/05/.png"
         class="wp-image-2413" />
</div>
"""

_FULL_PRODUCT_HTML = """
<html><head>
<title>Chicken &amp; Brown Rice – Canadian Naturals</title>
</head><body>
<div class="single-team-details">
    <img src="https://canadiannaturals.com/wp-content/uploads/2020/05/dog-value-chickenrice2-NoBG-600x600.png"
         class="vc_single_image-img" />
    <div class="speaker-bio">
        <h3>Chicken &amp; Brown Rice Recipe for Dogs</h3>
        <p>Value Series</p>
    </div>
    <div class="speaker-bio" id="dog-vs-cr">
        <p><strong>Ingredients:</strong>Chicken meal, ground oats, brown rice, potato,
        chicken fat (stabilized with mixed tocopherols), millet, rye, fresh chicken,
        natural flavour, whole dried egg, flaxseed.</p>
    </div>
    <div>Guaranteed Analysis:</div>
    <ul class="cbox double-column-list">
        <li>Protein 24%min</li>
        <li>Fat 14%min</li>
        <li>Fibre 3.5%max</li>
        <li>Moisture 10%max</li>
        <li>Calcium 1.6%min</li>
        <li>Omega-6 fatty acids 2.1%min</li>
        <li>Omega-3 fatty acids .40%min</li>
        <li>Phosphorus 1.0%min</li>
        <li>Calorie Content: 3746 kcal per kg (400 kcal per cup)</li>
    </ul>
    <p>For dogs</p>
</div>
</body></html>
"""


class TestParseName:
    def test_extracts_from_speaker_bio_h3(self) -> None:
        soup = BeautifulSoup(_SPEAKER_BIO_HTML, "html.parser")
        assert _parse_name(soup) == "Chicken & Brown Rice Recipe for Dogs"

    def test_excludes_product_line_text(self) -> None:
        html = """
        <div class="speaker-bio">
            <h3>Red Meat Recipe for Dogs</h3>
            <p>Grain Free Value Series</p>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        name = _parse_name(soup)
        assert name == "Red Meat Recipe for Dogs"
        assert "Grain Free" not in name
        assert "Value Series" not in name

    def test_ignores_review_titles(self) -> None:
        """Review titles in h3 tags should not be picked up as product names."""
        html = """
        <div class="speaker-bio">
            <h3>Turkey &amp; Salmon Recipe for Dogs</h3>
            <p>For All Life Stages</p>
        </div>
        <h3>Good price! But there is still chicken fat in the recipe</h3>
        <h3>Great food</h3>
        """
        soup = BeautifulSoup(html, "html.parser")
        name = _parse_name(soup)
        assert name == "Turkey & Salmon Recipe for Dogs"
        assert "Good price" not in name

    def test_fallback_to_title_tag(self) -> None:
        html = """
        <html><head>
        <title>Lamb &amp; Rice – Canadian Naturals</title>
        </head><body></body></html>
        """
        soup = BeautifulSoup(html, "html.parser")
        assert _parse_name(soup) == "Lamb & Rice"

    def test_returns_none_for_empty_page(self) -> None:
        soup = BeautifulSoup("<html><body></body></html>", "html.parser")
        assert _parse_name(soup) is None


class TestParseIngredients:
    def test_extracts_from_strong_tag(self) -> None:
        soup = BeautifulSoup(_INGREDIENTS_HTML, "html.parser")
        result = _parse_ingredients(soup)
        assert result is not None
        assert result.startswith("Chicken meal")
        assert "flaxseed" in result

    def test_excludes_page_chrome(self) -> None:
        """Ingredients should not contain nav menus, reviews, or marketing copy."""
        html = """
        <nav>Where to Buy</nav>
        <h2>Product Features</h2>
        <h3>Yummy!</h3>
        <p>Great food for my dog.</p>
        <div class="speaker-bio" id="dog-vs-cr">
            <p><strong>Ingredients:</strong>Chicken meal, brown rice, potato, fresh chicken.</p>
        </div>
        <div>Guaranteed Analysis:</div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_ingredients(soup)
        assert result is not None
        assert "Where to Buy" not in result
        assert "Product Features" not in result
        assert "Yummy" not in result
        assert "Great food for my dog" not in result
        assert "Guaranteed Analysis" not in result
        assert result.startswith("Chicken meal")

    def test_returns_none_when_missing(self) -> None:
        soup = BeautifulSoup("<div>No ingredients here</div>", "html.parser")
        assert _parse_ingredients(soup) is None


class TestMapGaField:
    def test_fat_matches_fat_only(self) -> None:
        """'fat' label should map to crude_fat, not omega."""
        assert _map_ga_field("fat", "min") == "crude_fat_min"

    def test_omega6_fatty_acids_maps_to_omega6(self) -> None:
        """'omega-6 fatty acids' must NOT match 'fat' — it should match 'omega-6'."""
        result = _map_ga_field("omega-6 fatty acids", "min")
        assert result == "omega_6_min"
        assert result != "crude_fat_min"

    def test_omega3_fatty_acids_maps_to_omega3(self) -> None:
        result = _map_ga_field("omega-3 fatty acids", "min")
        assert result == "omega_3_min"
        assert result != "crude_fat_min"

    def test_protein(self) -> None:
        assert _map_ga_field("protein", "min") == "crude_protein_min"

    def test_fibre(self) -> None:
        assert _map_ga_field("fibre", "max") == "crude_fiber_max"

    def test_unknown_label(self) -> None:
        assert _map_ga_field("unknown nutrient", None) is None


class TestParseGaText:
    def test_parses_all_fields(self) -> None:
        soup = BeautifulSoup(_GA_HTML, "html.parser")
        ga, cal = _parse_ga_text(soup)
        assert ga is not None
        assert ga["crude_protein_min"] == 24.0
        assert ga["crude_fat_min"] == 14.0
        assert ga["crude_fiber_max"] == 3.5
        assert ga["moisture_max"] == 10.0
        assert ga["calcium_min"] == 1.6
        assert ga["phosphorus_min"] == 1.0

    def test_fat_not_overwritten_by_omega6(self) -> None:
        """Critical: fat must be 14%, NOT 2.1% (the omega-6 value)."""
        soup = BeautifulSoup(_GA_HTML, "html.parser")
        ga, _ = _parse_ga_text(soup)
        assert ga is not None
        assert ga["crude_fat_min"] == 14.0
        assert ga["omega_6_min"] == 2.1

    def test_omega3_leading_dot(self) -> None:
        """'.40%min' should parse as 0.40, not 40.0."""
        soup = BeautifulSoup(_GA_HTML, "html.parser")
        ga, _ = _parse_ga_text(soup)
        assert ga is not None
        assert ga["omega_3_min"] == 0.40

    def test_calorie_content(self) -> None:
        soup = BeautifulSoup(_GA_HTML, "html.parser")
        _, cal = _parse_ga_text(soup)
        assert cal is not None
        assert "3746 kcal/kg" in cal
        assert "400 kcal/cup" in cal


class TestParseGaTextNoCalories:
    """Some products have GA data but no calorie content in the <ul>
    (e.g. Lamb & Brown Rice Large Breed). Parser must return None for calories."""

    def test_ga_without_calorie_line(self) -> None:
        html = """
        <div>Guaranteed Analysis:</div>
        <ul class="cbox double-column-list">
            <li>Protein 24%min</li>
            <li>Fat 12%min</li>
            <li>Fibre 3.8%max</li>
            <li>Moisture 10%max</li>
            <li>Omega-6 fatty acids 2.8%min</li>
            <li>Omega-3 fatty acids 2.4%min</li>
            <li>Glucosamine 800mg/kg min</li>
            <li>Chondroitin 400mg/kg min</li>
        </ul>
        """
        soup = BeautifulSoup(html, "html.parser")
        ga, cal = _parse_ga_text(soup)
        assert ga is not None
        assert ga["crude_protein_min"] == 24.0
        assert ga["crude_fat_min"] == 12.0
        assert cal is None


class TestParseImages:
    def test_extracts_product_image(self) -> None:
        soup = BeautifulSoup(_PRODUCT_IMAGE_HTML, "html.parser")
        images = _parse_images(soup)
        assert len(images) == 1
        assert "dog-value-chickenrice2" in images[0]

    def test_filters_broken_images(self) -> None:
        """Images with empty filenames like '.png' should be excluded."""
        soup = BeautifulSoup(_PRODUCT_IMAGE_HTML, "html.parser")
        images = _parse_images(soup)
        for img in images:
            filename = img.rsplit("/", 1)[-1]
            assert len(filename) > 4  # not just ".png"


class TestDetectProductLine:
    def test_value_series(self) -> None:
        html = "<html><body>Value Series product</body></html>"
        soup = BeautifulSoup(html, "html.parser")
        assert _detect_product_line(soup) == "Value Series"

    def test_omega_fresh(self) -> None:
        html = "<html><body>Omega Fresh recipe</body></html>"
        soup = BeautifulSoup(html, "html.parser")
        assert _detect_product_line(soup) == "Omega Fresh"

    def test_grain_free(self) -> None:
        html = "<html><body>Grain Free formula</body></html>"
        soup = BeautifulSoup(html, "html.parser")
        assert _detect_product_line(soup) == "Grain Free"

    def test_none(self) -> None:
        html = "<html><body>Generic product</body></html>"
        soup = BeautifulSoup(html, "html.parser")
        assert _detect_product_line(soup) is None


class TestDetectProductType:
    def test_dry(self) -> None:
        assert _detect_product_type("https://example.com/team/chicken-rice", "Chicken & Rice") == "dry"

    def test_wet(self) -> None:
        assert _detect_product_type("https://example.com/team/chicken-stew", "Chicken Stew") == "wet"

    def test_treats(self) -> None:
        assert _detect_product_type("https://example.com/team/treats", "Chicken Treats") == "treats"


class TestParseProduct:
    def test_full_product_parse(self) -> None:
        url = "https://canadiannaturals.com/team/chicken-rice"
        product = _parse_product(url, _FULL_PRODUCT_HTML)
        assert product is not None
        assert product["name"] == "Chicken & Brown Rice Recipe for Dogs"
        assert product["brand"] == "Canadian Naturals"
        assert product["channel"] == "retail"
        assert product["product_type"] == "dry"

    def test_has_ingredients(self) -> None:
        product = _parse_product("https://canadiannaturals.com/team/chicken-rice", _FULL_PRODUCT_HTML)
        assert product is not None
        assert "ingredients_raw" in product
        assert product["ingredients_raw"].startswith("Chicken meal")
        assert "Where to Buy" not in product["ingredients_raw"]

    def test_has_correct_ga(self) -> None:
        product = _parse_product("https://canadiannaturals.com/team/chicken-rice", _FULL_PRODUCT_HTML)
        assert product is not None
        ga = product.get("guaranteed_analysis", {})
        assert ga["crude_fat_min"] == 14.0
        assert ga["omega_6_min"] == 2.1
        assert ga["omega_3_min"] == 0.40

    def test_has_images(self) -> None:
        product = _parse_product("https://canadiannaturals.com/team/chicken-rice", _FULL_PRODUCT_HTML)
        assert product is not None
        assert "images" in product
        assert len(product["images"]) >= 1

    def test_cat_product_excluded(self) -> None:
        html = """
        <html><body>
        <div class="single-team-details">
            <div class="speaker-bio"><h3>Chicken Cat Recipe</h3></div>
            <p>For cats only</p>
        </div>
        </body></html>
        """
        product = _parse_product("https://canadiannaturals.com/team/chicken-cat-recipe", html)
        assert product is None


class TestSupplementaryCalories:
    """Products where canadiannaturals.com omits calorie data but retailers
    confirm it (e.g. Lamb & Brown Rice Large Breed)."""

    def test_supplementary_dict_has_lamb_large_breed(self) -> None:
        assert "lamb-rice-large-breed" in _SUPPLEMENTARY_CALORIES
        cal = _SUPPLEMENTARY_CALORIES["lamb-rice-large-breed"]
        assert "3551" in cal
        assert "kcal/kg" in cal
        assert "378" in cal
        assert "kcal/cup" in cal

    def test_parse_product_uses_supplementary_calories(self) -> None:
        """When the GA section has no calorie line, the product should get
        calorie data from the supplementary lookup keyed by URL slug."""
        html = """
        <html><head>
        <title>Lamb & Brown Rice Large Breed - Canadian Naturals</title>
        </head><body>
        <div class="single-team-details">
            <img src="https://canadiannaturals.com/wp-content/uploads/2024/03/dog-value-lamb-rice-large-breed-NoBG-600x600.png"
                 class="vc_single_image-img" />
            <div class="speaker-bio">
                <h3>Lamb & Brown Rice Recipe for Large Breed Dogs</h3>
                <p>Value Series</p>
            </div>
            <div class="speaker-bio" id="dog-vs-cr">
                <p><strong>Ingredients:</strong>Lamb meal, pearled barley, peas,
                oatmeal, flaxseed, canola oil, brown rice, pea protein.</p>
            </div>
            <div>Guaranteed Analysis:</div>
            <ul class="cbox double-column-list">
                <li>Protein 24%min</li>
                <li>Fat 12%min</li>
                <li>Fibre 3.8%max</li>
                <li>Moisture 10%max</li>
                <li>Omega-6 fatty acids 2.8%min</li>
                <li>Omega-3 fatty acids 2.4%min</li>
                <li>Glucosamine 800mg/kg min</li>
                <li>Chondroitin 400mg/kg min</li>
            </ul>
            <p>For dogs</p>
        </div>
        </body></html>
        """
        product = _parse_product(
            "https://canadiannaturals.com/team/lamb-rice-large-breed", html
        )
        assert product is not None
        assert product["name"] == "Lamb & Brown Rice Recipe for Large Breed Dogs"
        # Calorie content should come from supplementary data
        assert "calorie_content" in product
        assert "3551 kcal/kg" in product["calorie_content"]
        assert "378 kcal/cup" in product["calorie_content"]

    def test_supplementary_not_used_when_page_has_calories(self) -> None:
        """If the page already has calorie data, supplementary should NOT override."""
        product = _parse_product(
            "https://canadiannaturals.com/team/lamb-rice-large-breed",
            _FULL_PRODUCT_HTML,
        )
        assert product is not None
        # _FULL_PRODUCT_HTML has 3746 kcal/kg - page data takes priority
        assert "calorie_content" in product
        assert "3746 kcal/kg" in product["calorie_content"]
