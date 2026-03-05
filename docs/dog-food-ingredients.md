# Ingredient Families Reference

> Canonical reference for `scraper/data/ingredient_families.json` — how scraped ingredients are classified into families for allergy/sensitivity correlation.

## Overview

| Stat | Count |
|------|-------|
| Families | 91 |
| Total members | 936 |
| Ambiguous entries | 71 |
| Ignored (vitamins/minerals/additives) | ~1150 |
| Cross-reactivity groups | 5 |

## How It Works

Each scraped product has a raw ingredient string. `build.py` parses it (bracket-aware comma splitting) and looks up each ingredient in `ingredient_families.json`. Per ingredient we store:

1. **Family** — what animal/plant is it from? (chicken, beef, rice, salmon, etc.)
2. **Source group** — broader category for grouping (poultry, red_meat, fish, grain, legume, etc.)
3. **Form** — what processing? (raw, meal, by_product, fat, oil, hydrolyzed, flour, bran, etc.)
4. **Is hydrolyzed?** — flagged because hydrolyzed proteins may not trigger allergies the same way

Family powers the correlation engine. Source group enables group-level analysis. Form is metadata for context.

## Source Groups

| Group | Families |
|-------|----------|
| **poultry** | chicken, duck, quail, turkey |
| **red_meat** | beef, bison, goat, lamb, pork, venison, wild_boar |
| **fish** | arctic_char, capelin, clam, cod, flounder, haddock, hake, herring, mackerel, menhaden, monkfish, perch, pollock, rockfish, salmon, sardine, shrimp, sole, tilapia, trout, tuna, whitefish |
| **grain** | barley, corn, millet, oat, quinoa, rice, rye, sorghum, wheat |
| **legume** | bean, chickpea, lentil, pea, peanut, soy |
| **root** | beet, potato, sweet_potato, tapioca |
| **fruit** | apple, avocado, banana, blackberry, blueberry, cranberry, papaya, pear, pineapple, pomegranate, pumpkin, raspberry, strawberry, tomato, watermelon |
| **seed** | borage, canola, chia, coconut, flaxseed, hemp, safflower, sunflower |
| **vegetable** | broccoli, carrot, collard, green_bean, kale, pepper, spinach, turnip, zucchini |
| **dairy** | dairy |
| **egg** | egg |
| **exotic** | crocodile, elk, kangaroo, rabbit |
| **other** | algae |

## Form Types

Forms describe the processing state of an ingredient. Valid values in the DB enum:

| Form | Description | Example |
|------|-------------|---------|
| `raw` | Fresh/unprocessed | Chicken, Fresh Salmon |
| `whole` | Whole food item | Brown Rice, Peas, Apples |
| `meal` | Rendered/dehydrated concentrate | Chicken Meal, Lamb Meal |
| `by_product` | Secondary processing output | Chicken By-Product Meal |
| `fat` | Rendered animal fat | Chicken Fat, Beef Fat |
| `oil` | Extracted plant/fish oil | Salmon Oil, Canola Oil |
| `hydrolyzed` | Enzymatically broken proteins | Hydrolyzed Chicken |
| `flour` | Ground into flour | Rice Flour, Wheat Flour |
| `bran` | Outer grain layer | Oat Bran, Wheat Bran |
| `organ` | Organ meats | Chicken Liver, Beef Tripe |
| `dried` | Dehydrated whole ingredient | Dried Egg, Dehydrated Beef |
| `broth` | Liquid extract | Chicken Broth, Bone Broth |
| `ground` | Mechanically ground | Ground Flaxseed |
| `fiber` | Fiber extracted | Pea Fiber, Apple Fibre |
| `concentrate` | Protein concentrate | Pea Protein, Soy Protein Concentrate |
| `starch` | Starch extracted | Potato Starch, Corn Starch |
| `gluten` | Gluten extracted | Corn Gluten Meal, Wheat Gluten |
| `derivative` | Flavors/digest/gelatin | Natural Chicken Flavor, Pork Gelatin |

Additional forms used in the JSON that map to DB values: `whole`→`raw`, `organ`→`raw`, `dried`→`raw`, `concentrate`→`raw`, `starch`→`raw`, `fiber`→`raw`, `broth`→`raw`, `gluten`→`raw`, `derivative`→`raw`, `ground`→`raw`, `extract`→`raw`. The JSON retains the specific form for accuracy; `build.py` maps to the DB enum.

## Cross-Reactivity Groups

Dogs allergic to one protein may react to related ones. Stored for the correlation engine to surface as warnings, not hard equivalences.

| Group | Families | Biological basis |
|-------|----------|-----------------|
| **poultry** | chicken, turkey, duck, quail | Galloanserae — shared albumin/IgG proteins |
| **ruminant** | beef, bison, lamb, venison, goat | Bovidae/Cervidae — shared serum albumin |
| **pork** | pork, wild_boar | Same species (Sus scrofa) |
| **fish** | All 22 fish families | Shared parvalbumins (finfish) |
| **shellfish** | clam, shrimp | Tropomyosin-driven (distinct from finfish) |

Note: clam and shrimp are in the `fish` source group for simplicity but have distinct allergen profiles from finfish. The `shellfish` cross-reactivity group captures this distinction.

## Ambiguous Ingredients

Some ingredients don't specify the exact species. These are tracked separately with a `could_be` list of possible families.

| Example | Could be | Source group |
|---------|----------|-------------|
| Meat Meal | beef, pork, lamb | red_meat |
| Poultry By-Product Meal | chicken, turkey, duck | poultry |
| Animal Fat | beef, pork, chicken | other |
| Fish Meal | any fish | fish |
| Animal Digest | any animal | other |

For correlation: ambiguous ingredients match ALL possible families with lower confidence.

## Hydrolyzed Proteins

Hydrolyzed = proteins broken into small peptides to avoid triggering immune response. Common in vet elimination diets (Hill's z/d, Purina HA, Royal Canin HP).

Flagged with `"is_hydrolyzed": true` in the JSON because:
- A dog allergic to chicken might tolerate Hydrolyzed Chicken
- Correlation engine should distinguish "chicken" from "hydrolyzed chicken"

## Ignored Ingredients

~1150 ingredients are excluded from correlation analysis: vitamins, minerals, amino acid supplements, preservatives, thickeners, colorants, probiotics, and other additives that are standardized across brands and irrelevant to food sensitivities.

Examples: Zinc Sulfate, Vitamin A Supplement, Ferrous Sulfate, Mixed Tocopherols, Guar Gum, Potassium Chloride.

## `ingredient_families.json` Structure

```json
{
  "families": {
    "chicken": {
      "source_group": "poultry",
      "members": {
        "Chicken": { "form": "raw" },
        "Chicken Meal": { "form": "meal" },
        "Chicken Fat": { "form": "fat" },
        "Chicken Liver": { "form": "organ" },
        "Hydrolyzed Chicken": { "form": "hydrolyzed", "is_hydrolyzed": true }
      }
    }
  },
  "ambiguous": {
    "Meat Meal": { "could_be": ["beef", "pork", "lamb"], "source_group": "red_meat" }
  },
  "ignore_for_correlation": ["Zinc Sulfate", "Vitamin A Supplement", "..."],
  "cross_reactivity_groups": {
    "poultry": ["chicken", "turkey", "duck", "quail"],
    "ruminant": ["beef", "bison", "lamb", "venison", "goat"],
    "pork": ["pork", "wild_boar"]
  }
}
```

## Maintenance

When `build.py` reports unknown ingredients:
1. Check if it's a variant of an existing family member (add to that family)
2. Check if it's a new family entirely (create new family with source_group)
3. Check if it's ambiguous (add to ambiguous section)
4. Check if it's a vitamin/mineral/additive (add to ignore list)
5. If it's a scraper artifact (product name in ingredient text), fix the scraper

Never add display-time bandaids in the app — fix data quality in the scraper/build pipeline.
