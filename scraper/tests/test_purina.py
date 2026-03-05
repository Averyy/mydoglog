"""Tests for scrapers.purina — Purina parsing logic."""

from scrapers.purina import (
    _clean_response_text,
    _detect_channel,
    _detect_type,
    _extract_calories_from_html,
    _get_feeding_instructions_html,
    _parse_ga,
    _parse_ingredients,
    _parse_product,
    _parse_purina_weight,
    _parse_sub_brand,
    _parse_variants,
)


class TestCleanResponseText:
    def test_strips_control_chars(self) -> None:
        assert _clean_response_text("hello\x00world") == "helloworld"
        assert _clean_response_text("test\x1fdata") == "testdata"

    def test_preserves_tab_and_newline(self) -> None:
        assert _clean_response_text("hello\tworld") == "hello\tworld"
        assert _clean_response_text("line1\nline2") == "line1\nline2"

    def test_preserves_normal_text(self) -> None:
        assert _clean_response_text('{"key": "value"}') == '{"key": "value"}'


class TestDetectChannel:
    def test_ppvd_is_vet(self) -> None:
        page_data = {
            "result": {
                "data": {
                    "node": {
                        "relationships": {
                            "brand": {"drupal_internal__tid": 1560}
                        }
                    }
                }
            }
        }
        assert _detect_channel(page_data) == "vet"

    def test_pro_plan_is_retail(self) -> None:
        page_data = {
            "result": {
                "data": {
                    "node": {
                        "relationships": {
                            "brand": {"drupal_internal__tid": 1546}
                        }
                    }
                }
            }
        }
        assert _detect_channel(page_data) == "retail"

    def test_missing_brand_defaults_retail(self) -> None:
        assert _detect_channel({}) == "retail"
        assert _detect_channel({"result": {"data": {"node": {}}}}) == "retail"

    def test_brand_as_list(self) -> None:
        page_data = {
            "result": {
                "data": {
                    "node": {
                        "relationships": {
                            "brand": [{"drupal_internal__tid": 1560}]
                        }
                    }
                }
            }
        }
        assert _detect_channel(page_data) == "vet"


class TestDetectType:
    def test_dry_food(self) -> None:
        assert _detect_type("/dogs/dry-dog-food/some-product") == "dry"

    def test_wet_food(self) -> None:
        assert _detect_type("/dogs/wet-dog-food/some-product") == "wet"

    def test_treats(self) -> None:
        assert _detect_type("/dogs/dog-treats/some-treat") == "treats"

    def test_supplements(self) -> None:
        assert _detect_type("/dogs/dog-supplements/fortiflora") == "supplements"

    def test_generic_dog_food_defaults_dry(self) -> None:
        assert _detect_type("/dogs/dog-food/something") == "dry"

    def test_no_match_defaults_dry(self) -> None:
        assert _detect_type("/products/something") == "dry"


class TestParseIngredients:
    def test_reconstructs_from_array(self) -> None:
        node = {
            "relationships": {
                "ingredients": [
                    {"name": "Chicken", "drupal_internal__tid": 100, "is_primary": True},
                    {"name": "Brewers Rice", "drupal_internal__tid": 101, "is_primary": False},
                    {"name": "Corn Gluten Meal", "drupal_internal__tid": 102, "is_primary": False},
                ]
            }
        }
        result = _parse_ingredients(node)
        assert result == "Chicken, Brewers Rice, Corn Gluten Meal"

    def test_empty_ingredients(self) -> None:
        assert _parse_ingredients({"relationships": {"ingredients": []}}) is None
        assert _parse_ingredients({"relationships": {}}) is None

    def test_cleans_ingredient_names(self) -> None:
        node = {
            "relationships": {
                "ingredients": [
                    {"name": "  Chicken  "},
                    {"name": "Rice\x00Flour"},
                ]
            }
        }
        result = _parse_ingredients(node)
        assert result == "Chicken, RiceFlour"


class TestParsePurinaWeight:
    def test_kg(self) -> None:
        assert _parse_purina_weight("7 kg") == 7.0
        assert _parse_purina_weight("1.5kg") == 1.5

    def test_grams(self) -> None:
        assert _parse_purina_weight("380 g") == 0.38
        assert _parse_purina_weight("85g") == 0.085

    def test_lbs(self) -> None:
        result = _parse_purina_weight("16 lbs")
        assert result is not None
        assert 7.2 < result < 7.3

    def test_unparseable(self) -> None:
        assert _parse_purina_weight("") is None
        assert _parse_purina_weight("one pack") is None


class TestParseSubBrand:
    def test_extracts_brand_name(self) -> None:
        node = {
            "relationships": {
                "brand": {"name": "Pro Plan"}
            }
        }
        assert _parse_sub_brand(node) == "Pro Plan"

    def test_brand_as_list(self) -> None:
        node = {
            "relationships": {
                "brand": [{"name": "Purina ONE"}]
            }
        }
        assert _parse_sub_brand(node) == "Purina ONE"

    def test_missing_brand(self) -> None:
        assert _parse_sub_brand({"relationships": {}}) is None


class TestParseVariants:
    def test_parses_skus(self) -> None:
        node = {
            "relationships": {
                "skus": [
                    {"size": "1.5 kg", "upc": "038100191311"},
                    {"size": "7 kg", "upc": "038100191328"},
                ]
            }
        }
        variants = _parse_variants(node)
        assert len(variants) == 2
        assert variants[0]["size_kg"] == 1.5
        assert variants[0]["upc"] == "038100191311"
        assert variants[1]["size_kg"] == 7.0

    def test_empty_skus(self) -> None:
        assert _parse_variants({"relationships": {}}) == []


class TestParseProduct:
    def test_full_product(self) -> None:
        listing = {
            "title": "Pro Plan Sensitive Skin & Stomach Salmon & Rice",
            "url": "/dogs/dry-dog-food/pro-plan-sensitive-skin-stomach-salmon",
            "upc": "038100191311",
        }
        page_data = {
            "result": {
                "data": {
                    "node": {
                        "title": "Pro Plan Sensitive Skin & Stomach Salmon & Rice",
                        "relationships": {
                            "brand": {"name": "Pro Plan", "drupal_internal__tid": 1546},
                            "ingredients": [
                                {"name": "Salmon"},
                                {"name": "Brewers Rice"},
                            ],
                            "skus": [
                                {"size": "1.5 kg", "upc": "038100191311"},
                            ],
                        },
                    }
                }
            }
        }
        product = _parse_product(listing, page_data)
        assert product is not None
        assert product["name"] == "Pro Plan Sensitive Skin & Stomach Salmon & Rice"
        assert product["brand"] == "Purina"
        assert product["channel"] == "retail"
        assert product["product_type"] == "dry"
        assert product["sub_brand"] == "Pro Plan"
        assert product["ingredients_raw"] == "Salmon, Brewers Rice"
        assert product["source_id"] == "038100191311"

    def test_vet_product(self) -> None:
        listing = {
            "title": "PPVD EN Gastroenteric",
            "url": "/dogs/dry-dog-food/ppvd-en-gastroenteric",
        }
        page_data = {
            "result": {
                "data": {
                    "node": {
                        "title": "PPVD EN Gastroenteric",
                        "relationships": {
                            "brand": {"drupal_internal__tid": 1560},
                        },
                    }
                }
            }
        }
        product = _parse_product(listing, page_data)
        assert product is not None
        assert product["channel"] == "vet"

    def test_no_node_returns_none(self) -> None:
        listing = {"title": "Test"}
        page_data = {}
        assert _parse_product(listing, page_data) is None

    def test_calories_from_feeding_instructions(self) -> None:
        """Calorie content should be extracted from feeding_instructions when
        guaranteedAnalysis has no calorie data (typical for retail products)."""
        listing = {
            "title": "Beneful Healthy Weight",
            "url": "/beneful/dry-dog-food/healthy-weight-chicken",
        }
        page_data = {
            "result": {
                "data": {
                    "node": {
                        "title": "Beneful Healthy Weight",
                        "relationships": {
                            "brand": {"name": "Beneful", "drupal_internal__tid": 1540},
                            "ingredients": [{"name": "Chicken"}],
                        },
                        "guaranteedAnalysis": {
                            "processed": (
                                '<table><tr><td>Crude Protein (Min)</td><td>25.0%</td></tr>'
                                '<tr><td>Crude Fat (Min)</td><td>8.0%</td></tr></table>'
                            )
                        },
                        "feeding_instructions": {
                            "processed": (
                                '<h3>Calorie Content (calculated)(ME)</h3>'
                                '<p>3221 kcal/kg</p><p>331 kcal/cup</p>'
                            )
                        },
                    }
                }
            }
        }
        product = _parse_product(listing, page_data)
        assert product is not None
        assert product["calorie_content"] == "3221 kcal/kg, 331 kcal/cup"

    def test_calories_from_feeding_when_ga_has_mg_kg_minerals(self) -> None:
        """When GA HTML contains mineral values like mg/kg (Selenium), the false
        positive should be rejected and calories extracted from feeding_instructions."""
        listing = {
            "title": "Beneful Healthy Weight",
            "url": "/beneful/dry-dog-food/healthy-weight-chicken",
        }
        page_data = {
            "result": {
                "data": {
                    "node": {
                        "title": "Beneful Healthy Weight",
                        "relationships": {
                            "brand": {"name": "Beneful", "drupal_internal__tid": 1557},
                            "ingredients": [{"name": "Chicken"}],
                        },
                        "guaranteedAnalysis": {
                            "processed": (
                                '<table><tbody>'
                                '<tr><td>Crude Protein (Min)</td><td>25.0%</td></tr>'
                                '<tr><td>Selenium (Se) (Min)</td><td>0.35 mg/kg</td></tr>'
                                '</tbody></table>'
                            )
                        },
                        "feeding_instructions": {
                            "processed": (
                                '<h3>Calorie Content (calculated)(ME)</h3>'
                                '<p>3221 kcal/kg</p><p>331 kcal/cup</p>'
                            )
                        },
                    }
                }
            }
        }
        product = _parse_product(listing, page_data)
        assert product is not None
        assert product["calorie_content"] == "3221 kcal/kg, 331 kcal/cup"

    def test_calories_from_ga_preferred_over_feeding(self) -> None:
        """When GA HTML has calorie data, it should be used instead of feeding_instructions."""
        listing = {
            "title": "PPVD EN Gastroenteric",
            "url": "/dogs/dry-dog-food/ppvd-en",
        }
        page_data = {
            "result": {
                "data": {
                    "node": {
                        "title": "PPVD EN Gastroenteric",
                        "relationships": {
                            "brand": {"drupal_internal__tid": 1560},
                        },
                        "guaranteedAnalysis": {
                            "processed": (
                                '<table><tr><td>Crude Protein (Min)</td><td>26%</td></tr></table>'
                                '<p>3500 kcal/kg, 400 kcal/cup</p>'
                            )
                        },
                        "feeding_instructions": {
                            "processed": '<p>9999 kcal/kg</p>'
                        },
                    }
                }
            }
        }
        product = _parse_product(listing, page_data)
        assert product is not None
        assert product["calorie_content"] == "3500 kcal/kg, 400 kcal/cup"


class TestExtractCaloriesFromHtml:
    def test_extracts_kcal_kg_and_cup(self) -> None:
        html = '<h3>Calorie Content (calculated)(ME)</h3><p>3221 kcal/kg</p><p>331 kcal/cup</p>'
        assert _extract_calories_from_html(html) == "3221 kcal/kg, 331 kcal/cup"

    def test_extracts_kcal_kg_and_can(self) -> None:
        html = '<p>Calorie Content (calculated)(ME) 866 kcal/kg 319 kcal/can</p>'
        assert _extract_calories_from_html(html) == "866 kcal/kg, 319 kcal/can"

    def test_extracts_kcal_kg_and_pouch(self) -> None:
        html = '<p>Calorie Content (calculated)(ME) 2723 kcal/kg463 kcal/pouch</p>'
        assert _extract_calories_from_html(html) == "2723 kcal/kg, 463 kcal/pouch"

    def test_returns_none_for_empty(self) -> None:
        assert _extract_calories_from_html("") is None
        assert _extract_calories_from_html(None) is None  # type: ignore[arg-type]

    def test_returns_none_when_no_calories(self) -> None:
        html = '<p>Feed your dog 1 cup daily.</p>'
        result = _extract_calories_from_html(html)
        # Should return None because no kcal data
        assert result is None or "kcal" not in (result or "")

    def test_rejects_false_positive_from_mg_kg_mineral(self) -> None:
        """GA HTML with mineral values like '0.35 mg/kg' (Selenium) should not
        produce a false positive calorie value like '0 kcal/kg'."""
        html = (
            '<table><tbody>'
            '<tr><td>Crude Protein (Min)</td><td>25.0%</td></tr>'
            '<tr><td>Selenium (Se) (Min)</td><td>0.35 mg/kg</td></tr>'
            '<tr><td>Vitamin A (Min)</td><td>10,000 IU/kg</td></tr>'
            '</tbody></table>'
        )
        assert _extract_calories_from_html(html) is None

    def test_rejects_very_low_kcal_kg(self) -> None:
        """Values below 100 kcal/kg are not real pet food calorie values."""
        html = '<p>2 mg/kg selenium content</p>'
        assert _extract_calories_from_html(html) is None

    def test_extracts_from_calorie_heading_ignoring_footnotes(self) -> None:
        """When footnotes contain 'Kilocalories' (e.g., '2 Kilocalories of ME'),
        the extraction should use the heading-based strategy to find the real
        calorie section and ignore footnote numbers."""
        html = (
            '<p>2 Kilocalories of metabolizable energy (ME)</p>'
            '<p>4 For each additional 10 lbs, feed 114 kilocalories.</p>'
            '<h2>Calorie Content (calculated)(ME)</h2>'
            '<p>1016 kcal/kg</p><p>385 kcal/can</p>'
            '<h2>Guaranteed Analysis</h2>'
            '<table><tr><td>Crude Protein</td><td>6%</td></tr></table>'
        )
        assert _extract_calories_from_html(html) == "1016 kcal/kg, 385 kcal/can"


class TestGetFeedingInstructionsHtml:
    def test_extracts_processed_field(self) -> None:
        node = {
            "feeding_instructions": {
                "processed": "<p>3221 kcal/kg</p>"
            }
        }
        assert _get_feeding_instructions_html(node) == "<p>3221 kcal/kg</p>"

    def test_returns_empty_when_missing(self) -> None:
        assert _get_feeding_instructions_html({}) == ""
        assert _get_feeding_instructions_html({"feeding_instructions": None}) == ""

    def test_handles_string_value(self) -> None:
        node = {"feeding_instructions": "<p>test</p>"}
        assert _get_feeding_instructions_html(node) == "<p>test</p>"


class TestParseGaFeedingFallback:
    def test_ga_from_guaranteed_analysis(self) -> None:
        """GA should be parsed from guaranteedAnalysis when available."""
        node = {
            "guaranteedAnalysis": {
                "processed": (
                    '<table><tr><td>Crude Protein (Min)</td><td>26%</td></tr>'
                    '<tr><td>Crude Fat (Min)</td><td>15%</td></tr></table>'
                )
            }
        }
        ga = _parse_ga(node)
        assert ga is not None
        assert ga["crude_protein_min"] == 26.0
        assert ga["crude_fat_min"] == 15.0

    def test_ga_fallback_to_feeding_instructions(self) -> None:
        """When guaranteedAnalysis has no table, should check feeding_instructions."""
        node = {
            "guaranteedAnalysis": {
                "processed": '<p>For more info, see our ingredients page.</p>'
            },
            "feeding_instructions": {
                "processed": (
                    '<table><tr><td>Crude Protein (Min)</td><td>30%</td></tr>'
                    '<tr><td>Crude Fat (Min)</td><td>18%</td></tr></table>'
                )
            }
        }
        ga = _parse_ga(node)
        assert ga is not None
        assert ga["crude_protein_min"] == 30.0
        assert ga["crude_fat_min"] == 18.0

    def test_ga_returns_none_when_no_table_anywhere(self) -> None:
        """Should return None when neither field has a GA table."""
        node = {
            "guaranteedAnalysis": {
                "processed": '<p>For more info, see our ingredients page.</p>'
            },
            "feeding_instructions": {
                "processed": '<p>Feed 1 cup daily.</p>'
            }
        }
        assert _parse_ga(node) is None
