#!/usr/bin/env python3
"""
Build ingredient_families.json from scraped dog food product data.

Parses all ingredients_raw strings from brand JSONs and manual_products.json,
normalizes and classifies each ingredient into families for allergy correlation.

Usage:
    python3 scraper/build_families.py
"""

import json
import glob
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR / "data"
BRANDS_DIR = DATA_DIR / "brands"
MANUAL_PRODUCTS = DATA_DIR / "manual_products.json"
OUTPUT_FILE = DATA_DIR / "ingredient_families.json"


# ---------------------------------------------------------------------------
# Ingredient parsing
# ---------------------------------------------------------------------------
def parse_ingredients(raw: str) -> List[str]:
    """Bracket-aware comma splitting of raw ingredient strings."""
    if not raw:
        return []
    ingredients: List[str] = []
    depth = 0
    current: List[str] = []
    for ch in raw:
        if ch in "([":
            depth += 1
            current.append(ch)
        elif ch in ")]":
            depth = max(0, depth - 1)
            current.append(ch)
        elif ch == "," and depth == 0:
            ing = "".join(current).strip()
            if ing:
                ingredients.append(ing)
            current = []
        else:
            current.append(ch)
    last = "".join(current).strip()
    if last:
        ingredients.append(last)

    cleaned: List[str] = []
    for ing in ingredients:
        # Strip trailing periods and whitespace
        ing = ing.strip().rstrip(".")
        ing = ing.strip()
        if not ing:
            continue
        cleaned.append(ing)
    return cleaned


def collect_all_ingredients() -> Counter:
    """Parse every product's ingredients_raw and return a Counter of raw strings."""
    counter: Counter = Counter()
    files = sorted(glob.glob(str(BRANDS_DIR / "*.json")))
    if MANUAL_PRODUCTS.exists():
        files.append(str(MANUAL_PRODUCTS))

    for filepath in files:
        with open(filepath) as f:
            data = json.load(f)
        for product in data.get("products", []):
            raw = product.get("ingredients_raw", "")
            if raw:
                for ing in parse_ingredients(raw):
                    counter[ing] += 1
    return counter


def normalize_ingredients(counter: Counter) -> Dict[str, Tuple[str, int]]:
    """Case-insensitive dedup. Returns {lowercase_key: (canonical_name, total_count)}."""
    grouped: Dict[str, List[Tuple[str, int]]] = {}
    for ing, count in counter.items():
        key = ing.lower().strip()
        if key not in grouped:
            grouped[key] = []
        grouped[key].append((ing, count))

    result: Dict[str, Tuple[str, int]] = {}
    for key, variants in grouped.items():
        total = sum(c for _, c in variants)
        # Pick the most common variant as canonical
        canonical = max(variants, key=lambda x: x[1])[0]
        result[key] = (canonical, total)
    return result


# ---------------------------------------------------------------------------
# Classification rules
# ---------------------------------------------------------------------------

# Helper to strip percentage annotations and parenthetical descriptors
def clean_for_matching(name: str) -> str:
    """Strip percentage annotations, preservative info, source descriptors, etc."""
    s = name
    # Remove trailing product codes like ". A-9301-C", ". D569922", ". B251921C", etc.
    s = re.sub(r"\.\s*[A-Z]?\d{5,}[A-Z]?\d*$", "", s)
    # Remove "preserved with ..." suffix
    s = re.sub(r"\s*\(?\s*preserved with[^)]*\)?\s*$", "", s, flags=re.IGNORECASE)
    # Remove "(source of ...)" annotations
    s = re.sub(r"\s*\(source of[^)]*\)", "", s, flags=re.IGNORECASE)
    # Remove "(a source of ...)" annotations
    s = re.sub(r"\s*\(a source of[^)]*\)", "", s, flags=re.IGNORECASE)
    # Remove "(natural source of ...)" annotations
    s = re.sub(r"\s*\(natural source of[^)]*\)", "", s, flags=re.IGNORECASE)
    # Remove percentage annotations like "(18%)", "(4%)"
    s = re.sub(r"\s*\(\d+\.?\d*%\)", "", s)
    # Remove "(for color)" / "(for colour)"
    s = re.sub(r"\s*\(for colou?r\)", "", s, flags=re.IGNORECASE)
    # Remove "(Dried)" annotation
    s = re.sub(r"\s*\(Dried\)", "", s, flags=re.IGNORECASE)
    # Remove "(Chickpeas)" annotation (for Garbanzo Beans)
    s = re.sub(r"\s*\(Chickpeas\)", "", s, flags=re.IGNORECASE)
    # Remove "(porcine)" annotation
    s = re.sub(r"\s*\(porcine\)", "", s, flags=re.IGNORECASE)
    # Remove leading "100% " or "100% naturally-shed"
    s = re.sub(r"^100%\s+(Animal Welfare Certified\s+|naturally-shed\s+)?", "", s, flags=re.IGNORECASE)
    # Remove "Certified Humane " prefix
    s = re.sub(r"^Certified Humane\s+", "", s, flags=re.IGNORECASE)
    # Remove "Humanely Raised " prefix
    s = re.sub(r"^Humanely Raised\s+", "", s, flags=re.IGNORECASE)
    # Remove "G.A.P. Step \d " prefix
    s = re.sub(r"^G\.A\.P\.\s+Step\s+\d\s+", "", s, flags=re.IGNORECASE)
    # Remove "Organic " prefix
    s = re.sub(r"^Organic\s+", "", s, flags=re.IGNORECASE)
    # Remove "Fresh " prefix
    s = re.sub(r"^Fresh\s+(Whole\s+)?", "", s, flags=re.IGNORECASE)
    # Remove "fresh " prefix (lowercase)
    s = re.sub(r"^fresh\s+(whole\s+)?", "", s, flags=re.IGNORECASE)
    # Remove "Raw " / "raw " prefix
    s = re.sub(r"^Raw\s+", "", s, flags=re.IGNORECASE)
    # Remove "Roasted " prefix
    s = re.sub(r"^Roasted\s+", "", s, flags=re.IGNORECASE)
    # Remove "Dried " prefix (but be careful - "Dried Beet Pulp" needs it)
    # We handle dried specifically in form detection instead
    # Remove "Freeze-dried " prefix
    s = re.sub(r"^freeze-?\s*dried\s+", "", s, flags=re.IGNORECASE)
    # Remove "Boneless " / "Boneless/skinless " prefix
    s = re.sub(r"^Boneless(/skinless)?\s+", "", s, flags=re.IGNORECASE)
    # Remove "De-boned " / "Deboned " prefix
    s = re.sub(r"^De-?boned\s+", "", s, flags=re.IGNORECASE)
    # Remove "Dehydrated " prefix
    s = re.sub(r"^Dehydrated\s+", "", s, flags=re.IGNORECASE)
    # Remove "Ground " prefix
    s = re.sub(r"^Ground\s+", "", s, flags=re.IGNORECASE)
    # Remove "Pressed " prefix
    s = re.sub(r"^Pressed\s+", "", s, flags=re.IGNORECASE)
    # Remove "Whole " prefix
    s = re.sub(r"^Whole\s+", "", s, flags=re.IGNORECASE)
    # Remove "Canadian " prefix
    s = re.sub(r"^Canadian\s+", "", s, flags=re.IGNORECASE)
    # Remove "Dried " prefix now
    s = re.sub(r"^Dried\s+", "", s, flags=re.IGNORECASE)
    # Remove "Pacific " prefix
    s = re.sub(r"^Pacific\s+", "", s, flags=re.IGNORECASE)
    # Remove "Ocean " prefix
    s = re.sub(r"^Ocean\s+", "", s, flags=re.IGNORECASE)
    # Remove "Wild " prefix
    s = re.sub(r"^Wild\s+", "", s, flags=re.IGNORECASE)
    # Remove remaining parenthetical content at end
    s = re.sub(r"\s*\([^)]*\)\s*$", "", s)
    # Clean up extra whitespace
    s = re.sub(r"\s+", " ", s).strip()
    return s


# ---------------------------------------------------------------------------
# IGNORE patterns (vitamins, minerals, supplements, processing aids, etc.)
# ---------------------------------------------------------------------------
IGNORE_PATTERNS: List[re.Pattern] = [
    # Vitamins
    re.compile(r"vitamin\s", re.I),
    re.compile(r"supplement", re.I),
    re.compile(r"ascorb", re.I),  # ascorbic acid, ascorbyl
    re.compile(r"tocopherol", re.I),
    re.compile(r"menadione", re.I),
    re.compile(r"riboflavin", re.I),
    re.compile(r"riboﬂavin", re.I),  # unicode variant
    re.compile(r"niacin", re.I),
    re.compile(r"biotin", re.I),
    re.compile(r"folic\s+acid", re.I),
    re.compile(r"thiamine", re.I),
    re.compile(r"pyridoxine", re.I),
    re.compile(r"pantothen", re.I),  # pantothenate, pantothenic
    re.compile(r"beta[\s-]?carot", re.I),
    re.compile(r"^carotene$", re.I),
    re.compile(r"d-a-tocopherol", re.I),
    re.compile(r"d-calcium\s+pantothenate", re.I),
    re.compile(r"d-pantothenic", re.I),
    re.compile(r"inositol", re.I),

    # Minerals
    re.compile(r"zinc\s", re.I),
    re.compile(r"iron\s", re.I),
    re.compile(r"^iron$", re.I),
    re.compile(r"copper\s", re.I),
    re.compile(r"manganese\s", re.I),
    re.compile(r"manganous", re.I),
    re.compile(r"selenium", re.I),
    re.compile(r"cobalt\s", re.I),
    re.compile(r"ferrous", re.I),
    re.compile(r"sodium selenite", re.I),
    re.compile(r"calcium iodate", re.I),
    re.compile(r"potassium iodide", re.I),
    re.compile(r"potassium iodate", re.I),
    re.compile(r"reduced iron", re.I),
    re.compile(r"^minerals$", re.I),
    re.compile(r"^minerals\s*[\[\(]", re.I),
    re.compile(r"^minerals/vitamins", re.I),
    re.compile(r"^minerals:", re.I),
    re.compile(r"iron oxide", re.I),
    re.compile(r"magnesium oxide", re.I),
    re.compile(r"magnesium sulfate", re.I),
    re.compile(r"magnesium sulphate", re.I),
    re.compile(r"magnesium proteinate", re.I),
    re.compile(r"magnesium stearate", re.I),
    re.compile(r"magnesium\s*$", re.I),
    re.compile(r"^magnesium\s*\(", re.I),

    # Amino acid supplements
    re.compile(r"^dl[\s-]*methionine", re.I),
    re.compile(r"^dl\s*–\s*methionine", re.I),
    re.compile(r"^dlmethionine", re.I),
    re.compile(r"^l-lysine", re.I),
    re.compile(r"^l lysine", re.I),
    re.compile(r"^l-carnitine", re.I),
    re.compile(r"^l-threonine", re.I),
    re.compile(r"^l-threonie", re.I),  # typo in data
    re.compile(r"^l-tryptophan", re.I),
    re.compile(r"^l-tyrosine", re.I),
    re.compile(r"^l-cysteine", re.I),
    re.compile(r"^l-cystine", re.I),
    re.compile(r"^l-methionine", re.I),
    re.compile(r"^l-arginine", re.I),
    re.compile(r"^l-leucine", re.I),
    re.compile(r"^l-theanine", re.I),
    re.compile(r"^l-thiamine", re.I),
    re.compile(r"^l-glutamine", re.I),
    re.compile(r"^taurine", re.I),
    re.compile(r"^glycine$", re.I),
    re.compile(r"^leucine$", re.I),
    re.compile(r"^histidine$", re.I),
    re.compile(r"^cysteine$", re.I),
    re.compile(r"^cystine$", re.I),
    re.compile(r"^betaine$", re.I),

    # Preservatives / processing aids
    re.compile(r"^mixed tocopherols?", re.I),
    re.compile(r"^mixed-tocopherols?", re.I),
    re.compile(r"^preserved with", re.I),
    re.compile(r"^citric acid", re.I),
    re.compile(r"^calcium propionate", re.I),
    re.compile(r"^rosemary extract", re.I),
    re.compile(r"^oil of rosemary", re.I),
    re.compile(r"^dried rosemary", re.I),
    re.compile(r"^rosemary$", re.I),
    re.compile(r"^green tea extract", re.I),
    re.compile(r"^green tea$", re.I),
    re.compile(r"^marigold extract", re.I),
    re.compile(r"^marigold$", re.I),
    re.compile(r"^bha\b", re.I),
    re.compile(r"^bht\b", re.I),
    re.compile(r"^ethoxyquin", re.I),
    re.compile(r"^edta", re.I),
    re.compile(r"^lactic acid$", re.I),
    re.compile(r"^acetic acid$", re.I),
    re.compile(r"^phosphoric acid$", re.I),
    re.compile(r"^sorbic acid$", re.I),

    # Salts & calcium/phosphorus sources
    re.compile(r"^salt$", re.I),
    re.compile(r"^salt\s+calcium", re.I),
    re.compile(r"^iodized salt$", re.I),
    re.compile(r"^potassium chloride$", re.I),
    re.compile(r"^calcium carbonate$", re.I),
    re.compile(r"^calcium cabonate$", re.I),  # typo in data
    re.compile(r"^dicalcium phosphate$", re.I),
    re.compile(r"^dicalcium carbonate$", re.I),
    re.compile(r"^dicacalcium phosphate$", re.I),  # typo
    re.compile(r"^tricalcium phosphate$", re.I),
    re.compile(r"^potassium citrate$", re.I),
    re.compile(r"^sodium chloride$", re.I),
    re.compile(r"^calcium chloride$", re.I),
    re.compile(r"^calcium phosphate$", re.I),
    re.compile(r"^calcium gluconate$", re.I),
    re.compile(r"^calcium lactate$", re.I),
    re.compile(r"^calcium sulfate$", re.I),
    re.compile(r"^calcium sulphate$", re.I),
    re.compile(r"^calcium stearate$", re.I),
    re.compile(r"^calcium\s+sulfate$", re.I),
    re.compile(r"^monocalcium phosphate$", re.I),
    re.compile(r"^monodicalcium phosphate$", re.I),
    re.compile(r"^mono and dicalcium phosphate$", re.I),
    re.compile(r"^monosodium phosphate$", re.I),
    re.compile(r"^disodium phosphate$", re.I),
    re.compile(r"^sodium phosphate$", re.I),
    re.compile(r"^sodium tripolyphosphate$", re.I),
    re.compile(r"^sodium hexametaphosphate$", re.I),
    re.compile(r"^sodium carbonate$", re.I),
    re.compile(r"^sodium silico aluminate$", re.I),
    re.compile(r"^sodium aluminosilicate$", re.I),
    re.compile(r"^sodium bisulfate$", re.I),
    re.compile(r"^potassium sorbate", re.I),
    re.compile(r"^potassium alginate$", re.I),

    # Probiotics / fermentation products
    re.compile(r"fermentation\s+(product|extract)", re.I),
    re.compile(r"^lactobacillus", re.I),
    re.compile(r"^enterococcus", re.I),
    re.compile(r"^bacillus", re.I),
    re.compile(r"^bifidobacterium", re.I),
    re.compile(r"^streptococcus", re.I),
    re.compile(r"^lactococcus", re.I),
    re.compile(r"^probiotics?\b", re.I),
    re.compile(r"^6-strain probiotic", re.I),

    # Generic fiber/fillers/gums
    re.compile(r"^powdered cellulose$", re.I),
    re.compile(r"^cellulose$", re.I),
    re.compile(r"^microcrystalline cellulose", re.I),
    re.compile(r"^hydroxypropyl cellulose$", re.I),
    re.compile(r"^guar gum$", re.I),
    re.compile(r"^organic guar gum$", re.I),
    re.compile(r"^xanthan gum$", re.I),
    re.compile(r"^carrageenan$", re.I),
    re.compile(r"^cassia gum$", re.I),
    re.compile(r"^lecithin$", re.I),
    re.compile(r"^glycerin$", re.I),
    re.compile(r"^glycerine$", re.I),
    re.compile(r"^vegetable glycerin$", re.I),
    re.compile(r"^coconut glycerin$", re.I),
    re.compile(r"^carob bean gum$", re.I),
    re.compile(r"^locust bean gum$", re.I),
    re.compile(r"^agar[\s-]?agar$", re.I),
    re.compile(r"^gelatin$", re.I),
    re.compile(r"^gelatin\s*\(", re.I),
    re.compile(r"^gum arabic$", re.I),
    re.compile(r"^maltodextrin", re.I),
    re.compile(r"^dextrose$", re.I),
    re.compile(r"^glyceryl monostearate$", re.I),
    re.compile(r"^mono[\s-]and[\s-]di-glycerides$", re.I),

    # Water
    re.compile(r"^water$", re.I),
    re.compile(r"^water sufficient", re.I),

    # Colorants
    re.compile(r"^caramel colou?r$", re.I),
    re.compile(r"^vegetable juice.*(colou?r)", re.I),
    re.compile(r"^annatto colou?r$", re.I),
    re.compile(r"^added colou?r$", re.I),
    re.compile(r"^color added$", re.I),
    re.compile(r"^paprika\b", re.I),
    re.compile(r"^carmine$", re.I),
    re.compile(r"^red 40$", re.I),
    re.compile(r"^blue 2$", re.I),

    # Yeast-derived (not protein source)
    re.compile(r"^dried yeast$", re.I),
    re.compile(r"^brewer.?s?\s*(dried\s+)?yeast$", re.I),
    re.compile(r"^brewers\s+(dried\s+)?yeast$", re.I),
    re.compile(r"^yeast extract$", re.I),
    re.compile(r"^dried yeast extract$", re.I),
    re.compile(r"^yeast culture$", re.I),
    re.compile(r"^hydrolyzed yeast", re.I),
    re.compile(r"^selenium yeast$", re.I),

    # Choline
    re.compile(r"^choline chloride", re.I),

    # Glucosamine / Chondroitin (supplements, not food)
    re.compile(r"^glucosamine", re.I),
    re.compile(r"^chondroitin", re.I),
    re.compile(r"^hyaluronic acid", re.I),

    # FOS / Inulin / Chicory
    re.compile(r"^fructooligosaccharide", re.I),
    re.compile(r"^fructoolligosaccharide", re.I),
    re.compile(r"^inulin", re.I),
    re.compile(r"^chicory\s*root", re.I),
    re.compile(r"^dried chicory root", re.I),
    re.compile(r"^chicory$", re.I),

    # Alfalfa (fiber/supplement)
    re.compile(r"^alfalfa", re.I),
    re.compile(r"^dehydrated alfalfa", re.I),
    re.compile(r"^direct dehydrated alfalfa", re.I),
    re.compile(r"^sun-cured alfalfa", re.I),

    # Kelp
    re.compile(r"^dried kelp$", re.I),
    re.compile(r"^kelp$", re.I),
    re.compile(r"^freeze-?dried kelp$", re.I),

    # Psyllium
    re.compile(r"^psyllium", re.I),
    re.compile(r"^powdered psyllium", re.I),

    # Tomato pomace (fiber)
    re.compile(r"^dried tomato pomace$", re.I),
    re.compile(r"^tomato pomace$", re.I),

    # Dried beet pulp (fiber)
    re.compile(r"beet pulp", re.I),
    re.compile(r"^plain beet pulp$", re.I),
    re.compile(r"^dehydrated beets.*colou?r", re.I),

    # Herbs (small quantities, not allergens)
    re.compile(r"^turmeric", re.I),
    re.compile(r"^curcuma", re.I),
    re.compile(r"^ginger", re.I),
    re.compile(r"^ground ginger$", re.I),
    re.compile(r"^ginger root$", re.I),
    re.compile(r"^cinnamon$", re.I),
    re.compile(r"^parsley$", re.I),
    re.compile(r"^parsley flakes$", re.I),
    re.compile(r"^oregano$", re.I),
    re.compile(r"^chamomile$", re.I),
    re.compile(r"^dandelion", re.I),
    re.compile(r"^fennel", re.I),
    re.compile(r"^garlic", re.I),
    re.compile(r"^dried garlic$", re.I),
    re.compile(r"^sage$", re.I),
    re.compile(r"^lavender$", re.I),
    re.compile(r"^peppermint", re.I),
    re.compile(r"^cloves$", re.I),
    re.compile(r"^capsicum$", re.I),
    re.compile(r"^cardamom$", re.I),
    re.compile(r"^cayenne$", re.I),
    re.compile(r"^licorice", re.I),
    re.compile(r"^burdock root$", re.I),
    re.compile(r"^marshmallow root$", re.I),
    re.compile(r"^althea root$", re.I),
    re.compile(r"^milk thistle$", re.I),
    re.compile(r"^rosehip", re.I),
    re.compile(r"^yucca", re.I),
    re.compile(r"^juniper berr", re.I),
    re.compile(r"^juniper berry", re.I),
    re.compile(r"^passion\s*flower", re.I),
    re.compile(r"^passiflora", re.I),

    # EU-style additive codes
    re.compile(r"^3a\d", re.I),
    re.compile(r"^3b\d", re.I),
    re.compile(r"^4b\d", re.I),
    re.compile(r"^E\d{3}", re.I),
    re.compile(r"^1b\d", re.I),

    # Active Ingredients lines (supplements/probiotics)
    re.compile(r"^Active Ingredient", re.I),

    # Botanical blends
    re.compile(r"^botanicals\s*\(", re.I),

    # Miscellaneous supplements / processing
    re.compile(r"^sodium tripolyphosphate$", re.I),
    re.compile(r"^dried citrus pulp$", re.I),
    re.compile(r"^dried orange pulp$", re.I),
    re.compile(r"^montmorillonite clay$", re.I),
    re.compile(r"^n-butyric acid$", re.I),
    re.compile(r"^lipoic acid$", re.I),
    re.compile(r"^bromelain$", re.I),
    re.compile(r"^quercetin$", re.I),
    re.compile(r"^paractin$", re.I),
    re.compile(r"^astaxanthin$", re.I),
    re.compile(r"^methylsulfonylmethane", re.I),
    re.compile(r"^methyl sulfonyl methane", re.I),
    re.compile(r"^bioperine$", re.I),
    re.compile(r"^bovine colostrum$", re.I),
    re.compile(r"^dried colostrum$", re.I),
    re.compile(r"^ground pecan shells$", re.I),
    re.compile(r"^miscanthus grass$", re.I),
    re.compile(r"^ground miscanthus grass$", re.I),
    re.compile(r"^dried miscanthus grass$", re.I),
    re.compile(r"^new zealand green.*(mussel|lipped)", re.I),
    re.compile(r"^green lipped mussel$", re.I),
    re.compile(r"^perna canaliculus", re.I),
    re.compile(r"^freeze-?dried green mussels$", re.I),
    re.compile(r"^omega-?\d", re.I),
    re.compile(r"^eicosapentaenoic", re.I),
    re.compile(r"^docosahexaenoic", re.I),
    re.compile(r"^mannan-oligosaccharides$", re.I),
    re.compile(r"^trichoderma", re.I),
    re.compile(r"^aspergillus", re.I),

    # Sugar / sweeteners
    re.compile(r"^sugar$", re.I),
    re.compile(r"^cane sugar$", re.I),
    re.compile(r"^cane molasses$", re.I),
    re.compile(r"^brown sugar$", re.I),
    re.compile(r"^maple sugar$", re.I),
    re.compile(r"^maple syrup$", re.I),
    re.compile(r"^corn syrup$", re.I),
    re.compile(r"^high fructose corn syrup$", re.I),
    re.compile(r"^hydrogenated corn syrup$", re.I),
    re.compile(r"^honey$", re.I),
    re.compile(r"^organic honey$", re.I),

    # Vinegar
    re.compile(r"vinegar$", re.I),
    re.compile(r"^organic apple cider vinegar$", re.I),
    re.compile(r"^buffered vinegar$", re.I),

    # Other fillers / non-allergenic
    re.compile(r"^vegetable oil$", re.I),
    re.compile(r"^olive oil", re.I),
    re.compile(r"^medium chain triglyceride", re.I),
    re.compile(r"^partially hydrogenated vegetable oil$", re.I),
    re.compile(r"^partially hydrogenated canola", re.I),

    # Coloring agents
    re.compile(r"colou?r\)?\s*$", re.I),

    # Smoke/bacon flavor
    re.compile(r"^smoke flavor$", re.I),
    re.compile(r"^hickory flavor$", re.I),
    re.compile(r"^natural smoke flavo", re.I),
    re.compile(r"^natural smoked flavo", re.I),
    re.compile(r"^natural hickory smoke flavo", re.I),
    re.compile(r"^natural\s+(&|and)\s+artificial", re.I),
    re.compile(r"^natural roasted flavor", re.I),

    # Miscellaneous non-food
    re.compile(r"^\*upcycled ingredient$", re.I),
    re.compile(r"^citrus fiber$", re.I),
    re.compile(r"^celery", re.I),
    re.compile(r"^lentil fibre$", re.I),
    re.compile(r"^blueberry fiber$", re.I),
    re.compile(r"^dried blueberry pomace$", re.I),
    re.compile(r"^dried cranberry pomace$", re.I),
    re.compile(r"^apple pomace$", re.I),
    re.compile(r"^dried apple pomace$", re.I),
    re.compile(r"^dried apple fibre$", re.I),
    re.compile(r"^fruit juice$", re.I),

    # D (standalone)
    re.compile(r"^D$"),

    # Closing paren artifact
    re.compile(r"^\)$"),

    # French ingredient names (small count, supplements)
    re.compile(r"^acide folique", re.I),
    re.compile(r"^mononitrate de thiamine", re.I),
    re.compile(r"^chlorhydrate", re.I),
    re.compile(r"^chlorure de", re.I),
    re.compile(r"^carbonate de calcium", re.I),
    re.compile(r"^chélate", re.I),
    re.compile(r"^pantothenate calcium", re.I),
    re.compile(r"^pantothénate", re.I),
    re.compile(r"^concentré nutritif", re.I),
    re.compile(r"^conservé avec", re.I),
    re.compile(r"^extrait de", re.I),
    re.compile(r"^produit de fermentation", re.I),
    re.compile(r"^granules de luzerne", re.I),
    re.compile(r"^gras de poulet", re.I),
    re.compile(r"^farine de poisson", re.I),
    re.compile(r"^farine de poulet", re.I),
    re.compile(r"^farine d'avoine", re.I),
    re.compile(r"^graines de lin", re.I),
    re.compile(r"^levure séchée", re.I),
    re.compile(r"^niacine\b", re.I),
    re.compile(r"^riboflavine\b", re.I),
    re.compile(r"^biotine\b", re.I),
    re.compile(r"^pyridoxine\s", re.I),
    re.compile(r"^pyridoxine$", re.I),
    re.compile(r"^huile de romarin", re.I),
    re.compile(r"^racine de chicorée", re.I),
    re.compile(r"^pulpe de tomates", re.I),
    re.compile(r"^arôme naturel", re.I),
    re.compile(r"^ail$", re.I),
    re.compile(r"^persil$", re.I),
    re.compile(r"^bleuets$", re.I),
    re.compile(r"^canneberges$", re.I),
    re.compile(r"^carottes$", re.I),
    re.compile(r"^herbe d'orge", re.I),
    re.compile(r"^orge$", re.I),
    re.compile(r"^curcubita maxima", re.I),
    re.compile(r"^curcuma longa", re.I),
    re.compile(r"^pimpinella anisum", re.I),
    re.compile(r"^jus de légumes", re.I),

    # French ingredient names for core ingredients (can't correlate reliably)
    re.compile(r"^riz brun$", re.I),
    re.compile(r"^pois$", re.I),
    re.compile(r"^protéines de pois$", re.I),
    re.compile(r"^fibre de pois$", re.I),
    re.compile(r"^patates douces$", re.I),
    re.compile(r"^pommes de terre$", re.I),
    re.compile(r"^dl-méthionine$", re.I),
    re.compile(r"^l-thréonine$", re.I),

    # Miscellaneous non-allergen items
    re.compile(r"^pork gelatin$", re.I),  # Gelatin is processing aid
    re.compile(r"^pork plasma$", re.I),  # Plasma is processing aid
    re.compile(r"^porcine plasma$", re.I),
    re.compile(r"^dried porcine plasma$", re.I),
    re.compile(r"^sodium hexametaphosphate$", re.I),
    re.compile(r"^lactose$", re.I),
    re.compile(r"^black soldier fly", re.I),
    re.compile(r"^dried black soldier fly", re.I),

    # Hill's product name bleed-through
    re.compile(r"^hill's science diet", re.I),
    re.compile(r"^carrots & peas stew", re.I),
    re.compile(r"^carrots & spinach stew", re.I),
    re.compile(r"^and mullet", re.I),
    re.compile(r"^mullet", re.I),

    # Mushrooms (supplements)
    re.compile(r"^chaga mushroom$", re.I),
    re.compile(r"^reishi mushroom$", re.I),

    # Miscellaneous
    re.compile(r"^carob$", re.I),
    re.compile(r"^carob powder$", re.I),
    re.compile(r"^modified corn starch$", re.I),
    re.compile(r"^modified rice starch$", re.I),
    re.compile(r"^corn starch-modified$", re.I),

    # Specific flavors that are separate from the allergen families
    re.compile(r"^natural bacon flavo", re.I),
    re.compile(r"^natural beef stew flavo", re.I),
    re.compile(r"^natural cheeseburger flavo", re.I),
    re.compile(r"^natural filet mignon flavo", re.I),
    re.compile(r"^natural grill flavo", re.I),
    re.compile(r"^natural grilled chicken flavo", re.I),
    re.compile(r"^natural new york strip flavo", re.I),
    re.compile(r"^natural peanut flavo", re.I),
    re.compile(r"^natural porterhouse flavo", re.I),
    re.compile(r"^natural prime rib flavo", re.I),
    re.compile(r"^natural rotisserie chicken flavo", re.I),
    re.compile(r"^natural top sirloin flavo", re.I),
    re.compile(r"^natural vegetable flavo", re.I),

    # Citric acid variants with additive data
    re.compile(r"^citric acid:\s*\d", re.I),

    # E330 additive codes
    re.compile(r"^e330\s", re.I),

    # dreid (typo for dried) fermentation products
    re.compile(r"^dreid\s", re.I),

    # "Vitamins" as a standalone ingredient (bundle)
    re.compile(r"^vitamins$", re.I),
    re.compile(r"^vitamins\.", re.I),
    re.compile(r"^vitamins and minerals$", re.I),

    # Thyme, spearmint, valerian, sarsaparilla, zedoary - herbs
    re.compile(r"^thyme$", re.I),
    re.compile(r"^spearmint$", re.I),
    re.compile(r"^spearmint extract$", re.I),
    re.compile(r"^valerian root$", re.I),
    re.compile(r"^valeriana officinalis", re.I),
    re.compile(r"^sarsaparilla root$", re.I),
    re.compile(r"^zedoary$", re.I),
    re.compile(r"^aloe vera$", re.I),
    re.compile(r"^zingiber officinale", re.I),
    re.compile(r"^vanilla flavo", re.I),
    re.compile(r"^fenugreek seeds?$", re.I),
    re.compile(r"^dried onion$", re.I),

    # Sodium bicarbonate, sodium nitrite/nitrate, sodium caseinate, etc.
    re.compile(r"^sodium bicarbonate$", re.I),
    re.compile(r"^sodium nitri", re.I),
    re.compile(r"^sodium nitrate", re.I),
    re.compile(r"^sodium benzoate$", re.I),
    re.compile(r"^sodium erythorbate$", re.I),
    re.compile(r"^sodium erythrobate$", re.I),
    re.compile(r"^sodium propionate$", re.I),
    re.compile(r"^sodium pyrophosphate$", re.I),
    re.compile(r"^sodium caseinate$", re.I),
    re.compile(r"^sodium\s*$", re.I),
    re.compile(r"^tetra sodium pyrophosphate$", re.I),
    re.compile(r"^silicon dioxide$", re.I),

    # Threonine / tryptophan (standalone amino acid without L- prefix)
    re.compile(r"^threonine$", re.I),
    re.compile(r"^tryptophan$", re.I),
    re.compile(r"^taurin$", re.I),

    # Colorants: Yellow 5, Yellow 6, Yellow #5, Yellow #6
    re.compile(r"^yellow\s*#?\d", re.I),

    # Xylose (sugar)
    re.compile(r"^xylose$", re.I),

    # Yeast variants
    re.compile(r"^yeast\.", re.I),
    re.compile(r"^yeast\s*\(", re.I),
    re.compile(r"^yeast extract\s*\(", re.I),

    # Hydrolyzed collagen (supplement, not protein source)
    re.compile(r"^hydrolyzed collagen", re.I),

    # Vegetable broth / vegetable juice / vegetable glycerine
    re.compile(r"^vegetable broth$", re.I),
    re.compile(r"^vegetable juice$", re.I),
    re.compile(r"^vegetable glycerine$", re.I),
    re.compile(r"^vegetable oil\s*\(", re.I),

    # Vinegar powder
    re.compile(r"^vinegar powder$", re.I),

    # Seasoning
    re.compile(r"^seasoning$", re.I),

    # Beta-glucans
    re.compile(r"^β-glucans$", re.I),

    # Sun-cured alfalfa (already have alfalfa patterns but case variants)
    re.compile(r"^sun\s*-?\s*cured alfalfa", re.I),

    # Water with product codes
    re.compile(r"^water\.\s*[A-Z]", re.I),
    re.compile(r"^sufficient water", re.I),

    # Fish oil (sh oil = typo for fish oil)
    re.compile(r"^sh oil$", re.I),

    # Dried plain bet pulp (typo for beet)
    re.compile(r"^dried plain bet pulp$", re.I),

    # Brewer's yeast with product codes
    re.compile(r"^brewer.?s?\s+yeast\.", re.I),

    # Dried Bacillus Coagulans (standalone, no "fermentation")
    re.compile(r"^dried bacillus\b", re.I),

    # Dried Lactobacillus brevis Fermentations (typo for fermentation)
    re.compile(r"^dried lactobacillus", re.I),

    # Fructooligocaccharide (misspelling)
    re.compile(r"^fructooligocaccharide$", re.I),

    # sea salt / sel
    re.compile(r"^sea salt$", re.I),
    re.compile(r"^sel$", re.I),

    # iodate de calcium (French)
    re.compile(r"^iodate de calcium$", re.I),

    # rosemary with extra whitespace
    re.compile(r"^rosemary\s+extract", re.I),

    # Zinc-Methionine complex
    re.compile(r"^zinc-methionine", re.I),

    # French supplement names
    re.compile(r"^sulfate de", re.I),
    re.compile(r"^supplément de", re.I),
    re.compile(r"^sélénite de sodium$", re.I),
    re.compile(r"^varech séché$", re.I),
    re.compile(r"^herbe d'orge$", re.I),
    re.compile(r"^farine d'avoine$", re.I),

    # Natural fish flavor/flavour -> classified as ambiguous instead; move to ambiguous
    # mono- and di-glycerides
    re.compile(r"^mono- and di-glycerides$", re.I),

    # tricalcium phosphate with extra space
    re.compile(r"^tricalcium\s+phosphate$", re.I),

    # Sodium Selenite with line break
    re.compile(r"^sodium\s+selenite$", re.I | re.DOTALL),

    # Dried celery (herb/supplement)
    re.compile(r"^dried celery$", re.I),

    # Sorbic acid (preservative) - with optional suffix
    re.compile(r"^sorbic acid", re.I),

    # French terms with smart quotes (U+2019)
    re.compile(r"^farine d[\u2019']avoine$", re.I),
    re.compile(r"^herbe d[\u2019']orge$", re.I),

    # Unicode dash variants for amino acids (en-dash U+2013, em-dash U+2014)
    re.compile(r"^dl[\u2013\u2014]methionine", re.I),
    re.compile(r"^l[\u2013\u2014]carnitine", re.I),
    re.compile(r"^l[\u2013\u2014]threonine", re.I),
    re.compile(r"^l[\u2013\u2014]lysine", re.I),
    re.compile(r"^amino acids?\s*\(", re.I),
    re.compile(r"^copperamino\s*acid", re.I),

    # Unicode dash variant for beta-carotene
    re.compile(r"^beta[\u2013\u2014\s-]*carot", re.I),

    # Additional colorants
    re.compile(r"^red\s*#?\d", re.I),
    re.compile(r"^blue\s*#?\d", re.I),
    re.compile(r"^artificial colou?rs?$", re.I),
    re.compile(r"^colou?rs$", re.I),
    re.compile(r"^antioxidants$", re.I),

    # Additional salts/minerals
    re.compile(r"^calcium\s+iod", re.I),
    re.compile(r"^calcium\s+sulfate\s+dihydrate$", re.I),
    re.compile(r"^di\s*calcium\s+phosphate$", re.I),
    re.compile(r"^potassium\s+carbonate$", re.I),
    re.compile(r"^potassium\s+phosphate$", re.I),
    re.compile(r"^sodium\s+acid\s+pyrophosphate$", re.I),
    re.compile(r"^sodium\s+metabisulfi", re.I),
    re.compile(r"^sodium\s+molybdate$", re.I),
    re.compile(r"^sodium\s+alginate$", re.I),
    re.compile(r"^tetrasodium\s+pyrophosphate$", re.I),
    re.compile(r"^ground\s+limestone$", re.I),
    re.compile(r"^poassium\s+chloride$", re.I),  # typo for potassium

    # Additional vitamins
    re.compile(r"^cholecalciferol$", re.I),
    re.compile(r"^nicotinic\s+acid$", re.I),
    re.compile(r"^thiamin\s+mononitrate$", re.I),

    # Additional preservatives/processing
    re.compile(r"^propylene\s+glycol$", re.I),
    re.compile(r"^sorbitol$", re.I),
    re.compile(r"^xanthan$", re.I),

    # Additional water variants
    re.compile(r"^water\s+(for|sufficient)", re.I),
    re.compile(r"^water\s*\(sufficient", re.I),

    # Additional gums
    re.compile(r"^acacia gum$", re.I),
    re.compile(r"^carob gum$", re.I),

    # Additional yeast
    re.compile(r"^yeast$", re.I),
    re.compile(r"^dried\s+brewers?\s+yeast$", re.I),
    re.compile(r"^grain\s+distillers?\s+dried\s+yeast$", re.I),

    # Additional fibers/fillers
    re.compile(r"^cellulose\s+powder$", re.I),
    re.compile(r"^citrus\s+pulp$", re.I),
    re.compile(r"^palm\s+oil$", re.I),

    # Additional flavors
    re.compile(r"^smoke\s+flavou?r$", re.I),
    re.compile(r"^grilled\s+filet\s+mignon\s+flavo", re.I),
    re.compile(r"^natural\s+grilled\s+steak\s+flavo", re.I),
    re.compile(r"^natural\s+poultry\s+flavou?r$", re.I),
    re.compile(r"^natural\s+porcine\s+flavo", re.I),
    re.compile(r"^natural\s+flavor\s*\(yeast\s+extract\)", re.I),

    # Additional herbs/spices
    re.compile(r"^basil$", re.I),
    re.compile(r"^bay\s+leaves$", re.I),
    re.compile(r"^cumin$", re.I),
    re.compile(r"^ground\s+cumin$", re.I),
    re.compile(r"^ground\s+cinnamon$", re.I),
    re.compile(r"^ground\s+fennel$", re.I),
    re.compile(r"^ground\s+peppermint$", re.I),
    re.compile(r"^sweet\s+fennel$", re.I),
    re.compile(r"^onion\s+powder$", re.I),
    re.compile(r"^eucalyptus\s+oil$", re.I),
    re.compile(r"^lemongrass\s+oil$", re.I),
    re.compile(r"^spearmint\s+oil$", re.I),
    re.compile(r"^spearmint\s+extract\b", re.I),  # catches "spearmint extract." with trailing text
    re.compile(r"^dried\s+ginger$", re.I),
    re.compile(r"^fenugreek$", re.I),
    re.compile(r"^chicory\s+extract$", re.I),

    # Additional supplements
    re.compile(r"^bio\s*perine$", re.I),
    re.compile(r"^par\s+actin$", re.I),
    re.compile(r"^animal\s+plasma$", re.I),
    re.compile(r"^spray\s+dried\s+animal\s+blood", re.I),
    re.compile(r"^greenshell\s+mussel", re.I),
    re.compile(r"^algal\s+oil", re.I),

    # Sugar/sweetener
    re.compile(r"^molasses$", re.I),
    re.compile(r"^caramel$", re.I),
    re.compile(r"^carmel$", re.I),  # typo for caramel

    # Additional broth/stock
    re.compile(r"^dried\s+vegetable\s+broth$", re.I),
    re.compile(r"^vegetable\s+stock$", re.I),

    # Rosemary variants (typos and trailing text)
    re.compile(r"^rosemary\s+oil", re.I),
    re.compile(r"^rosmary\b", re.I),  # typo
    re.compile(r"^rosemary\s*extrac$", re.I),  # truncated
    re.compile(r"^rosemary\.\s*contains", re.I),  # trailing disclaimer

    # Kelp variants
    re.compile(r"^kelp\s+meal$", re.I),
    re.compile(r"^organic\s+dried\s+kelp$", re.I),

    # Unicode dash by-product
    re.compile(r"^by[\u2013\u2014]product", re.I),

    # Scraper artifacts (metadata leaking into ingredient lists)
    re.compile(r"^item\s+number:", re.I),
    re.compile(r"^made\s+in\s+the\s+usa$", re.I),
    re.compile(r"^real\s+meat\s+first$", re.I),
    re.compile(r"^species:\s+dog\b", re.I),
    re.compile(r"^stella['\u2019]?s?\b", re.I),
    re.compile(r"^flavors?\s+or\s+preservatives", re.I),
    re.compile(r"^organ\s+meats\s+and\s+cartilage", re.I),
    re.compile(r"^\),?\s*chondroitin", re.I),  # leading paren artifacts
    re.compile(r"^folic\s+acid\),", re.I),  # misparse: vitamin list fragment
    re.compile(r"^potassium\s+iodide\),", re.I),  # misparse: vitamin list fragment
    re.compile(r"^l-ascorbyl", re.I),  # vitamin C derivative
    re.compile(r"^citric\s+acid\s+9a\b", re.I),  # misparse: "Citric Acid (a Preservative)" with OCR error
    re.compile(r"^amino\s+acid\s+complex$", re.I),  # generic mineral chelate
]


def is_ignore(name: str) -> bool:
    """Check if an ingredient should be ignored for correlation."""
    for pattern in IGNORE_PATTERNS:
        if pattern.search(name):
            return True
    return False


# ---------------------------------------------------------------------------
# AMBIGUOUS patterns
# ---------------------------------------------------------------------------
AMBIGUOUS_MAP: List[Tuple[re.Pattern, Dict[str, Any]]] = [
    # Meat (mammal, unspecified)
    (re.compile(r"^meat\s+meal$", re.I),
     {"could_be": ["beef", "pork", "lamb"], "source_group": "mammal"}),
    (re.compile(r"^meat\s+by-?products?$", re.I),
     {"could_be": ["beef", "pork", "lamb"], "source_group": "mammal"}),
    (re.compile(r"^meat\s+and\s+bone\s+meal$", re.I),
     {"could_be": ["beef", "pork", "lamb"], "source_group": "mammal"}),
    (re.compile(r"^meat\s+broth$", re.I),
     {"could_be": ["beef", "pork", "lamb"], "source_group": "mammal"}),
    (re.compile(r"^meat\s+by-?\s*products?$", re.I),
     {"could_be": ["beef", "pork", "lamb"], "source_group": "mammal"}),
    (re.compile(r"^mutton\s+meal$", re.I),
     {"could_be": ["lamb", "goat"], "source_group": "mammal"}),
    (re.compile(r"^dehydrated\s+mutton$", re.I),
     {"could_be": ["lamb", "goat"], "source_group": "mammal"}),
    (re.compile(r"^meat$", re.I),
     {"could_be": ["beef", "pork", "lamb"], "source_group": "mammal"}),
    (re.compile(r"^meat\s*&\s*bone\s+meal$", re.I),
     {"could_be": ["beef", "pork", "lamb"], "source_group": "mammal"}),
    (re.compile(r"^dried\s+meat\s+by-?products?$", re.I),
     {"could_be": ["beef", "pork", "lamb"], "source_group": "mammal"}),
    (re.compile(r"^-?\s*muscle\s+meat$", re.I),
     {"could_be": ["beef", "pork", "lamb"], "source_group": "mammal"}),
    (re.compile(r"^cooked\s+bone\s+marrow$", re.I),
     {"could_be": ["beef", "pork"], "source_group": "mammal"}),

    # Poultry (unspecified)
    (re.compile(r"^poultry\s+by-?product", re.I),
     {"could_be": ["chicken", "turkey", "duck"], "source_group": "poultry"}),
    (re.compile(r"^poultry\s+fat$", re.I),
     {"could_be": ["chicken", "turkey", "duck"], "source_group": "poultry"}),
    (re.compile(r"^poultry\s+meal$", re.I),
     {"could_be": ["chicken", "turkey", "duck"], "source_group": "poultry"}),
    (re.compile(r"^poultry\s+broth$", re.I),
     {"could_be": ["chicken", "turkey", "duck"], "source_group": "poultry"}),
    (re.compile(r"^poultry\s+hearts?$", re.I),
     {"could_be": ["chicken", "turkey", "duck"], "source_group": "poultry"}),
    (re.compile(r"^poultry\s+liver$", re.I),
     {"could_be": ["chicken", "turkey", "duck"], "source_group": "poultry"}),
    (re.compile(r"^poultry and pork digest$", re.I),
     {"could_be": ["chicken", "turkey", "duck", "pork"], "source_group": "animal"}),
    (re.compile(r"^hydrolyzed poultry", re.I),
     {"could_be": ["chicken", "turkey", "duck"], "source_group": "poultry"}),

    # Animal (unspecified)
    (re.compile(r"^animal fat", re.I),
     {"could_be": ["beef", "pork", "chicken"], "source_group": "animal"}),
    (re.compile(r"^animal digest$", re.I),
     {"could_be": ["any"], "source_group": "animal"}),
    (re.compile(r"^animal by-?products?$", re.I),
     {"could_be": ["any"], "source_group": "animal"}),
    (re.compile(r"^animal liver$", re.I),
     {"could_be": ["beef", "pork", "chicken"], "source_group": "animal"}),

    # Fish (unspecified)
    (re.compile(r"^fish\s+meal\b", re.I),
     {"could_be": ["salmon", "herring", "whitefish", "menhaden"], "source_group": "fish"}),
    (re.compile(r"^fish\s+oil\b", re.I),
     {"could_be": ["salmon", "herring", "menhaden", "anchovy"], "source_group": "fish"}),
    (re.compile(r"^fish\s+broth$", re.I),
     {"could_be": ["salmon", "herring", "whitefish"], "source_group": "fish"}),
    (re.compile(r"^fish\s+bone\s+broth$", re.I),
     {"could_be": ["salmon", "herring", "whitefish"], "source_group": "fish"}),
    (re.compile(r"^fish\s+flavor$", re.I),
     {"could_be": ["salmon", "herring", "whitefish", "menhaden"], "source_group": "fish"}),
    (re.compile(r"^fish$", re.I),
     {"could_be": ["salmon", "herring", "whitefish", "menhaden"], "source_group": "fish"}),
    (re.compile(r"^ocean fish\s*(meal)?$", re.I),
     {"could_be": ["salmon", "herring", "whitefish", "menhaden"], "source_group": "fish"}),
    (re.compile(r"^pacific ocean fish meal$", re.I),
     {"could_be": ["salmon", "herring", "whitefish", "menhaden"], "source_group": "fish"}),
    (re.compile(r"^oceanfish$", re.I),
     {"could_be": ["salmon", "herring", "whitefish", "menhaden"], "source_group": "fish"}),
    (re.compile(r"^hydrolyzed fish\b", re.I),
     {"could_be": ["salmon", "herring", "whitefish", "menhaden"], "source_group": "fish"}),
    (re.compile(r"^dehydrated fish\b", re.I),
     {"could_be": ["salmon", "herring", "whitefish", "menhaden"], "source_group": "fish"}),

    # Natural flavor (unknown)
    (re.compile(r"^natural\s+flavou?rs?$", re.I),
     {"could_be": ["any"], "source_group": "unknown"}),
    (re.compile(r"^natural\s+flavou?rs?\s+dried chicory", re.I),
     {"could_be": ["any"], "source_group": "unknown"}),
    (re.compile(r"^natural\s+flavor\s*\(fish and yeast\)$", re.I),
     {"could_be": ["salmon", "herring", "whitefish"], "source_group": "fish"}),
    (re.compile(r"^natural\s+flavor\s*\(fish\)$", re.I),
     {"could_be": ["salmon", "herring", "whitefish"], "source_group": "fish"}),
    (re.compile(r"^natural\s+flavor\s*\(plant\)$", re.I),
     {"could_be": ["any"], "source_group": "unknown"}),
    (re.compile(r"^natural\s+flavor\s*\(yeast\)$", re.I),
     {"could_be": ["any"], "source_group": "unknown"}),
    (re.compile(r"^natural\s+avor$", re.I),  # typo in data
     {"could_be": ["any"], "source_group": "unknown"}),
    (re.compile(r"^natural\s+flavoring$", re.I),
     {"could_be": ["any"], "source_group": "unknown"}),
    (re.compile(r"^natural\s+flavou?rs?\s*\(only for mexico", re.I),
     {"could_be": ["any"], "source_group": "unknown"}),

    # Liver (unspecified)
    (re.compile(r"^liver$", re.I),
     {"could_be": ["beef", "pork", "chicken"], "source_group": "animal"}),
    (re.compile(r"^liver\s+flavor$", re.I),
     {"could_be": ["beef", "pork", "chicken"], "source_group": "animal"}),

    # Lake fish (ambiguous)
    (re.compile(r"freshwater lake fish", re.I),
     {"could_be": ["whitefish", "trout", "perch"], "source_group": "fish"}),

    # Tullibee (lake fish)
    (re.compile(r"tullibee", re.I),
     {"could_be": ["whitefish"], "source_group": "fish"}),

    # Natural fish flavor/flavour
    (re.compile(r"^natural\s+fish\s+flavo", re.I),
     {"could_be": ["salmon", "herring", "whitefish", "menhaden"], "source_group": "fish"}),

    # Natural chicken flavor/flavour
    (re.compile(r"^natural\s+chicken\s+flavo", re.I),
     {"could_be": ["chicken"], "source_group": "poultry"}),

    # Natural lamb flavor/flavour
    (re.compile(r"^natural\s+lamb\s+flavo", re.I),
     {"could_be": ["lamb"], "source_group": "red_meat"}),

    # Natural pork flavor/flavour
    (re.compile(r"^natural\s+pork\s+flavo", re.I),
     {"could_be": ["pork"], "source_group": "red_meat"}),

    # Natural chicken liver flavor
    (re.compile(r"^natural\s+chicken\s+liver\s+flavo", re.I),
     {"could_be": ["chicken"], "source_group": "poultry"}),

    # Natural roasted turkey flavour
    (re.compile(r"^natural\s+roasted\s+turkey\s+flavo", re.I),
     {"could_be": ["turkey"], "source_group": "poultry"}),
]


def classify_ambiguous(name: str) -> Optional[Dict[str, Any]]:
    """Check if an ingredient is ambiguous. Returns classification dict or None."""
    for pattern, info in AMBIGUOUS_MAP:
        if pattern.search(name):
            return info
    return None


# ---------------------------------------------------------------------------
# FAMILY classification
# ---------------------------------------------------------------------------

# Each entry: (pattern, family, source_group, form)
# form can be a string or a callable that takes the original name and returns a form string
FAMILY_RULES: List[Tuple[re.Pattern, str, str, Optional[str]]] = []


def _add_protein_family(
    family: str,
    source_group: str,
    keywords: List[str],
) -> None:
    """Add pattern rules for a protein family (chicken, beef, salmon, etc.)."""
    for kw in keywords:
        escaped = re.escape(kw)
        # Exact match
        FAMILY_RULES.append((re.compile(rf"^{escaped}$", re.I), family, source_group, None))
        # With prefixes (handled by clean_for_matching, but also direct)
        FAMILY_RULES.append((re.compile(rf"\b{escaped}\b", re.I), family, source_group, None))


# --- Poultry ---
for kw in ["chicken"]:
    FAMILY_RULES.extend([
        (re.compile(r"\bchicken\b", re.I), "chicken", "poultry", None),
        (re.compile(r"^chickenmeal$", re.I), "chicken", "poultry", "meal"),  # concatenated typo
    ])
for kw in ["turkey"]:
    FAMILY_RULES.extend([
        (re.compile(r"\bturkey\b", re.I), "turkey", "poultry", None),
    ])
for kw in ["duck"]:
    FAMILY_RULES.extend([
        (re.compile(r"\bduck\b", re.I), "duck", "poultry", None),
    ])
FAMILY_RULES.append((re.compile(r"\bquail\b", re.I), "quail", "poultry", None))
FAMILY_RULES.append((re.compile(r"\bgoose\b", re.I), "goose", "poultry", None))
FAMILY_RULES.append((re.compile(r"\bguinea\s*fowl\b", re.I), "guinea_fowl", "poultry", None))

# --- Red meat ---
FAMILY_RULES.append((re.compile(r"\bbeef\b", re.I), "beef", "red_meat", None))
FAMILY_RULES.append((re.compile(r"\bangus\s+beef\b", re.I), "beef", "red_meat", None))
FAMILY_RULES.append((re.compile(r"\blamb\b", re.I), "lamb", "red_meat", None))
FAMILY_RULES.append((re.compile(r"\bvenison\b", re.I), "venison", "red_meat", None))
FAMILY_RULES.append((re.compile(r"\bdeer\b", re.I), "venison", "red_meat", None))
FAMILY_RULES.append((re.compile(r"\bbison\b", re.I), "bison", "red_meat", None))
FAMILY_RULES.append((re.compile(r"\bbuffalo\b", re.I), "bison", "red_meat", None))
FAMILY_RULES.append((re.compile(r"\bpork\b", re.I), "pork", "red_meat", None))
FAMILY_RULES.append((re.compile(r"\bbacon\b", re.I), "pork", "red_meat", None))
FAMILY_RULES.append((re.compile(r"\bkangaroo\b", re.I), "kangaroo", "exotic", None))
FAMILY_RULES.append((re.compile(r"\brabbit\b", re.I), "rabbit", "exotic", None))
FAMILY_RULES.append((re.compile(r"\bgoat\b", re.I), "goat", "red_meat", None))
FAMILY_RULES.append((re.compile(r"\bcrocodil", re.I), "crocodile", "exotic", None))
FAMILY_RULES.append((re.compile(r"\balligator\b", re.I), "crocodile", "exotic", None))
FAMILY_RULES.append((re.compile(r"\belk\b", re.I), "elk", "red_meat", None))
FAMILY_RULES.append((re.compile(r"\bwild\s+boar\b", re.I), "wild_boar", "red_meat", None))
FAMILY_RULES.append((re.compile(r"\bboar\b", re.I), "wild_boar", "red_meat", None))

# --- Fish ---
FAMILY_RULES.append((re.compile(r"\bsalmon\b", re.I), "salmon", "fish", None))
FAMILY_RULES.append((re.compile(r"\bwhitefish\b", re.I), "whitefish", "fish", None))
FAMILY_RULES.append((re.compile(r"\bwhite fish\b", re.I), "whitefish", "fish", None))
FAMILY_RULES.append((re.compile(r"\bherring\b", re.I), "herring", "fish", None))
FAMILY_RULES.append((re.compile(r"\btrout\b", re.I), "trout", "fish", None))
FAMILY_RULES.append((re.compile(r"\brainbow trout\b", re.I), "trout", "fish", None))
FAMILY_RULES.append((re.compile(r"\bmenhaden\b", re.I), "menhaden", "fish", None))
FAMILY_RULES.append((re.compile(r"\banchov", re.I), "anchovy", "fish", None))
FAMILY_RULES.append((re.compile(r"\bcod\b", re.I), "cod", "fish", None))
FAMILY_RULES.append((re.compile(r"\bsardine", re.I), "sardine", "fish", None))
FAMILY_RULES.append((re.compile(r"\bmackerel\b", re.I), "mackerel", "fish", None))
FAMILY_RULES.append((re.compile(r"\bpollock\b", re.I), "pollock", "fish", None))
FAMILY_RULES.append((re.compile(r"\bcatfish\b", re.I), "catfish", "fish", None))
FAMILY_RULES.append((re.compile(r"\bsmelt\b", re.I), "smelt", "fish", None))
FAMILY_RULES.append((re.compile(r"\bhaddock\b", re.I), "haddock", "fish", None))
FAMILY_RULES.append((re.compile(r"\btuna\b", re.I), "tuna", "fish", None))
FAMILY_RULES.append((re.compile(r"\btilapia\b", re.I), "tilapia", "fish", None))
FAMILY_RULES.append((re.compile(r"\bflounder\b", re.I), "flounder", "fish", None))
FAMILY_RULES.append((re.compile(r"\bhake\b", re.I), "hake", "fish", None))
FAMILY_RULES.append((re.compile(r"\bpilchard\b", re.I), "pilchard", "fish", None))
FAMILY_RULES.append((re.compile(r"\brockfish\b", re.I), "rockfish", "fish", None))
FAMILY_RULES.append((re.compile(r"\bsole\b", re.I), "sole", "fish", None))
FAMILY_RULES.append((re.compile(r"\bperch\b", re.I), "perch", "fish", None))
FAMILY_RULES.append((re.compile(r"\bblue whiting\b", re.I), "whitefish", "fish", None))
FAMILY_RULES.append((re.compile(r"\bcapelin\b", re.I), "capelin", "fish", None))
FAMILY_RULES.append((re.compile(r"\barctic char\b", re.I), "arctic_char", "fish", None))
FAMILY_RULES.append((re.compile(r"\bnorthern pike\b", re.I), "pike", "fish", None))
FAMILY_RULES.append((re.compile(r"\bwalleye\b", re.I), "walleye", "fish", None))
FAMILY_RULES.append((re.compile(r"\byellow perch\b", re.I), "perch", "fish", None))
FAMILY_RULES.append((re.compile(r"\bclams?\b", re.I), "clam", "mollusk", None))
FAMILY_RULES.append((re.compile(r"\bmussels?\b", re.I), "mussel", "mollusk", None))
FAMILY_RULES.append((re.compile(r"\bshrimp", re.I), "shrimp", "crustacean", None))
FAMILY_RULES.append((re.compile(r"\bsebastes\b", re.I), "rockfish", "fish", None))
FAMILY_RULES.append((re.compile(r"\bacadian\s+redfish\b", re.I), "rockfish", "fish", None))

# --- Grains ---
FAMILY_RULES.append((re.compile(r"\brice\b", re.I), "rice", "grain", None))
FAMILY_RULES.append((re.compile(r"\bcorn\b", re.I), "corn", "grain", None))
FAMILY_RULES.append((re.compile(r"\bwheat\b", re.I), "wheat", "grain", None))
FAMILY_RULES.append((re.compile(r"\boat\b", re.I), "oat", "grain", None))
FAMILY_RULES.append((re.compile(r"\boats\b", re.I), "oat", "grain", None))
FAMILY_RULES.append((re.compile(r"\boatmeal\b", re.I), "oat", "grain", None))
FAMILY_RULES.append((re.compile(r"\bbarley\b", re.I), "barley", "grain", None))
FAMILY_RULES.append((re.compile(r"\bsorghum\b", re.I), "sorghum", "grain", None))
FAMILY_RULES.append((re.compile(r"\bmilo\b", re.I), "sorghum", "grain", None))
FAMILY_RULES.append((re.compile(r"\bmillet\b", re.I), "millet", "grain", None))
FAMILY_RULES.append((re.compile(r"\bquinoa\b", re.I), "quinoa", "grain", None))
FAMILY_RULES.append((re.compile(r"\brye\b", re.I), "rye", "grain", None))
FAMILY_RULES.append((re.compile(r"\bpasta\b", re.I), "wheat", "grain", None))
FAMILY_RULES.append((re.compile(r"\bspelt\b", re.I), "wheat", "grain", None))

# --- Legumes ---
FAMILY_RULES.append((re.compile(r"\bsoy\b", re.I), "soy", "legume", None))
FAMILY_RULES.append((re.compile(r"\bsoybean\b", re.I), "soy", "legume", None))
FAMILY_RULES.append((re.compile(r"\bpea\b", re.I), "pea", "legume", None))
FAMILY_RULES.append((re.compile(r"\bpeas\b", re.I), "pea", "legume", None))
FAMILY_RULES.append((re.compile(r"\bchickpea", re.I), "chickpea", "legume", None))
FAMILY_RULES.append((re.compile(r"\bgarbanzo\b", re.I), "chickpea", "legume", None))
FAMILY_RULES.append((re.compile(r"\blentil", re.I), "lentil", "legume", None))
FAMILY_RULES.append((re.compile(r"\bnavy bean", re.I), "bean", "legume", None))
FAMILY_RULES.append((re.compile(r"\bwhite bean", re.I), "bean", "legume", None))
FAMILY_RULES.append((re.compile(r"\bkidney bean", re.I), "bean", "legume", None))
FAMILY_RULES.append((re.compile(r"\bblack bean", re.I), "bean", "legume", None))
FAMILY_RULES.append((re.compile(r"\bfava bean", re.I), "bean", "legume", None))
FAMILY_RULES.append((re.compile(r"\bfava protein", re.I), "bean", "legume", None))
FAMILY_RULES.append((re.compile(r"\bpinto bean", re.I), "bean", "legume", None))
FAMILY_RULES.append((re.compile(r"\bfield peas?\b", re.I), "pea", "legume", None))
FAMILY_RULES.append((re.compile(r"\bpeanut", re.I), "peanut", "legume", None))

# --- Root/Starch ---
FAMILY_RULES.append((re.compile(r"\bsweet\s+potato", re.I), "sweet_potato", "root", None))
FAMILY_RULES.append((re.compile(r"\bpotato", re.I), "potato", "root", None))
FAMILY_RULES.append((re.compile(r"\btapioca\b", re.I), "tapioca", "root", None))
FAMILY_RULES.append((re.compile(r"\bcassava\b", re.I), "tapioca", "root", None))
FAMILY_RULES.append((re.compile(r"\bbeets?\b", re.I), "beet", "root", None))
FAMILY_RULES.append((re.compile(r"\bbeet\s+root$", re.I), "beet", "root", None))
FAMILY_RULES.append((re.compile(r"\bbeet\s+greens$", re.I), "beet", "root", None))
FAMILY_RULES.append((re.compile(r"\byams?\b", re.I), "sweet_potato", "root", None))

# --- Seeds/Oils ---
FAMILY_RULES.append((re.compile(r"\bflax\s*seed", re.I), "flaxseed", "seed", None))
FAMILY_RULES.append((re.compile(r"\bflax\s+seed", re.I), "flaxseed", "seed", None))
FAMILY_RULES.append((re.compile(r"\baxseed\b", re.I), "flaxseed", "seed", None))  # typo: "Ground Whole axseed"
FAMILY_RULES.append((re.compile(r"\bsunflower\b", re.I), "sunflower", "seed", None))
FAMILY_RULES.append((re.compile(r"sun\uFB02ower", re.I), "sunflower", "seed", None))  # Sunﬂower (unicode fl ligature)
FAMILY_RULES.append((re.compile(r"\bcanola\b", re.I), "canola", "seed", None))
FAMILY_RULES.append((re.compile(r"\bcoconut\b", re.I), "coconut", "seed", None))
FAMILY_RULES.append((re.compile(r"\bsafflower\b", re.I), "safflower", "seed", None))
FAMILY_RULES.append((re.compile(r"\bchia\b", re.I), "chia", "seed", None))
FAMILY_RULES.append((re.compile(r"\bhemp\s+seed\b", re.I), "hemp", "seed", None))
FAMILY_RULES.append((re.compile(r"\bpumpkin\s*seed", re.I), "pumpkin", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bborage\s+oil\b", re.I), "borage", "seed", None))

# --- Fruits ---
FAMILY_RULES.append((re.compile(r"\bapple", re.I), "apple", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bblueberr", re.I), "blueberry", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bcranberr", re.I), "cranberry", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bpumpkin\b", re.I), "pumpkin", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bbanana", re.I), "banana", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bsquash\b", re.I), "squash", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bpear[s]?\b", re.I), "pear", "fruit", None))
FAMILY_RULES.append((re.compile(r"\btomato", re.I), "tomato", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bcherry tomato", re.I), "tomato", "fruit", None))
FAMILY_RULES.append((re.compile(r"\braspberr", re.I), "raspberry", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bblackberr", re.I), "blackberry", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bpomegranate", re.I), "pomegranate", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bpapaya", re.I), "papaya", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bsaskatoon berr", re.I), "saskatoon_berry", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bpineapple\b", re.I), "pineapple", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bavocado\b", re.I), "avocado", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bcherr(?:y|ies)\b", re.I), "cherry", "fruit", None))
FAMILY_RULES.append((re.compile(r"\bcollard greens\b", re.I), "collard", "vegetable", None))
FAMILY_RULES.append((re.compile(r"\bbell pepper", re.I), "pepper", "vegetable", None))
FAMILY_RULES.append((re.compile(r"\bred pepper", re.I), "pepper", "vegetable", None))

# --- Vegetables ---
FAMILY_RULES.append((re.compile(r"\bcarrot", re.I), "carrot", "vegetable", None))
FAMILY_RULES.append((re.compile(r"spinach\b", re.I), "spinach", "vegetable", None))
FAMILY_RULES.append((re.compile(r"\bbroccoli\b", re.I), "broccoli", "vegetable", None))
FAMILY_RULES.append((re.compile(r"\bkale\b", re.I), "kale", "vegetable", None))
FAMILY_RULES.append((re.compile(r"\bzucchini\b", re.I), "zucchini", "vegetable", None))
FAMILY_RULES.append((re.compile(r"\bgreen\s*bean", re.I), "green_bean", "vegetable", None))
FAMILY_RULES.append((re.compile(r"\bstring\s*bean", re.I), "green_bean", "vegetable", None))
FAMILY_RULES.append((re.compile(r"\bturnip\b", re.I), "turnip", "vegetable", None))
FAMILY_RULES.append((re.compile(r"\bartichoke", re.I), "artichoke", "vegetable", None))
FAMILY_RULES.append((re.compile(r"\bcabbage\b", re.I), "cabbage", "vegetable", None))
FAMILY_RULES.append((re.compile(r"\bparsnip\b", re.I), "parsnip", "vegetable", None))

# --- Dairy ---
FAMILY_RULES.append((re.compile(r"\bcheese\b", re.I), "dairy", "dairy", None))
FAMILY_RULES.append((re.compile(r"\bcheddar\b", re.I), "dairy", "dairy", None))
FAMILY_RULES.append((re.compile(r"\bmilk\b", re.I), "dairy", "dairy", None))
FAMILY_RULES.append((re.compile(r"\bskim\s+milk\b", re.I), "dairy", "dairy", None))
FAMILY_RULES.append((re.compile(r"\bwhey\b", re.I), "dairy", "dairy", None))
FAMILY_RULES.append((re.compile(r"\bcottage cheese\b", re.I), "dairy", "dairy", None))
FAMILY_RULES.append((re.compile(r"\bcasein\b", re.I), "dairy", "dairy", None))
FAMILY_RULES.append((re.compile(r"\bcultured\s+(skim\s+)?milk", re.I), "dairy", "dairy", None))
FAMILY_RULES.append((re.compile(r"\bcultured\s+whey\b", re.I), "dairy", "dairy", None))
FAMILY_RULES.append((re.compile(r"\byogurt\b", re.I), "dairy", "dairy", None))

# --- Egg ---
FAMILY_RULES.append((re.compile(r"\begg\b", re.I), "egg", "egg", None))
FAMILY_RULES.append((re.compile(r"\beggs\b", re.I), "egg", "egg", None))

# --- Marine/algae ---
FAMILY_RULES.append((re.compile(r"\bmarine\s+microalgae\b", re.I), "algae", "other", None))
FAMILY_RULES.append((re.compile(r"\balgae\b", re.I), "algae", "other", None))
FAMILY_RULES.append((re.compile(r"\bspirulina\b", re.I), "algae", "other", None))


def determine_form(original_name: str, source_group: str = "") -> str:
    """Determine the processing form of an ingredient from its name."""
    low = original_name.lower()

    if "hydrolyz" in low or "hydrolyse" in low or "hydrolysate" in low:
        return "hydrolyzed"
    # Corn germ meal is a by-product, not a meal in the protein-meal sense
    if "corn germ meal" in low:
        return "by_product"
    if " meal" in low:
        return "meal"
    if "by-product" in low or "by product" in low or "byproduct" in low:
        return "by_product"
    if " fat" in low or " tallow" in low:
        return "fat"
    if " oil" in low:
        return "oil"
    if " flour" in low:
        return "flour"
    if " bran" in low:
        return "bran"
    if " starch" in low:
        return "starch"
    if " fiber" in low or " fibre" in low:
        return "fiber"
    if " broth" in low or "bone broth" in low:
        return "broth"
    if " gluten" in low:
        return "gluten"
    if "liver" in low:
        return "organ"
    if "heart" in low or "gizzard" in low or "giblet" in low or "kidney" in low:
        return "organ"
    if "lung" in low or "spleen" in low or "tripe" in low:
        return "organ"
    if re.search(r"\bbone\b", low) and "meal" not in low and "boneless" not in low:
        return "organ"
    if " protein" in low and "isolate" in low:
        return "concentrate"
    if " protein" in low and "concentrate" in low:
        return "concentrate"
    if " protein" in low:
        return "concentrate"
    if "plasma" in low:
        return "derivative"
    if "digest" in low:
        return "derivative"
    if "flavor" in low or "flavour" in low:
        return "derivative"
    if "dehydrated" in low:
        return "dried"
    if "dried" in low:
        return "dried"
    if "freeze" in low:
        return "dried"
    if "ground" in low:
        return "ground"
    if "whole" in low:
        return "whole"
    if "brewers" in low or "brewer's" in low:
        return "by_product"
    if "pearl" in low or "pearled" in low:
        return "whole"
    if "cracked" in low:
        return "whole"
    if "dehulled" in low:
        return "whole"
    if "malted" in low:
        return "flour"
    if "groats" in low:
        return "whole"
    if "grits" in low:
        return "ground"
    if "hulls" in low:
        return "fiber"
    if "skins" in low:
        return "derivative"
    if "corn protein meal" in low:
        return "concentrate"
    if "corn germ meal" in low:
        return "by_product"
    if "deboned" in low or "de-boned" in low or "boneless" in low:
        return "raw"
    if "raw" in low or "fresh" in low:
        return "raw"
    if "roasted" in low:
        return "raw"

    # For grains, legumes, roots, fruits, vegetables, seeds - default is "whole"
    # For animal proteins - default is "raw"
    if source_group in ("grain", "legume", "root", "fruit", "vegetable", "seed"):
        return "whole"
    return "raw"


def classify_family(name: str) -> Optional[Tuple[str, str]]:
    """
    Classify an ingredient into a family.
    Returns (family, source_group) or None.
    """
    cleaned = clean_for_matching(name)
    low_cleaned = cleaned.lower()
    low_name = name.lower()

    # Special cases: sweet_potato must be checked before potato
    if re.search(r"\bsweet\s+potato", low_name) or "yam" in low_name.split():
        return ("sweet_potato", "root")

    # Green bean must be checked before generic bean
    if re.search(r"\bgreen\s+bean", low_name):
        return ("green_bean", "vegetable")

    # Pumpkin seed -> pumpkin family, but pumpkin alone -> pumpkin fruit
    if re.search(r"\bpumpkin\s+seed", low_name):
        return ("pumpkin", "fruit")

    # Special: "Egg and Chicken Flavor/Flavour" -> chicken (the egg part is minor)
    if re.search(r"egg\s+and\s+chicken\s+flavo", low_name):
        return ("chicken", "poultry")

    # Special: "Chicken Liver and Duck" -> ambiguous (has both)
    # We'll classify as chicken since it's listed first and likely dominant
    if re.search(r"chicken\s+liver\s+and\s+duck", low_name):
        return ("chicken", "poultry")

    # Special: "Pork Liver and Lamb Liver" -> ambiguous
    # Classify as pork since listed first
    if re.search(r"pork\s+liver\s+and\s+lamb", low_name):
        return ("pork", "red_meat")

    # Special: "Lamb and Chicken Broth"
    if re.search(r"lamb\s+and\s+chicken\s+broth", low_name):
        return ("lamb", "red_meat")

    # Special: "Beef and Chicken Broth"
    if re.search(r"beef\s+and\s+chicken\s+broth", low_name):
        return ("beef", "red_meat")

    # Special: Beefhide
    if "beefhide" in low_name:
        return ("beef", "red_meat")

    # "Corn Starch-Modified" is still corn
    if "corn" in low_name and ("starch" in low_name or "grits" in low_name or "germ" in low_name):
        return ("corn", "grain")

    # CanolaOil (typo)
    if "canolaoil" in low_name:
        return ("canola", "seed")

    # Try all family rules on the original name
    for pattern, family, source_group, _ in FAMILY_RULES:
        if pattern.search(low_name):
            return (family, source_group)

    # Try on cleaned name if different
    if low_cleaned != low_name:
        for pattern, family, source_group, _ in FAMILY_RULES:
            if pattern.search(low_cleaned):
                return (family, source_group)

    return None


# ---------------------------------------------------------------------------
# Main build logic
# ---------------------------------------------------------------------------
def build_families() -> Dict[str, Any]:
    """Build the complete ingredient_families.json structure."""
    print("Collecting ingredients from all products...", file=sys.stderr)
    raw_counter = collect_all_ingredients()
    print(f"  Found {len(raw_counter)} unique raw ingredient strings", file=sys.stderr)
    print(f"  Total occurrences: {sum(raw_counter.values())}", file=sys.stderr)

    print("Normalizing (case-insensitive dedup)...", file=sys.stderr)
    normalized = normalize_ingredients(raw_counter)
    print(f"  {len(normalized)} unique normalized ingredients", file=sys.stderr)

    # Classification buckets
    families: Dict[str, Dict[str, Any]] = {}
    ambiguous: Dict[str, Dict[str, Any]] = {}
    ignore_list: List[str] = []
    unclassified: List[Tuple[str, int]] = []

    for _key, (canonical, count) in sorted(normalized.items()):
        name = canonical

        # 1. Check IGNORE
        if is_ignore(name):
            ignore_list.append(canonical)
            continue

        # 2. Check AMBIGUOUS
        amb = classify_ambiguous(name)
        if amb is not None:
            ambiguous[canonical] = amb
            continue

        # 3. Check FAMILY
        result = classify_family(name)
        if result is not None:
            family, source_group = result
            form = determine_form(name, source_group)
            is_hydrolyzed = bool(
                re.search(r"hydrolyz|hydrolyse|hydrolysate", name, re.I)
            )

            if family not in families:
                families[family] = {"source_group": source_group, "members": {}}

            member_data: Dict[str, Any] = {"form": form}
            if is_hydrolyzed:
                member_data["is_hydrolyzed"] = True

            families[family]["members"][canonical] = member_data
            continue

        # 4. Unclassified
        unclassified.append((canonical, count))

    # Build cross-reactivity groups (medically grounded per Martin 2004, Bexley 2017, Olivry 2022)
    cross_reactivity_groups: Dict[str, List[str]] = {
        "cattle_sheep": sorted([f for f in families if f in ("beef", "bison", "lamb", "goat", "dairy")]),
        "deer_elk": sorted([f for f in families if f in ("venison", "elk")]),
        "pork": sorted([f for f in families if f in ("pork", "wild_boar")]),
        "poultry": sorted([f for f in families if families[f]["source_group"] == "poultry"]),
        "fish": sorted([f for f in families if families[f]["source_group"] == "fish"]),
        "crustacean": sorted([f for f in families if families[f]["source_group"] == "crustacean"]),
        "mollusk": sorted([f for f in families if families[f]["source_group"] == "mollusk"]),
    }
    # Remove empty or single-family groups (cross-reactivity needs 2+ families)
    cross_reactivity_groups = {k: v for k, v in cross_reactivity_groups.items() if len(v) >= 2}

    # Sort ignore list
    ignore_list.sort(key=lambda x: x.lower())

    # Regex patterns for scraper artifacts that slip through parse_ingredients
    # but aren't individual ingredient strings (misparses, concatenated vitamin
    # lists, metadata leaks). Used by tests to cover edge cases.
    artifact_patterns = [
        r"^\)",                              # leading close-paren fragment
        r"\),\s*\w",                         # mid-string "), <word>" — vitamin list continuation
        r"^Item Number:",                    # PetSmart metadata
        r"^Species:\s+Dog",                  # Nutro metadata
        r"^Made in the USA$",                # marketing text
        r"^Real Meat First$",               # marketing text
        r"Stella.*Solutions",               # Stella & Chewy's product line names
        r"9a Preservative\)",               # OCR error for "(a Preservative)"
        r"^Amino Acid Complex$",            # generic mineral chelate fragment
    ]

    output = {
        "families": dict(sorted(families.items())),
        "cross_reactivity_groups": cross_reactivity_groups,
        "ambiguous": dict(sorted(ambiguous.items(), key=lambda x: x[0].lower())),
        "ignore_for_correlation": ignore_list,
        "ignore_patterns": artifact_patterns,
    }

    # Print summary to stderr
    total_classified = sum(len(f["members"]) for f in families.values())
    total_ambiguous = len(ambiguous)
    total_ignored = len(ignore_list)
    total_unclassified = len(unclassified)
    total_all = total_classified + total_ambiguous + total_ignored + total_unclassified

    print("\n" + "=" * 60, file=sys.stderr)
    print("INGREDIENT CLASSIFICATION SUMMARY", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print(f"Total unique ingredients:     {total_all}", file=sys.stderr)
    print(f"  Classified into families:   {total_classified} ({total_classified/total_all*100:.1f}%)", file=sys.stderr)
    print(f"  Ambiguous:                  {total_ambiguous} ({total_ambiguous/total_all*100:.1f}%)", file=sys.stderr)
    print(f"  Ignored (supplements etc):  {total_ignored} ({total_ignored/total_all*100:.1f}%)", file=sys.stderr)
    print(f"  UNCLASSIFIED:               {total_unclassified} ({total_unclassified/total_all*100:.1f}%)", file=sys.stderr)
    print(f"\nFamilies: {len(families)}", file=sys.stderr)
    for family_name in sorted(families.keys()):
        fam = families[family_name]
        print(f"  {family_name} ({fam['source_group']}): {len(fam['members'])} members", file=sys.stderr)

    print(f"\nAmbiguous entries: {total_ambiguous}", file=sys.stderr)
    for name, info in sorted(ambiguous.items(), key=lambda x: x[0].lower()):
        print(f"  {name} -> {info['source_group']}: could be {info['could_be']}", file=sys.stderr)

    if unclassified:
        print(f"\nUNCLASSIFIED ({total_unclassified}):", file=sys.stderr)
        for name, count in sorted(unclassified, key=lambda x: -x[1]):
            print(f"  {count:4d}x  {name}", file=sys.stderr)
    else:
        print("\nNo unclassified ingredients!", file=sys.stderr)

    return output


def main() -> None:
    output = build_families()

    # Write output
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nWrote {OUTPUT_FILE}", file=sys.stderr)


if __name__ == "__main__":
    main()
