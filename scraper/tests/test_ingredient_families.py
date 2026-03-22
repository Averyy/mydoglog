"""Tests for ingredient_families.json — verifies completeness, consistency, and correctness."""

import json
import os
import re
import pytest
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
BRANDS_DIR = DATA_DIR / "brands"
FAMILIES_PATH = DATA_DIR / "ingredient_families.json"
MANUAL_PATH = DATA_DIR / "manual_products.json"

VALID_SOURCE_GROUPS = {
    "poultry", "red_meat", "fish", "grain", "legume", "root", "fruit",
    "vegetable", "dairy", "egg", "seed", "other", "mammal",
    "fiber", "additive", "mollusk", "crustacean", "animal", "insect", "unknown",
}

VALID_FORMS = {
    "raw", "meal", "by_product", "fat", "oil", "hydrolyzed", "flour",
    "bran", "whole", "organ", "dried", "concentrate", "starch", "fiber",
    "broth", "gluten", "derivative", "ground", "extract", "gelatin",
    "plasma", "digest", "bone", "cartilage", "heart", "liver", "skin",
    "deboned", "dehydrated", "canned", "fresh", "frozen", "smoked",
    "fermented", "sprouted", "toasted", "roasted", "steamed", "baked",
    "freeze_dried", "air_dried", "powder", "paste", "juice", "puree",
}


def parse_ingredients(raw: str) -> list[str]:
    """Bracket-aware comma splitting."""
    if not raw:
        return []
    ingredients = []
    current = []
    depth = 0
    for char in raw:
        if char in "([":
            depth += 1
            current.append(char)
        elif char in ")]":
            depth -= 1
            current.append(char)
        elif char == "," and depth == 0:
            ing = "".join(current).strip().rstrip(".")
            if ing:
                ingredients.append(ing)
            current = []
        else:
            current.append(char)
    ing = "".join(current).strip().rstrip(".")
    if ing:
        ingredients.append(ing)
    return ingredients


@pytest.fixture(scope="module")
def families_data() -> dict:
    with open(FAMILIES_PATH) as f:
        return json.load(f)


@pytest.fixture(scope="module")
def all_product_ingredients() -> set[str]:
    """Extract every unique ingredient from all brand JSONs + manual products."""
    ingredients = set()
    for brand_file in sorted(BRANDS_DIR.glob("*.json")):
        with open(brand_file) as f:
            data = json.load(f)
        for product in data.get("products", []):
            raw = product.get("ingredients_raw", "")
            if raw:
                for ing in parse_ingredients(raw):
                    ingredients.add(ing)
    if MANUAL_PATH.exists():
        with open(MANUAL_PATH) as f:
            data = json.load(f)
        for product in data.get("products", []):
            raw = product.get("ingredients_raw", "")
            if raw:
                for ing in parse_ingredients(raw):
                    ingredients.add(ing)
    return ingredients


@pytest.fixture(scope="module")
def ignore_patterns(families_data: dict) -> list[re.Pattern[str]]:
    """Compile ignore patterns from JSON."""
    return [re.compile(p, re.IGNORECASE) for p in families_data.get("ignore_patterns", [])]


@pytest.fixture(scope="module")
def lookup(families_data: dict) -> dict[str, tuple[str, str]]:
    """Build case-insensitive lookup: lowercase -> (section, name)."""
    lk = {}
    for fam_name, fam in families_data["families"].items():
        for member in fam.get("members", {}):
            lk[member.lower()] = ("family", fam_name)
    for amb in families_data["ambiguous"]:
        lk[amb.lower()] = ("ambiguous", amb)
    for ign in families_data["ignore_for_correlation"]:
        lk[ign.lower()] = ("ignore", ign)
    return lk


def _is_classified(
    ing: str,
    lookup: dict[str, tuple[str, str]],
    patterns: list[re.Pattern[str]],
) -> bool:
    """Check if ingredient is in lookup or matched by an ignore pattern."""
    if ing.lower().strip() in lookup:
        return True
    for p in patterns:
        if p.search(ing):
            return True
    return False


class TestCoverage:
    """Every scraped ingredient must be classifiable."""

    def test_every_ingredient_can_be_looked_up(
        self,
        all_product_ingredients: set[str],
        lookup: dict,
        ignore_patterns: list[re.Pattern[str]],
    ) -> None:
        unmatched = []
        for ing in all_product_ingredients:
            if not _is_classified(ing, lookup, ignore_patterns):
                unmatched.append(ing)
        assert unmatched == [], (
            f"{len(unmatched)} unhandled ingredients: {unmatched[:20]}"
        )

    def test_less_than_5_percent_unknown(
        self,
        all_product_ingredients: set[str],
        lookup: dict,
        ignore_patterns: list[re.Pattern[str]],
    ) -> None:
        total = len(all_product_ingredients)
        unmatched = sum(
            1 for ing in all_product_ingredients
            if not _is_classified(ing, lookup, ignore_patterns)
        )
        pct = (unmatched / total) * 100 if total > 0 else 0
        assert pct < 5, f"{pct:.1f}% unmatched (target <5%)"


class TestFamilyStructure:
    """Families have valid structure and source_groups."""

    def test_all_families_have_source_group(self, families_data: dict) -> None:
        missing = []
        for fam_name, fam in families_data["families"].items():
            if "source_group" not in fam:
                missing.append(fam_name)
        assert missing == [], f"Families missing source_group: {missing}"

    def test_all_source_groups_are_valid(self, families_data: dict) -> None:
        invalid = []
        for fam_name, fam in families_data["families"].items():
            sg = fam.get("source_group")
            if sg not in VALID_SOURCE_GROUPS:
                invalid.append((fam_name, sg))
        assert invalid == [], f"Invalid source_groups: {invalid}"

    def test_no_duplicate_ingredients_across_families(
        self, families_data: dict
    ) -> None:
        seen: dict[str, str] = {}
        dupes = []
        for fam_name, fam in families_data["families"].items():
            members = fam.get("members", [])
            for member in members:
                key = member.lower() if isinstance(member, str) else member
                if key in seen:
                    dupes.append(f"'{member}' in both '{seen[key]}' and '{fam_name}'")
                seen[key] = fam_name
        assert dupes == [], f"Duplicate ingredients: {dupes[:20]}"

    def test_no_overlap_between_sections(self, families_data: dict) -> None:
        """No ingredient should appear in both families and ambiguous/ignore."""
        family_keys = set()
        for fam in families_data["families"].values():
            for member in fam.get("members", {}):
                family_keys.add(member.lower())

        ambiguous_keys = {k.lower() for k in families_data["ambiguous"]}
        ignore_keys = {k.lower() for k in families_data["ignore_for_correlation"]}

        fam_amb = family_keys & ambiguous_keys
        fam_ign = family_keys & ignore_keys

        assert fam_amb == set(), f"In both families and ambiguous: {fam_amb}"
        assert fam_ign == set(), f"In both families and ignore: {fam_ign}"


class TestCrossReactivity:
    """Cross-reactivity groups reference existing families."""

    def test_all_group_members_are_families(self, families_data: dict) -> None:
        missing = []
        for group_name, members in families_data["cross_reactivity_groups"].items():
            for member in members:
                if member not in families_data["families"]:
                    missing.append(f"{group_name}/{member}")
        assert missing == [], f"Cross-reactivity references non-existent families: {missing}"


class TestHydrolyzed:
    """Hydrolyzed ingredients exist for key vet diets."""

    def test_big3_vet_diets_have_hydrolyzed(self, families_data: dict) -> None:
        """Hill's z/d, Purina HA, Royal Canin HP should have hydrolyzed ingredients."""
        hydrolyzed_families: set[str] = set()
        for fam_name, fam in families_data["families"].items():
            for member in fam.get("members", []):
                name = member if isinstance(member, str) else ""
                if "hydrolyz" in name.lower() or "hydrolys" in name.lower():
                    hydrolyzed_families.add(fam_name)

        # Must have hydrolyzed chicken (z/d, HP) and hydrolyzed soy (HA, z/d low fat)
        assert "chicken" in hydrolyzed_families, "Missing hydrolyzed chicken"
        assert "soy" in hydrolyzed_families, "Missing hydrolyzed soy"


class TestAmbiguous:
    """Ambiguous ingredients have valid structure."""

    def test_all_ambiguous_have_could_be(self, families_data: dict) -> None:
        missing = []
        for name, info in families_data["ambiguous"].items():
            if "could_be" not in info:
                missing.append(name)
        assert missing == [], f"Ambiguous missing could_be: {missing[:20]}"

    def test_all_ambiguous_have_source_group(self, families_data: dict) -> None:
        missing = []
        for name, info in families_data["ambiguous"].items():
            if "source_group" not in info:
                missing.append(name)
        assert missing == [], f"Ambiguous missing source_group: {missing[:20]}"


class TestIngredientParsing:
    """Bracket-aware ingredient parsing works correctly."""

    def test_simple_comma_split(self) -> None:
        result = parse_ingredients("Chicken, Rice, Corn")
        assert result == ["Chicken", "Rice", "Corn"]

    def test_parenthesized_sub_ingredients(self) -> None:
        result = parse_ingredients(
            "Chicken, Chicken Meal (source of glucosamine), Rice"
        )
        assert result == [
            "Chicken",
            "Chicken Meal (source of glucosamine)",
            "Rice",
        ]

    def test_nested_vitamins_minerals(self) -> None:
        result = parse_ingredients(
            "Chicken, vitamins (Vitamin A, Vitamin D), Rice"
        )
        assert result == [
            "Chicken",
            "vitamins (Vitamin A, Vitamin D)",
            "Rice",
        ]

    def test_strips_trailing_period(self) -> None:
        result = parse_ingredients("Chicken, Rice, Salt.")
        assert result == ["Chicken", "Rice", "Salt"]

    def test_empty_string(self) -> None:
        assert parse_ingredients("") == []

    def test_deeply_nested(self) -> None:
        result = parse_ingredients(
            "Chicken, Supplements [Vitamins (A, D3), Minerals (Zinc, Iron)], Rice"
        )
        assert len(result) == 3
        assert result[0] == "Chicken"
        assert result[2] == "Rice"


class TestSpotCheck:
    """Spot-check specific products from different brands."""

    def _check_product_ingredients(
        self,
        brand_file: str,
        product_name_contains: str,
        lookup: dict,
        patterns: list[re.Pattern[str]],
    ) -> list[str]:
        """Parse a product's ingredients and return any unmatched ones."""
        path = BRANDS_DIR / brand_file
        with open(path) as f:
            data = json.load(f)
        for product in data["products"]:
            if product_name_contains.lower() in product["name"].lower():
                raw = product.get("ingredients_raw", "")
                parsed = parse_ingredients(raw)
                unmatched = [
                    ing for ing in parsed
                    if not _is_classified(ing, lookup, patterns)
                ]
                return unmatched
        pytest.fail(f"Product containing '{product_name_contains}' not found in {brand_file}")

    def test_hills_zd(self, lookup: dict, ignore_patterns: list[re.Pattern[str]]) -> None:
        unmatched = self._check_product_ingredients("hills_vet.json", "z/d", lookup, ignore_patterns)
        assert unmatched == [], f"Unmatched in Hill's z/d: {unmatched}"

    def test_purina_ha(self, lookup: dict, ignore_patterns: list[re.Pattern[str]]) -> None:
        unmatched = self._check_product_ingredients("purina_vet.json", "HA Hydrolyzed", lookup, ignore_patterns)
        assert unmatched == [], f"Unmatched in Purina HA: {unmatched}"

    def test_royalcanin_hp(self, lookup: dict, ignore_patterns: list[re.Pattern[str]]) -> None:
        unmatched = self._check_product_ingredients(
            "royalcanin.json", "Hydrolyzed Protein", lookup, ignore_patterns
        )
        assert unmatched == [], f"Unmatched in Royal Canin HP: {unmatched}"

    def test_acana_product(self, lookup: dict, ignore_patterns: list[re.Pattern[str]]) -> None:
        unmatched = self._check_product_ingredients("acana.json", "Chicken", lookup, ignore_patterns)
        assert unmatched == [], f"Unmatched in Acana: {unmatched}"

    def test_openfarm_product(self, lookup: dict, ignore_patterns: list[re.Pattern[str]]) -> None:
        unmatched = self._check_product_ingredients("openfarm.json", "Chicken", lookup, ignore_patterns)
        assert unmatched == [], f"Unmatched in Open Farm: {unmatched}"

    def test_bluebuffalo_product(self, lookup: dict, ignore_patterns: list[re.Pattern[str]]) -> None:
        unmatched = self._check_product_ingredients("bluebuffalo.json", "Chicken", lookup, ignore_patterns)
        assert unmatched == [], f"Unmatched in Blue Buffalo: {unmatched}"

    def test_rayne_product(self, lookup: dict, ignore_patterns: list[re.Pattern[str]]) -> None:
        unmatched = self._check_product_ingredients("rayne.json", "Rabbit", lookup, ignore_patterns)
        assert unmatched == [], f"Unmatched in Rayne: {unmatched}"

    def test_firstmate_product(self, lookup: dict, ignore_patterns: list[re.Pattern[str]]) -> None:
        unmatched = self._check_product_ingredients("firstmate.json", "Salmon", lookup, ignore_patterns)
        assert unmatched == [], f"Unmatched in FirstMate: {unmatched}"

    def test_nutrience_product(self, lookup: dict, ignore_patterns: list[re.Pattern[str]]) -> None:
        unmatched = self._check_product_ingredients("nutrience.json", "Chicken", lookup, ignore_patterns)
        assert unmatched == [], f"Unmatched in Nutrience: {unmatched}"

    def test_iams_product(self, lookup: dict, ignore_patterns: list[re.Pattern[str]]) -> None:
        unmatched = self._check_product_ingredients("iams.json", "Chicken", lookup, ignore_patterns)
        assert unmatched == [], f"Unmatched in Iams: {unmatched}"
