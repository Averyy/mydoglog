"""Tests for scrapers.performatrin — Performatrin parsing logic."""

from bs4 import BeautifulSoup

from scrapers.performatrin import (
    _detect_product_type,
    _detect_sub_brand,
    _get_tab_content,
    _is_cat_product,
    _parse_calorie_content,
    _parse_ga,
    _parse_images,
    _parse_ingredients,
    _parse_product,
)


def _make_page_html(
    *,
    h1: str = "Performatrin Ultra Grain Free Original Recipe Dog Food",
    tabs: dict[str, str] | None = None,
    og_image: str = "",
    preload_images: list[str] | None = None,
) -> str:
    """Build a realistic PetValu product page fixture.

    tabs: dict mapping tab name → content HTML (e.g., {"ingredients": "...", "guaranteed analysis": "..."})
    preload_images: list of image URLs to add as <link rel="preload" as="image">
    """
    parts = [f"<h1>{h1}</h1>"]

    if tabs:
        # Build nav + imported-html divs
        buttons = "".join(f"<button>{name}</button>" for name in tabs)
        parts.append(f"<nav>{buttons}</nav>")
        for content in tabs.values():
            parts.append(f'<div class="imported-html">{content}</div>')

    head_parts: list[str] = []
    if og_image:
        head_parts.append(f'<meta property="og:image" content="{og_image}">')
    if preload_images:
        for img_url in preload_images:
            head_parts.append(f'<link rel="preload" as="image" href="{img_url}">')

    return f"<html><head>{''.join(head_parts)}</head><body>{''.join(parts)}</body></html>"


_INGREDIENTS_TEXT = (
    "Chicken, Chicken Meal, Sweet Potatoes, Peas, Pea Starch, "
    "Chicken Fat (Preserved With Mixed Tocopherols), Flaxseed"
)

_GA_TEXT = """<p>
Crude Protein (min.) 30.0%<br>
Crude Fat (min.) 18.0%<br>
Crude Fibre (max.) 4.0%<br>
Moisture (max.) 10.0%<br>
Omega-6 Fatty Acids* (min.) 2.80%<br>
Omega-3 Fatty Acids* (min.) 0.50%<br>
</p>
<p>Calorie Content: 3,800 kcal/kg; 405 kcal/cup</p>"""

_GA_TEXT_WET = """<p>
Crude Protein (min.) 10.0%<br>
Crude Fat (min.) 6.0%<br>
Crude Fibre (max.) 1.5%<br>
Moisture (max.) 78.0%<br>
</p>
<p>Calorie Content: 1,100 kcal/kg; 319 kcal/can</p>"""


# --- _is_cat_product ---


class TestIsCatProduct:
    def test_dog_product(self):
        assert _is_cat_product(
            "https://petvalu.ca/product/performatrin-ultra-original-recipe-dog-food/FCM06331",
            "Performatrin Ultra Grain Free Original Recipe Dog Food",
        ) is False

    def test_cat_food_in_title(self):
        assert _is_cat_product(
            "https://petvalu.ca/product/performatrin-ultra-cat-food/FCM123",
            "Performatrin Ultra Grain Free Original Recipe Cat Food",
        ) is True

    def test_cat_in_url(self):
        assert _is_cat_product(
            "https://petvalu.ca/product/performatrin-ultra-adult-cat-food/FCM123",
            "Performatrin Ultra Adult Food",
        ) is True


# --- _detect_product_type ---


class TestDetectProductType:
    def test_dry_default(self):
        assert _detect_product_type(
            "https://petvalu.ca/product/performatrin-ultra-original-recipe-dog-food/FCM06331",
            "Performatrin Ultra Original Recipe Dog Food",
        ) == "dry"

    def test_wet_stew(self):
        assert _detect_product_type(
            "https://petvalu.ca/product/performatrin-ultra-beef-stew-dog-food/FCM06728",
            "Performatrin Ultra Grain Free Beef Stew Dog Food",
        ) == "wet"

    def test_wet_pate(self):
        assert _detect_product_type(
            "https://petvalu.ca/product/performatrin-ultra-chicken-pate/FCM06734",
            "Performatrin Ultra Chicken Pate Dog Food",
        ) == "wet"

    def test_treats(self):
        assert _detect_product_type(
            "https://petvalu.ca/product/performatrin-treats/FCM123",
            "Performatrin Dog Treats",
        ) == "treats"


# --- _detect_sub_brand ---


class TestDetectSubBrand:
    def test_ultra(self):
        assert _detect_sub_brand("Performatrin Ultra Grain Free") == "Performatrin Ultra"

    def test_prime(self):
        assert _detect_sub_brand("Performatrin Prime Chicken Rice") == "Performatrin Prime"

    def test_naturals(self):
        assert _detect_sub_brand("Performatrin Naturals Beef Barley") == "Performatrin Naturals"

    def test_base(self):
        assert _detect_sub_brand("Performatrin Adult Dog Food") == "Performatrin"


# --- _get_tab_content ---


class TestGetTabContent:
    def test_maps_tabs_by_position(self):
        html = _make_page_html(
            tabs={
                "Description": "<p>A great product</p>",
                "Ingredients": f"<p>{_INGREDIENTS_TEXT}</p>",
                "Guaranteed Analysis": _GA_TEXT,
            }
        )
        soup = BeautifulSoup(html, "lxml")
        tabs = _get_tab_content(soup)
        assert "description" in tabs
        assert "ingredients" in tabs
        assert "guaranteed analysis" in tabs

    def test_no_nav_returns_empty(self):
        html = "<html><body><h1>Test</h1></body></html>"
        soup = BeautifulSoup(html, "lxml")
        assert _get_tab_content(soup) == {}


# --- _parse_ingredients ---


class TestParseIngredients:
    def test_from_tab(self):
        html = _make_page_html(
            tabs={
                "Description": "<p>Info</p>",
                "Ingredients": f"<p>{_INGREDIENTS_TEXT}</p>",
            }
        )
        soup = BeautifulSoup(html, "lxml")
        result = _parse_ingredients(soup)
        assert result is not None
        assert "Chicken" in result
        assert "Flaxseed" in result

    def test_no_tab_returns_none(self):
        html = _make_page_html()
        soup = BeautifulSoup(html, "lxml")
        assert _parse_ingredients(soup) is None

    def test_strips_ingredients_prefix(self):
        html = _make_page_html(
            tabs={"Ingredients": f"<p>Ingredients: {_INGREDIENTS_TEXT}</p>"}
        )
        soup = BeautifulSoup(html, "lxml")
        result = _parse_ingredients(soup)
        assert result is not None
        assert not result.startswith("Ingredients")


# --- _parse_ga ---


class TestParseGa:
    def test_standard_ga(self):
        html = _make_page_html(
            tabs={"Guaranteed Analysis": _GA_TEXT}
        )
        soup = BeautifulSoup(html, "lxml")
        result = _parse_ga(soup)
        assert result is not None
        assert result["crude_protein_min"] == 30.0
        assert result["crude_fat_min"] == 18.0
        assert result["crude_fiber_max"] == 4.0
        assert result["moisture_max"] == 10.0
        assert result["omega_6_min"] == 2.80
        assert result["omega_3_min"] == 0.50

    def test_no_tab_returns_none(self):
        html = _make_page_html()
        soup = BeautifulSoup(html, "lxml")
        assert _parse_ga(soup) is None


# --- _parse_calorie_content ---


class TestParseCalorieContent:
    def test_dry_food_calories(self):
        html = _make_page_html(
            tabs={"Guaranteed Analysis": _GA_TEXT}
        )
        soup = BeautifulSoup(html, "lxml")
        result = _parse_calorie_content(soup)
        assert result is not None
        assert "3800 kcal/kg" in result
        assert "405 kcal/cup" in result

    def test_wet_food_calories(self):
        html = _make_page_html(
            tabs={"Guaranteed Analysis": _GA_TEXT_WET}
        )
        soup = BeautifulSoup(html, "lxml")
        result = _parse_calorie_content(soup)
        assert result is not None
        assert "1100 kcal/kg" in result
        assert "319 kcal/can" in result

    def test_no_tab_returns_none(self):
        html = _make_page_html()
        soup = BeautifulSoup(html, "lxml")
        assert _parse_calorie_content(soup) is None


# --- _parse_images ---


class TestParseImages:
    def test_og_image(self):
        html = _make_page_html(og_image="https://pvimages-prod.azureedge.net/FCM06327_p1.jpg")
        soup = BeautifulSoup(html, "lxml")
        result = _parse_images(soup)
        assert result == ["https://pvimages-prod.azureedge.net/FCM06327_p1.jpg"]

    def test_preload_fallback_when_no_og_image(self):
        html = _make_page_html(
            preload_images=[
                "//images.ctfassets.net/logo.svg",
                "https://pvimages-prod.azureedge.net/FCM05496_p1.jpg?w=450&h=450",
            ],
        )
        soup = BeautifulSoup(html, "lxml")
        result = _parse_images(soup)
        assert len(result) == 1
        assert result[0] == "https://pvimages-prod.azureedge.net/FCM05496_p1.jpg"

    def test_og_image_preferred_over_preload(self):
        html = _make_page_html(
            og_image="https://pvimages-prod.azureedge.net/FCM06327_p1.jpg",
            preload_images=["https://pvimages-prod.azureedge.net/FCM06327_p1.jpg?w=450&h=450"],
        )
        soup = BeautifulSoup(html, "lxml")
        result = _parse_images(soup)
        # Should use og:image, not fall through to preload
        assert result == ["https://pvimages-prod.azureedge.net/FCM06327_p1.jpg"]

    def test_no_images(self):
        html = _make_page_html()
        soup = BeautifulSoup(html, "lxml")
        result = _parse_images(soup)
        assert result == []

    def test_preload_non_pvimages_ignored(self):
        html = _make_page_html(
            preload_images=["//images.ctfassets.net/logo.svg"],
        )
        soup = BeautifulSoup(html, "lxml")
        result = _parse_images(soup)
        assert result == []


# --- _parse_product (integration) ---


class TestParseProduct:
    def test_full_dry_product(self):
        html = _make_page_html(
            h1="Performatrin Ultra Grain Free Original Recipe Dog Food",
            tabs={
                "Description": "<p>Premium dog food</p>",
                "Ingredients": f"<p>{_INGREDIENTS_TEXT}</p>",
                "Guaranteed Analysis": _GA_TEXT,
            },
            og_image="https://petvalu.ca/images/product.jpg",
        )
        result = _parse_product(
            "https://petvalu.ca/product/performatrin-ultra-original-recipe-dog-food/FCM06331",
            html,
        )
        assert result is not None
        assert result["name"] == "Performatrin Ultra Grain Free Original Recipe Dog Food"
        assert result["brand"] == "Performatrin"
        assert result["channel"] == "retail"
        assert result["product_type"] == "dry"
        assert result["sub_brand"] == "Performatrin Ultra"
        assert "ingredients_raw" in result
        assert "guaranteed_analysis" in result
        assert "calorie_content" in result
        assert "images" in result

    def test_wet_product(self):
        html = _make_page_html(
            h1="Performatrin Ultra Grain Free Chicken Pate Dog Food",
            tabs={
                "Ingredients": f"<p>{_INGREDIENTS_TEXT}</p>",
                "Guaranteed Analysis": _GA_TEXT_WET,
            },
        )
        result = _parse_product(
            "https://petvalu.ca/product/performatrin-ultra-chicken-pate/FCM06734",
            html,
        )
        assert result is not None
        assert result["product_type"] == "wet"

    def test_cat_product_filtered(self):
        html = _make_page_html(
            h1="Performatrin Ultra Grain Free Original Recipe Cat Food",
        )
        result = _parse_product(
            "https://petvalu.ca/product/performatrin-ultra-cat-food/FCM123",
            html,
        )
        assert result is None

    def test_no_h1_returns_none(self):
        html = "<html><body><p>No heading</p></body></html>"
        assert _parse_product("https://petvalu.ca/product/test/FCM123", html) is None


class TestKnownMissingCalories:
    """Products where PetValu genuinely omits calorie data from the GA tab.

    Verified 2026-03-01 against petvalu.ca AND petsupermarket.com (US).
    These pages have full GA percentages but no calorie line anywhere.
    """

    _GA_NO_CALORIES = """<p>
Crude Protein (min.) 35.0%<br>
Crude Fat (min.) 15.0%<br>
Crude Fiber (max.) 5.0%<br>
Moisture (max.) 10.0%<br>
Omega-6 Fatty Acids* (min.) 2.25%<br>
Omega-3 Fatty Acids* (min.) 0.75%<br>
</p>"""

    def test_ga_parsed_but_no_calories(self):
        """GA values should parse fine even when calorie line is absent."""
        html = _make_page_html(
            h1="Performatrin Ultra Grain-Free Hillside Recipe Dog Food",
            tabs={
                "Ingredients": "<p>Turkey, Salmon Meal, Turkey Meal, Tapioca</p>",
                "Guaranteed Analysis": self._GA_NO_CALORIES,
            },
        )
        result = _parse_product(
            "https://petvalu.ca/product/performatrin-ultra-grain-free-hillside-recipe-dog-food/FCM07191",
            html,
        )
        assert result is not None
        assert result["name"] == "Performatrin Ultra Grain-Free Hillside Recipe Dog Food"
        assert "guaranteed_analysis" in result
        assert result["guaranteed_analysis"]["crude_protein_min"] == 35.0
        assert result["guaranteed_analysis"]["crude_fat_min"] == 15.0
        # Calorie content should be absent — this is expected
        assert "calorie_content" not in result

    def test_product_still_valid_without_calories(self):
        """Products without calorie data should still be included in results."""
        html = _make_page_html(
            h1="Performatrin Ultra Wholesome Grains Meadow Recipe Dog Food",
            tabs={
                "Ingredients": "<p>Lamb, Herring Meal, Oatmeal, Pearled Barley</p>",
                "Guaranteed Analysis": self._GA_NO_CALORIES,
            },
        )
        result = _parse_product(
            "https://petvalu.ca/product/performatrin-ultra-wholesome-grains-meadow-recipe-dog-food/FCM06327",
            html,
        )
        assert result is not None
        assert result["brand"] == "Performatrin"
        assert result["sub_brand"] == "Performatrin Ultra"
        assert "ingredients_raw" in result
        assert "guaranteed_analysis" in result
        assert "calorie_content" not in result
