# New Brand Scrapers — TODO

## PetSmart.ca RSC Pattern

All use shared `scrapers/petsmart.py` module with wafer-py `SyncSession(rate_limit=2.0)`.

- [x] **Simply Nourish** (59 products) — petsmart.ca only (PetSmart private label). Featured-brands pagination discovery. Done.
  - Discovery: `https://www.petsmart.ca/featured-brands/simply-nourish/f/pet/dog?page=N`
- [x] **Natural Balance** (51 products) — petsmart.ca, RSC flight payload. Manufacturer site has ingredients as images only — PetSmart is the only viable source. LID line relevant for digestive tracking. Done. Fixed `%.` GA splitting bug affecting calcium values in 3 Specialized Nutrition products.
  - Discovery: `https://www.petsmart.ca/featured-brands/natural-balance/f/pet/dog?page=N`
- [x] **Instinct (Nature's Variety)** (37 products) — instinctpetfood.com has ~104 but ingredients as images. PetSmart RSC for Canadian subset. Done.
  - Discovery: `https://www.petsmart.ca/featured-brands/instinct/f/pet/dog?page=N`
- [x] **Nulo** (33 products) — nulo.com is Shopify but PetSmart has the Canadian subset with RSC data. Done. 3 products have manual data (2 missing GA, 1 missing calories) sourced from nulo.com.
  - Discovery: `https://www.petsmart.ca/featured-brands/nulo/f/pet/dog?page=N`
- [x] **Canidae** (15 products) — canidae.com uses BigCommerce + Vue.js (ingredients load client-side, not in HTML). Not on Chewy CA. PetSmart is the only viable source. Done. 1 product has manual calorie data, 2 size dupes skipped.
  - Discovery: `https://www.petsmart.ca/featured-brands/canidae/f/pet/dog?page=N`
- [x] **Eukanuba** (8 products) — eukanuba.com/ca has data in HTML but PetSmart provides consistent format. No featured-brands page — uses search. Done. 1 product has manual GA/calorie override (PetSmart had wrong min/max labels).
  - Discovery: `https://www.petsmart.ca/search/f/pet/dog?q=Eukanuba&page=N`

- [x] **Purina (Retail)** (97 products) — petsmart.ca, multi-brand filter URL covering 7 sub-brands (Pro Plan, ONE, Beneful, Beyond, DentaLife, Beggin', Dog Chow/Puppy Chow). Single `scrape_petsmart_brand()` call. Done. 1 manual calorie override (Beggin' Chew-Rific). RSC chunk supplementing for pages where GA is in a separate chunk from ingredients.
  - Discovery: `https://www.petsmart.ca/dog/f/brand/beggin%27%20strips+beyond+dentalife+purina%20dog%20chow+purina%20one+purina%20pro%20plan+purina%20puppy%20chow?page=N`
- [ ] **Cesar** (~30 products, ~12-15 unique after removing variety packs) — Mars brand (same parent as Iams, Pedigree, Nutro). Popular wet food. cesar.ca has all nutrition as images (not viable).
  - Discovery: `https://www.petsmart.ca/featured-brands/cesar/f/pet/dog?page=N`

## Manufacturer Sites

- [x] **Rachael Ray Nutrish** (36 products: 28 food + 8 treats) — nutrish.com. WordPress SSR, Bootstrap accordion structure. Done. 2 discontinued products (Big Life) auto-skipped, 9 variety packs skipped.
  - Discovery: WordPress product sitemap (`wp-sitemap-posts-product-1.xml`), filters dog products by slug
  - Product URLs: `/product/{slug}/`
  - Ingredients: plain text in accordion, GA: `...` separated format, Calories: kcal/kg + kcal/cup
  - Not on walmart.ca or petsmart.ca in Canada
- [ ] **Fromm** (~113 dog products) — frommfamily.com. Umbraco CMS, server-rendered HTML. Easy scrape.
  - Stack: Umbraco (ASP.NET) + Vue.js frontend, Cloudflare CDN
  - Discovery: `/sitemap` HTML page has all product URLs organized by line/format. Best source (API at `/umbraco/surface/product/ProductFilterSearchNew/` requires Cloudflare cookies)
  - Product URLs: `/products/dog/{product-line}/{format}/{slug}/`
  - Ingredients: plain text (ingredients are links but text extractable), GA: standard format ("Crude Protein 24% MIN"), Calories: kcal/kg + kcal/lb + kcal/cup (dry) or kcal/kg + kcal/can (wet)
  - Vitamin blocks in brackets. ~18 treats, ~4 cracker snacks — filter if needed
- [ ] **Zignature** (~46 dog food products, 65 total with treats) — zignature.com. WordPress + WooCommerce. Easy scrape. LID specialist, relevant for digestive tracking.
  - Stack: WordPress + WooCommerce + Elementor Pro, server-rendered
  - Discovery: WooCommerce Store API at `/wp-json/wc/store/v1/products?per_page=100&_fields=id,name,slug,permalink,type` returns all products in one JSON call
  - Product URLs: `/products/{slug}/`
  - Ingredients: plain text under "Ingredients" heading, GA: definition list rows, Calories: kcal/kg + kcal/cup in "How to Feed" section
  - Lines: Original (49), Select Cuts (4), Inception (6), Essence (6)
- [ ] **Victor** (~31 dog food products) — victorpetfood.com (redirects from victordogfood.com). Drupal SSR. Easy scrape.
  - Stack: Drupal + Bootstrap 3, server-rendered, no SPA
  - Discovery: `/products` — all products on single page, no pagination. Client-side filter checkboxes but all in initial HTML
  - Product URLs: `/products/{slug}/`
  - Ingredients: plain text under "Full ingredient list", GA: definition lists (`Crude Protein (Min.): 30.0%`), Calories: kcal/kg + kcal/cup inline
  - Bonus: full "Typical Analysis" table with actual nutrient values beyond GA minimums

## Grocery / Mass-Market

- [x] **Kirkland Signature (Costco)** (10 products) — Diamond-manufactured. costco.ca is a JS-rendered SPA with nutrition in PDFs only. US (costco.com) product pages have identical formulas (verified vs AU) with ingredients/GA/calories as plain text. Biscuit data from packaging photo. Done, verified.
  - Discovery: hardcoded CA catalog (10 products, variety pack skipped)
  - Nutrition: costco.com US product detail pages (wafer-py, server-rendered HTML). US repackaged 35lb→25lb but ingredients identical to CA/AU.
  - Manual: Chicken Meal & Rice Biscuits (US page lacks nutrition data)
  - Note: Dental Chews has no calorie data on US page
- [ ] **President's Choice (Loblaw)** (~30-40 dog food products) — loblaws.ca. Custom SPA ("Bronx" framework), Akamai bot protection. Moderate difficulty — needs Playwright.
  - presidentschoice.ca redirects to pcoptimum.ca (no product pages)
  - Collection: `https://www.loblaws.ca/en/collection/pc-nutrition-first` (Nutrition First sub-brand, ~19 unique dog formulas)
  - Additional budget-tier PC products (Extra Meaty, etc.) via search
  - Product URLs: `/en/{slug}/p/{productCode}_EA`
  - Ingredients: text in expandable Description section, GA: structured list, Calories: text string (e.g. "3340 kcal/kg - 367 kcal per cup")
  - API: `api.pcexpress.ca/pcx-bff/api/v1/products/{productCode}` exists but returns 403 (Akamai). Must use Playwright to render SPA
## Do It Later

- [ ] **Nutram** (~25-30 products) — nutram.com. Canadian-made, solution-based formulas for skin/stomach. Need to investigate site structure.
- [ ] **Holistic Select** (~10-15 products) — holisticselect.com. Digestive health is core brand positioning (prebiotics, probiotics, enzymes in every formula).
- [ ] **Petkind** (~15-20 products) — petkind.com. Green tripe-based formulas targeted at digestive health.
- [ ] **Horizon (Pulsar/Legacy)** (~15-20 products) — horizonpetfood.com. Canadian (Saskatchewan), probiotics in all formulas.
- [ ] **Oven-Baked Tradition** (~20-25 products) — ovenbakedtradition.com. Canadian-made (Quebec).
- [ ] **Carna4** (~6-8 products) — carna4.com. Canadian-made, very small catalog.

## Skipped

- **Virbac (Veterinary HPM)** — Only 4 products in Canada, GA as images (no text), no calorie data. Not worth scraping.
