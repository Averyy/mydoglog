"""Natural Balance scraper (via PetSmart.ca).

Manufacturer site (naturalbalanceinc.com) has ingredients as images only.
PetSmart is the only viable source for structured ingredient data.
~51 dog products. LID (Limited Ingredient Diets) line relevant for digestive tracking.

Note: Health Protection line products are missing ingredient data in PetSmart's
RSC payload — ingredients extracted manually from manufacturer product images.
"""

import logging
from pathlib import Path

from .petsmart import scrape_petsmart_brand

logger = logging.getLogger(__name__)

# PetSmart RSC is missing ingredients for Health Protection products.
# Extracted manually from manufacturer product images (Mar 2026).
_MANUAL_PRODUCT_DATA: dict[str, dict] = {
    "87732.html": {
        "ingredients_raw": "Lamb, Lamb Meal (Source of Glucosamine & Chondroitin Sulfate), Brown Rice, Oatmeal, Whole Grain Sorghum, Pearled Barley, Peas, Dried Yeast, Chicken Meal (Source of Glucosamine & Chondroitin Sulfate), Pumpkin, Chicken Fat (Preserved with Mixed Tocopherols), Flaxseed, Dried Plain Beet Pulp, Natural Flavor, Salmon Oil, Dried Chicory Root, Vitamins (Vitamin E Supplement, Ascorbic Acid, Niacin Supplement, Vitamin A Supplement, Thiamine Mononitrate, d-Calcium Pantothenate, Riboflavin Supplement, Pyridoxine Hydrochloride, Vitamin B12 Supplement, Folic Acid, Vitamin D3 Supplement, Biotin), Choline Chloride, Potassium Chloride, Minerals (Zinc Proteinate, Zinc Sulfate, Ferrous Sulfate, Iron Proteinate, Copper Sulfate, Copper Proteinate, Sodium Selenite, Manganese Sulfate, Manganese Proteinate, Calcium Iodate), Salt, Taurine, DL-Methionine, Mixed Tocopherols (Preservative), Dried Bacillus coagulans Fermentation Product, Rosemary Extract",
    },
    "87734.html": {
        "ingredients_raw": "Salmon, Menhaden Fish Meal (Source of Glucosamine & Chondroitin Sulfate), Brown Rice, Oatmeal, Whole Grain Sorghum, Chicken Meal (Source of Glucosamine & Chondroitin Sulfate), Pearled Barley, Peas, Pumpkin, Chicken Fat (Preserved with Mixed Tocopherols), Brewers Rice, Flaxseed, Dried Plain Beet Pulp, Natural Flavor, Dried Yeast, Dried Chicory Root, Salmon Oil, Vitamins (Vitamin E Supplement, Ascorbic Acid, Niacin Supplement, Vitamin A Supplement, Menadione Sodium Bisulfite Complex, Thiamine Mononitrate, d-Calcium Pantothenate, Riboflavin Supplement, Pyridoxine Hydrochloride, Vitamin B12 Supplement, Folic Acid, Biotin), Choline Chloride, Potassium Chloride, Minerals (Zinc Proteinate, Zinc Sulfate, Ferrous Sulfate, Iron Proteinate, Copper Sulfate, Copper Proteinate, Sodium Selenite, Manganese Sulfate, Manganese Proteinate, Calcium Iodate), Taurine, Salt, DL-Methionine, Mixed Tocopherols (Preservative), Dried Bacillus coagulans Fermentation Product, Rosemary Extract",
    },
    "87741.html": {
        "ingredients_raw": "Chicken, Chicken Meal (Source of Glucosamine & Chondroitin Sulfate), Brown Rice, Oatmeal, Whole Grain Sorghum, Peas, Pearled Barley, Turkey Meal (Source of Glucosamine & Chondroitin Sulfate), Pumpkin, Chicken Fat (Preserved with Mixed Tocopherols), Flaxseed, Dried Plain Beet Pulp, Natural Flavor, Salmon Oil, Dried Chicory Root, Vitamins (Vitamin E Supplement, Ascorbic Acid, Niacin Supplement, Vitamin A Supplement, Thiamine Mononitrate, d-Calcium Pantothenate, Riboflavin Supplement, Pyridoxine Hydrochloride, Vitamin B12 Supplement, Folic Acid, Vitamin D3 Supplement, Biotin), Choline Chloride, Taurine, Minerals (Zinc Proteinate, Zinc Sulfate, Ferrous Sulfate, Iron Proteinate, Copper Sulfate, Copper Proteinate, Sodium Selenite, Manganese Sulfate, Manganese Proteinate, Calcium Iodate), Salt, Potassium Chloride, DL-Methionine, Mixed Tocopherols (Preservative), Dried Bacillus coagulans Fermentation Product, Rosemary Extract",
    },
    "87733.html": {
        "ingredients_raw": "Chicken, Chicken Meal (Source of Glucosamine & Chondroitin Sulfate), Brown Rice, Oatmeal, Whole Grain Sorghum, Peas, Pearled Barley, Turkey Meal (Source of Glucosamine & Chondroitin Sulfate), Pumpkin, Chicken Fat (Preserved with Mixed Tocopherols), Flaxseed, Dried Plain Beet Pulp, Natural Flavor, Salmon Oil, Dried Chicory Root, Vitamins (Vitamin E Supplement, Ascorbic Acid, Niacin Supplement, Vitamin A Supplement, Thiamine Mononitrate, d-Calcium Pantothenate, Riboflavin Supplement, Pyridoxine Hydrochloride, Vitamin B12 Supplement, Folic Acid, Vitamin D3 Supplement, Biotin), Choline Chloride, Taurine, Minerals (Zinc Proteinate, Zinc Sulfate, Ferrous Sulfate, Iron Proteinate, Copper Sulfate, Copper Proteinate, Sodium Selenite, Manganese Sulfate, Manganese Proteinate, Calcium Iodate), Salt, Potassium Chloride, DL-Methionine, Mixed Tocopherols (Preservative), Dried Bacillus coagulans Fermentation Product, Rosemary Extract",
    },
}


# PetSmart lists the same product twice with different SKUs (different bag sizes)
_SKIP_URLS: set[str] = {
    "59502.html",  # Dupe of 71969 (LID Lamb & Brown Rice, different bag size)
}


def _detect_sub_brand(name: str) -> str | None:
    """Detect Natural Balance sub-brand from product name."""
    name_lower = name.lower()
    if "l.i.d." in name_lower or "limited ingredient" in name_lower:
        return "L.I.D. Limited Ingredient Diets"
    if "original ultra" in name_lower:
        return "Original Ultra"
    if "ultra premium" in name_lower:
        return "Ultra Premium"
    if "health protection" in name_lower:
        return "Health Protection"
    if "specialized nutrition" in name_lower:
        return "Specialized Nutrition"
    return None


def scrape_naturalbalance(output_dir: Path) -> int:
    """Scrape all Natural Balance dog products from PetSmart. Returns product count."""
    return scrape_petsmart_brand(
        output_dir,
        brand_name="Natural Balance",
        slug="naturalbalance",
        brand_slug="natural-balance",
        detect_sub_brand=_detect_sub_brand,
        manual_product_data=_MANUAL_PRODUCT_DATA,
        skip_url_patterns=_SKIP_URLS,
    )
