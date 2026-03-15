# New Brand Scrapers — TODO

## Up Next

Prioritized by catalog size, scraping difficulty, and relevance to digestive tracking.

1. **Zignature** (~46 dog food products, 65 total with treats) — zignature.com. WordPress + WooCommerce. Easy scrape. LID specialist, relevant for digestive tracking / elimination diets.
  - Stack: WordPress + WooCommerce + Yoast SEO, server-rendered
  - Discovery: WooCommerce Store API at `/wp-json/wc/store/v1/products?per_page=100&_fields=id,name,slug,permalink,type` returns all 65 products in one JSON call (no pagination needed)
  - Product URLs: `/products/{slug}/`
  - Ingredients: plain text under "Ingredients" heading
  - GA: label/value pairs under "Nutrition" heading. Dry food includes Omega 6/3, Taurine, L-Carnitine, Total Microorganisms beyond standard 4. Wet/treats have standard 4 only.
  - Calories: `Kcal per KG` + `Kcal per Cup` (dry) / `Kcal per Can` (wet) / `Kcal per Treat` in "How to Feed" section
  - Gotcha: page content rendered twice (desktop + mobile layout) — grab first occurrence
  - Lines: Original (~13), Small Bites (5), Select Cuts (4), Inception (3), Essence LIR (3), plus ~18 wet and ~19 treats
2. **President's Choice (Loblaw)** (~19-25 unique dog food formulas) — loblaws.ca. Highest grocery shelf presence in Canada (Loblaw/No Frills/Superstore). "Sensitive Skin & Stomach" line relevant for digestive tracking.
  - Stack: Custom SPA ("Bronx" framework, React-based), Akamai Bot Manager
  - Discovery: Collection page at `https://www.loblaws.ca/en/collection/pc-nutrition-first` SSRs product tiles (names, product codes, URLs) — no browser needed
  - Product detail: PDPs require Playwright rendering (SPA shell only via HTTP). Full ingredients, GA, and calories present in rendered DOM
  - BFF API: `api.pcexpress.ca/pcx-bff/api/v1/products/{productCode}` returns 401 (OAuth client_credentials, token flow buried in obfuscated Bronx SPA — not extractable)
  - Ingredients: plain text after `<strong>Ingredients</strong>:`, GA: `<ul>` list items (6 fields including omega-3/6), Calories: inline `Calorie:XXXX kcal/kg - XXX kcal per cup`
  - Images: `digital.loblaws.ca/PCX/{productCode}/en/1/{code}_en_front_800.png` — 800x800 PNG, no auth, direct HTTP download
  - Sub-brands: Nutrition First (~19 formulas), PC Extra Meaty (~3 formulas), Nutrition First wet (stews)
  - Approach: Playwright DOM scraping (manual JSON file, no automated re-scrape). Small catalog (~25 products) makes one-time Playwright extraction practical.
3. **Nutram** (~18 dog food, 22 total with treats) — nutram.com. Shopify. Canadian-made (Elmira, ON), solution-based formulas for skin/stomach issues. Widely available in Canadian independents. All dry food only.
  - Stack: Shopify (Liquid theme), server-rendered HTML
  - Discovery: `/collections/all-dogs/products.json?limit=250` returns all product handles and metadata. Also `/sitemap_products_1.xml`
  - Product URLs: `/products/{handle}`
  - Ingredients: plain text after "Ingredients List" heading (skip marketing blurb before it)
  - GA: HTML table with protein, fat, fibre, moisture, calcium, phosphorus, omega-3/6, glucosamine
  - Calories: `CALORIE CONTENT: (calculated metabolizable energy) is X,XXX kcal/kg (XXX kcal/cup)`. 4 dental treats missing calorie data.
  - Note: Shopify JSON API (`/products/{handle}.json`) only has marketing copy — must scrape HTML pages for nutritional data
  - Lines: S-series (Sound Balanced Wellness, 9), I-series (Ideal Solution Support, 3), T-series (Total Grain-Free, 6), plus 4 dental treats

## Do It Later

- [ ] **Oven-Baked Tradition** (~20-25 products) — ovenbakedtradition.com. Canadian-made (Quebec). Decent presence in independents and some Pet Valu.
- [ ] **Horizon (Pulsar/Legacy)** (~15-20 products) — horizonpetfood.com. Canadian (Saskatchewan), probiotics in all formulas. Regional distribution (mainly western Canada).
- [ ] **Petkind** (~15-20 products) — petkind.com. Canadian (BC). Green tripe-based formulas targeted at digestive health. Niche retailer distribution.
- [ ] **Holistic Select** (~10-15 products) — holisticselect.com. Digestive health is core brand positioning (prebiotics, probiotics, enzymes in every formula). Limited Canadian shelf space.

## Skipped

- **Virbac (Veterinary HPM)** — Only 4 products in Canada, GA as images (no text), no calorie data. Not worth scraping.
- **Victor** (~31 products) — victorpetfood.com. Easy scrape but limited Canadian distribution. Primarily US brand.
- **Carna4** (~6-8 products) — carna4.com. Canadian-made but catalog too small to justify a scraper.
- **Cesar** (~5 unique foods + 1 treat after removing 9 variety packs) — petsmart.ca. PetSmart RSC pipeline won't work (nutritional data not in RSC payloads, only in Algolia listing JSON). 2/5 foods missing calories, inconsistent ingredient detail. cesar.ca has nutrition as images only. Too few products with too many data quality issues.
