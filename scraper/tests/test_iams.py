"""Tests for scrapers.iams — Iams/PetSmart parsing logic."""

from scrapers.iams import (
    _detect_breed_size,
    _detect_format,
    _detect_life_stage,
    _detect_type,
    _detect_sub_brand,
    _parse_calories,
    _parse_ga,
    _parse_ingredients,
)


# --- _detect_type / _detect_format ---


class TestDetectType:
    def test_dry_is_food(self):
        assert _detect_type("/dog/food/dry-food/iams-foo.html", "Adult Dry Food") == "food"

    def test_wet_is_food(self):
        assert _detect_type("/dog/food/canned-food/iams-foo.html", "Beef with Rice") == "food"

    def test_treats(self):
        assert _detect_type("/dog/treats/iams-foo.html", "Dog Treats") == "treat"

    def test_supplement(self):
        assert _detect_type("/dog/food/food-toppers/iams-foo.html", "Food Topper") == "supplement"


class TestDetectFormat:
    def test_dry_default(self):
        assert _detect_format("/dog/food/dry-food/iams-foo.html", "Adult Dry Food") == "dry"

    def test_wet_from_url(self):
        assert _detect_format("/dog/food/canned-food/iams-foo.html", "Beef with Rice") == "wet"

    def test_treats_are_dry(self):
        assert _detect_format("/dog/treats/iams-foo.html", "Dog Treats") == "dry"

    def test_toppers_are_wet(self):
        assert _detect_format("/dog/food/food-toppers/iams-foo.html", "Food Topper") == "wet"


# --- _detect_life_stage ---


class TestDetectLifeStage:
    def test_puppy(self):
        assert _detect_life_stage("Iams Puppy Large Breed") == "puppy"

    def test_senior(self):
        assert _detect_life_stage("Iams Healthy Aging Senior") == "senior"

    def test_adult(self):
        assert _detect_life_stage("Iams Proactive Health Adult Large Breed") == "adult"

    def test_none(self):
        assert _detect_life_stage("Iams Premium Food") is None


# --- _detect_breed_size ---


class TestDetectBreedSize:
    def test_large(self):
        assert _detect_breed_size("Large Breed Adult") == "Large"

    def test_small(self):
        assert _detect_breed_size("Small Breed Dog") == "Small"

    def test_medium(self):
        assert _detect_breed_size("Medium Breed Puppy") == "Medium"

    def test_none(self):
        assert _detect_breed_size("Adult Dog Food") is None


# --- _detect_sub_brand ---


class TestDetectSubBrand:
    def test_advanced_health(self):
        assert _detect_sub_brand("IAMS Advanced Health Adult") == "Advanced Health"

    def test_proactive_health(self):
        assert _detect_sub_brand("IAMS Proactive Health Large Breed") == "Proactive Health"

    def test_none(self):
        assert _detect_sub_brand("IAMS Premium Dry Food") is None


# --- _parse_ingredients ---


class TestParseIngredients:
    def test_basic(self):
        text = "Ingredients:\nChicken, Corn, Barley\nGuaranteed Analysis:"
        assert _parse_ingredients(text) == "Chicken, Corn, Barley"

    def test_inline(self):
        text = "Ingredients: Chicken, Corn, Barley"
        assert _parse_ingredients(text) == "Chicken, Corn, Barley"

    def test_none(self):
        assert _parse_ingredients("No ingredient data here") is None


# --- _parse_ga ---


class TestParseGa:
    def test_one_per_line(self):
        text = (
            "Guaranteed Analysis:\n"
            "Crude Protein (min.) 26.0%\n"
            "Crude Fat (min.) 14.0%\n"
            "Crude Fiber (max.) 4.0%\n"
            "Moisture (max.) 10.0%\n"
        )
        ga = _parse_ga(text)
        assert ga is not None
        assert ga["crude_protein_min"] == 26.0
        assert ga["crude_fat_min"] == 14.0
        assert ga["crude_fiber_max"] == 4.0
        assert ga["moisture_max"] == 10.0

    def test_semicolon_separated(self):
        """Iams wet food uses semicolons between GA values."""
        text = (
            "Guaranteed Analysis:\n"
            "Crude Protein (min.) 8.0%; Crude Fat (min.) 6.0%; "
            "Crude Fiber (max.) 1.0%; Moisture (max.) 78.0%; "
            "Omega-6 Fatty Acids* (min.) 0.8%"
        )
        ga = _parse_ga(text)
        assert ga is not None
        assert ga["crude_protein_min"] == 8.0
        assert ga["crude_fat_min"] == 6.0
        assert ga["crude_fiber_max"] == 1.0
        assert ga["moisture_max"] == 78.0
        assert ga["omega_6_min"] == 0.8

    def test_comma_separated(self):
        text = (
            "Guaranteed Analysis:\n"
            "Crude Protein (Min) 4.0%, Crude Fat (Min) 1.5%, "
            "Crude Fiber (Max) 4.0%, Moisture (Max) 84.0%"
        )
        ga = _parse_ga(text)
        assert ga is not None
        assert ga["crude_protein_min"] == 4.0
        assert ga["moisture_max"] == 84.0

    def test_mg_kg_excluded(self):
        """mg/kg values like Glucosamine should not be captured as percentages."""
        text = (
            "Crude Protein (min.) 26.0%\n"
            "Glucosamine* (min.) 400 mg/kg\n"
        )
        ga = _parse_ga(text)
        assert ga is not None
        assert ga["crude_protein_min"] == 26.0
        assert "glucosamine_min" not in ga

    def test_none(self):
        assert _parse_ga("No GA data here") is None


# --- _parse_calories ---


class TestParseCalories:
    def test_standard(self):
        text = "Caloric Content:\n3561 kcal ME/kg, 354 kcal ME/Cup"
        result = _parse_calories(text)
        assert result is not None
        assert "3561 kcal/kg" in result
        assert "354 kcal/cup" in result

    def test_can(self):
        text = "Caloric Content:\n800 kcal ME/kg, 295 kcal ME/can"
        result = _parse_calories(text)
        assert result is not None
        assert "800 kcal/kg" in result
        assert "295 kcal/can" in result

    def test_inline(self):
        text = "3664 kcal ME/kg, 373 kcal ME/Cup"
        result = _parse_calories(text)
        assert result is not None
        assert "3664 kcal/kg" in result

    def test_none(self):
        assert _parse_calories("No calorie data here") is None
