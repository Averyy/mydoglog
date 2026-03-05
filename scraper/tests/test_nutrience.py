"""Tests for scrapers.nutrience — Nutrience parsing logic."""

from scrapers.nutrience import (
    _detect_product_line,
    _detect_product_type,
    _parse_calorie_content,
    _parse_ga,
    _parse_images,
    _parse_ingredients,
    _parse_product,
    _parse_variants,
)
from bs4 import BeautifulSoup


class TestDetectProductLine:
    def test_subzero(self) -> None:
        assert _detect_product_line("Nutrience SubZero Canadian Pacific", "") == "SubZero"

    def test_infusion(self) -> None:
        assert _detect_product_line("Nutrience Infusion Chicken", "") == "Infusion"

    def test_care(self) -> None:
        assert _detect_product_line("Nutrience Care Sensitive Skin", "") == "Care"

    def test_original(self) -> None:
        assert _detect_product_line("Nutrience Original Adult", "") == "Original"

    def test_grain_free(self) -> None:
        assert _detect_product_line("Grain Free Turkey Chicken & Herring", "") == "Grain Free"

    def test_trattoria(self) -> None:
        assert _detect_product_line("Trattoria Tonno Con Riso", "") == "Trattoria"

    def test_homestyle(self) -> None:
        assert _detect_product_line("Homestyle Beef Stew", "") == "Homestyle"

    def test_limited_ingredient_is_subzero(self) -> None:
        assert _detect_product_line("Lamb & Pumpkin Limited Ingredient Dog Food", "") == "SubZero"

    def test_freeze_dried_is_subzero(self) -> None:
        assert _detect_product_line("Freeze-Dried Raw Beef & Pumpkin Dog Food", "") == "SubZero"

    def test_unknown(self) -> None:
        assert _detect_product_line("Nutrience Dog Food", "") is None


class TestDetectProductType:
    def test_dry(self) -> None:
        assert _detect_product_type("https://nutrience.com/products/subzero-canadian-pacific/", "SubZero Canadian Pacific") == "dry"

    def test_wet(self) -> None:
        assert _detect_product_type("https://nutrience.com/products/subzero-pate/", "SubZero Pâté") == "wet"

    def test_treats(self) -> None:
        assert _detect_product_type("https://nutrience.com/products/treats/", "Freeze Dried Treats") == "treats"

    def test_chew_is_treats(self) -> None:
        assert _detect_product_type("https://nutrience.com/products/elk-antler-chew/", "Elk Antler Chew") == "treats"

    def test_antler_is_treats(self) -> None:
        assert _detect_product_type("https://nutrience.com/products/antler-dog/", "Antler Dog") == "treats"

    def test_biscuit_is_treats(self) -> None:
        assert _detect_product_type("https://nutrience.com/products/dog-biscuit/", "Dog Biscuit") == "treats"

    def test_supplement(self) -> None:
        assert _detect_product_type("https://nutrience.com/products/calming-dog-supplement/", "Calming Dog Supplement") == "supplements"

    def test_freeze_dried_is_dry(self) -> None:
        assert _detect_product_type("https://nutrience.com/products/freeze-dried-raw-beef/", "Freeze-Dried Raw Beef") == "dry"


class TestParseIngredients:
    def test_extracts_from_accordion(self) -> None:
        """Primary path: p.title-acc accordion with div.inner sibling."""
        html = """
        <div class="content-accordion-ctn">
            <p class="title-acc js-accordion">Ingredients</p>
            <div class="inner">
                <p>Lamb, lamb meal, peas, lentils, chickpeas, pea protein, canola oil</p>
            </div>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_ingredients(soup)
        assert result is not None
        assert "Lamb" in result
        assert "canola oil" in result

    def test_extracts_from_accordion_no_inner_p(self) -> None:
        """Accordion where ingredient text is directly in the inner div."""
        html = """
        <div class="content-accordion-ctn">
            <p class="title-acc js-accordion">Ingredients</p>
            <div class="inner">
                Chicken, chicken meal, potatoes, peas, lentils, chickpeas
            </div>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_ingredients(soup)
        assert result is not None
        assert "Chicken" in result
        assert "chickpeas" in result

    def test_extracts_from_plain_p_with_div_sibling(self) -> None:
        """Secondary path: plain p element with text 'Ingredients' + div sibling."""
        html = """
        <div>
            <p>Ingredients</p>
            <div>
                <p>Salmon, cod, sole, rockfish, salmon meal, whitefish meal, peas, pea protein</p>
            </div>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_ingredients(soup)
        assert result is not None
        assert "Salmon" in result
        assert "pea protein" in result

    def test_extracts_single_ingredient(self) -> None:
        """Single-ingredient treats like freeze-dried beef liver (short text)."""
        html = """
        <div class="content-accordion-ctn">
            <p class="title-acc js-accordion">Ingredients</p>
            <div class="inner">
                <p>Beef Liver</p>
            </div>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_ingredients(soup)
        assert result is not None
        assert result == "Beef Liver"

    def test_extracts_single_ingredient_chicken(self) -> None:
        """Single-ingredient treats like freeze-dried chicken."""
        html = """
        <div class="content-accordion-ctn">
            <p class="title-acc js-accordion">Ingredients</p>
            <div class="inner">
                <p>Chicken</p>
            </div>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_ingredients(soup)
        assert result is not None
        assert result == "Chicken"

    def test_extracts_from_heading(self) -> None:
        """Tertiary path: heading-based search."""
        html = """
        <div>
            <h3>Ingredients</h3>
            <p>Salmon, cod, sole, rockfish, salmon meal, whitefish meal, peas, pea protein</p>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_ingredients(soup)
        assert result is not None
        assert "Salmon" in result
        assert "pea protein" in result


class TestParseGa:
    def test_standard_table(self) -> None:
        html = """
        <table>
            <tr><td>Crude protein min.</td><td>38.0%</td></tr>
            <tr><td>Crude fat min.</td><td>16.0%</td></tr>
            <tr><td>Crude fiber max.</td><td>5.0%</td></tr>
            <tr><td>Moisture max.</td><td>10.0%</td></tr>
        </table>
        """
        soup = BeautifulSoup(html, "html.parser")
        ga = _parse_ga(soup)
        assert ga is not None
        assert ga["crude_protein_min"] == 38.0
        assert ga["crude_fat_min"] == 16.0
        assert ga["crude_fiber_max"] == 5.0
        assert ga["moisture_max"] == 10.0


class TestParseCalorieContent:
    def test_standard_format(self) -> None:
        html = """
        <div>
            <p>Calorie Content (calculated): 3,731 kcal/kg or 486 kcal/cup ME</p>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        result = _parse_calorie_content(soup)
        assert result is not None
        assert "3731 kcal/kg" in result
        assert "486 kcal/cup" in result


class TestParseVariants:
    def test_with_sku(self) -> None:
        html = """
        <div>
            <p>Available sizes:</p>
            <p>1.8 kg(SKU-C2909)</p>
            <p>4.5 kg(SKU-C2910)</p>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        variants = _parse_variants(soup)
        assert len(variants) == 2
        assert variants[0]["size_kg"] == 1.8
        assert variants[0]["sku"] == "C2909"
        assert variants[1]["size_kg"] == 4.5

    def test_with_lbs(self) -> None:
        html = """
        <div>
            <p>Available in:</p>
            <p>5 lb bag</p>
            <p>25 lb bag</p>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        variants = _parse_variants(soup)
        assert len(variants) == 2
        assert variants[0]["size_kg"] < variants[1]["size_kg"]


class TestParseImages:
    def test_wp_content_images(self) -> None:
        html = """
        <div>
            <img src="https://nutrience.com/wp-content/uploads/2024/01/D6703-Product-Image-Front.png" alt="Product">
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        images = _parse_images(soup)
        assert len(images) == 1
        assert "Product-Image" in images[0]

    def test_skips_logos(self) -> None:
        html = """
        <div>
            <img src="https://nutrience.com/wp-content/uploads/2020/06/logo-care.png" alt="logo">
            <img src="https://nutrience.com/wp-content/uploads/2024/01/D6703-Product-Image-Front.png" alt="Product">
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        images = _parse_images(soup)
        assert len(images) == 1
        assert "logo" not in images[0].lower()

    def test_skips_banner_ratio_images(self) -> None:
        html = """
        <div>
            <img src="https://nutrience.com/wp-content/uploads/2024/01/banner-1200x300.jpg" alt="banner">
            <img src="https://nutrience.com/wp-content/uploads/2024/01/product-500x500.png" alt="Product">
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        images = _parse_images(soup)
        assert len(images) == 1
        assert "product-500x500" in images[0]

    def test_og_image_fallback(self) -> None:
        html = """
        <html>
        <head><meta property="og:image" content="https://nutrience.com/wp-content/uploads/product.jpg"></head>
        <body></body>
        </html>
        """
        soup = BeautifulSoup(html, "html.parser")
        images = _parse_images(soup)
        assert len(images) == 1
        assert "product.jpg" in images[0]

    def test_deduplicates(self) -> None:
        html = """
        <div>
            <img src="https://nutrience.com/wp-content/uploads/2024/01/product.png" alt="Product">
            <img src="https://nutrience.com/wp-content/uploads/2024/01/product.png" alt="Product again">
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        images = _parse_images(soup)
        assert len(images) == 1
