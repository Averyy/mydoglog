"""Tests for scrapers.hills_retail — Hill's Science Diet (PetSmart) scraper logic."""

from scrapers.hills_retail import (
    _FALLBACK_DATA,
    _PETSMART_TO_HILLS_CA,
    _supplement_from_hills_ca,
)
from scrapers.common import Product
from unittest.mock import patch, MagicMock


class TestPetSmartToHillsCaMapping:
    """Verify the URL pattern mapping table is consistent."""

    def test_all_slugs_are_nonempty(self) -> None:
        for ps_pattern, hills_slug in _PETSMART_TO_HILLS_CA.items():
            assert ps_pattern, "PetSmart pattern must not be empty"
            assert hills_slug, f"Hill's slug must not be empty for pattern: {ps_pattern}"

    def test_no_duplicate_petsmart_patterns(self) -> None:
        patterns = list(_PETSMART_TO_HILLS_CA.keys())
        assert len(patterns) == len(set(patterns)), "Duplicate PetSmart patterns found"


class TestManualProductData:
    """Verify the manual fallback data structure."""

    def test_all_entries_have_valid_structure(self) -> None:
        for pattern, data in _FALLBACK_DATA.items():
            assert isinstance(pattern, str) and pattern
            assert isinstance(data, dict) and data
            # Must have at least calorie or GA data
            assert data.get("calorie_content") or data.get("guaranteed_analysis"), \
                f"Manual entry {pattern} has no calorie_content or guaranteed_analysis"

    def test_calorie_content_format(self) -> None:
        for pattern, data in _FALLBACK_DATA.items():
            cal = data.get("calorie_content")
            if cal:
                assert "kcal/" in cal, f"Invalid calorie format for {pattern}: {cal}"

    def test_ga_fields_are_numeric(self) -> None:
        for pattern, data in _FALLBACK_DATA.items():
            ga = data.get("guaranteed_analysis")
            if ga:
                for key, value in ga.items():
                    assert isinstance(value, (int, float)), \
                        f"GA field {key} in {pattern} is not numeric: {value}"


class TestSupplementFromHillsCa:
    """Test the supplement function with mocked network calls."""

    def test_skips_when_all_products_have_data(self) -> None:
        products: list[Product] = [
            {
                "name": "Test Product",
                "url": "https://petsmart.ca/test",
                "guaranteed_analysis": {"crude_protein_min": 20.0},
                "calorie_content": "3500 kcal/kg",
                "brand": "Hill's",
                "variants": [],
            },
        ]
        result = _supplement_from_hills_ca(products)
        assert result == 0

    @patch("scrapers.hills_retail.SyncSession")
    def test_fills_from_manual_fallback(self, mock_session_cls: MagicMock) -> None:
        """Products not in Hill's CA map but in manual data get filled."""
        # Create a product matching a manual entry with missing data
        first_manual_pattern = next(iter(_FALLBACK_DATA))
        first_manual_data = _FALLBACK_DATA[first_manual_pattern]

        products: list[Product] = [
            {
                "name": "Test Manual Product",
                "url": f"https://petsmart.ca/dog/{first_manual_pattern}",
                "brand": "Hill's",
                "variants": [],
                # Missing GA and calories — should be filled from manual data
            },
        ]

        # Mock session to return 404 for Hill's CA (force manual fallback)
        mock_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.ok = False
        mock_resp.status_code = 404
        mock_session.get.return_value = mock_resp
        mock_session_cls.return_value.__enter__ = MagicMock(return_value=mock_session)
        mock_session_cls.return_value.__exit__ = MagicMock(return_value=False)

        result = _supplement_from_hills_ca(products)
        assert result >= 1

        if first_manual_data.get("calorie_content"):
            assert products[0].get("calorie_content") == first_manual_data["calorie_content"]
        if first_manual_data.get("guaranteed_analysis"):
            assert products[0].get("guaranteed_analysis") == first_manual_data["guaranteed_analysis"]
