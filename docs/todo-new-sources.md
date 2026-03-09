# New Brand Scrapers — TODO

## PetSmart.ca RSC Pattern (reuse Authority/Iams scraper)

- [ ] **Natural Balance** (~55-60 products) — petsmart.ca, same RSC flight payload pattern as Authority/Iams/Pedigree. Manufacturer site (naturalbalanceinc.com) has ingredients as images only — PetSmart is the only viable source. LID line relevant for digestive tracking.
- [ ] **Instinct (Nature's Variety)** (~104 products) — instinctpetfood.com, WordPress SSR. Sitemap at `wp-sitemap-posts-product-1.xml` for discovery. Ingredients/GA/calories in plain HTML (`ingredients-accordion` section). No anti-bot. ~46 of these on PetSmart CA. Raw-focused with freeze-dried, frozen, kibble, and wet lines.
- [ ] **Simply Nourish** (~34 products) — petsmart.ca only (PetSmart private label). Same RSC pattern. Sensitive stomach lines.
- [ ] **Nulo** (~60-80 products) — nulo.com, Shopify. Gut health focus, sold at PetSmart. Need to verify page structure.

## Manufacturer Sites

- [ ] **Canidae** (~40-50 products) — canidae.com, BigCommerce. Ingredients/GA in structured HTML. LID "Pure" line for sensitivities.
- [ ] **Eukanuba** (~20 products) — eukanuba.com/ca, Canadian site confirmed. Ingredients, GA table, and calories in plain HTML. Mars brand.
- [ ] **Nutram** (~25-30 products) — nutram.com. Canadian-made, solution-based formulas for skin/stomach. Need to investigate site structure.

## Lower Priority

- [ ] **Holistic Select** (~10-15 products) — holisticselect.com. Digestive health is core brand positioning (prebiotics, probiotics, enzymes in every formula).
- [ ] **Petkind** (~15-20 products) — petkind.com. Green tripe-based formulas targeted at digestive health.
- [ ] **Horizon (Pulsar/Legacy)** (~15-20 products) — horizonpetfood.com. Canadian (Saskatchewan), probiotics in all formulas.
- [ ] **Oven-Baked Tradition** (~20-25 products) — ovenbakedtradition.com. Canadian-made (Quebec).
- [ ] **Carna4** (~6-8 products) — carna4.com. Canadian-made, very small catalog.

## Skipped

- **Virbac (Veterinary HPM)** — Only 4 products in Canada, GA as images (no text), no calorie data. Not worth scraping.
