# Canadian Dog Food Brands — Scraper Reference

Last updated: 2026-03-02

## Scraper Status

| Brand | Products | Channel | Ingredients | GA | Calories | Status |
|-------|----------|---------|-------------|-----|----------|--------|
| Royal Canin | 153 | retail+vet | 100% | 100% | 100% | Done |
| Purina | 196 | retail+vet | 100% | 97% | 97% | Done |
| Hill's | 148 | retail+vet | 100% | 100% | 100% | Done |
| Go! Solutions | 43 | retail | 100% | 100% | 100% | Done |
| Now Fresh | 22 | retail | 100% | 100% | 100% | Done |
| Taste of the Wild | 21 | retail | 100% | 100% | 100% | Done |
| FirstMate | 53 | retail | 100% | 100% | 100% | Done |
| Canadian Naturals | 20 | retail | 100% | 100% | 100% | Done |
| Nutrience | 76 | retail | 100% | 93% | 92% | Done |
| Rayne | 24 | vet | 100% | 50% | 100% | Done (static GA lookup) |
| Acana + Orijen | 60 | retail | 100% | 100% | 100% | Done |
| Open Farm | 129 | retail | 100% | 91% | 93% | Done |
| Blue Buffalo | 163 | retail | 100% | 100% | 77% | Done |
| Performatrin | 84 | retail | 100% | 100% | 95% | Done |
| Iams | 23 | retail | 100% | 100% | 100% | Done |
| Authority | 45 | retail | 100% | 100% | 100% | Done |

**Total scraped:** 1,260 products (100% with ingredients, 97% GA, 95% calories)

---

## Brand Details

### Big 3

**Royal Canin** — `royalcanin.com/ca` | REST API
- Listing: `POST rc-api.royalcanin.com/internal/product-digital-shelf/products/facets` (header: `ocp-apim-subscription-key: c38cb7c1224146569e41a2f2d01359fc`)
- Detail: `GET rc-api.royalcanin.com/internal/product/v2/products/mainitem/{code}/en_CA`
- All JSON, no HTML parsing. Ingredients, GA, calories, AAFCO, images, variants all in API.

**Purina** — `purina.ca` | Gatsby + Drupal
- Discovery: `GET live-purina-canada-h20.pantheonsite.io/api/search/products?species=1117&page={0-17}` (12/page)
- Detail: `GET purina.ca/page-data/{path}/page-data.json` — structured JSON
- Ingredients in `result.data.node.relationships.ingredients` array
- GA in `result.data.node.guaranteedAnalysis.processed` (HTML table), fallback to `feeding_instructions.processed`
- Calories: primary in GA HTML, fallback to `feeding_instructions.processed` (heading-based extraction avoids footnote false positives)
- Sub-brands: Pro Plan, PPVD (vet), ONE, Beneful, Beyond, Beggin', DentaLife
- Static fallback (`_FALLBACK_DATA`): 8 products backfilled from Chewy.ca, PetSmart US, Purina PDF — DentaLife chews (2), ALPO Moist & Meaty (2), Beyond wet (1), HA Hydrolyzed dry (1), FortiFlora powder + tablets (2)
- Missing GA (5/196): vet supplements that don't publish standard GA — Joint Care S/M + M/L, FortiFlora PRO Synbiotic, Multi Care, Calming Care
- Missing calories (5/196): same 5 vet supplements

**Hill's** — `hillspet.ca` | Adobe Experience Manager
- Discovery: sitemap at `hillspet.ca/en-ca/sitemap.xml`
- Detail: server-rendered HTML — accordion panels for ingredients + GA
- `window.dataLayer` script has SKU, brand, condition, species metadata
- US fallback: `hillspet.com` used for missing ingredients/GA/calories (same formulations, identical HTML structure)
- Static fallback (`_FALLBACK_DATA`): 36 products backfilled from Chewy + MyVetStore — 10 retail treats, 12 vet wet foods, 9 retail wet/variety packs, 1 dry (Healthy Mobility: ingredients + GA + calories from Chewy.ca + hillspet.com US), 4 PD treats (calories back-calculated from MyVetStore caloric basis data, names corrected)
- Chewy fallback removed — search never matched Hill's products (0/36), static fallback covers everything
- Sub-brands: Prescription Diet (vet), Science Diet (retail)

### Retail Brands

**Go! Solutions** — `go-solutions.com/en-ca` | Next.js + Contentful
- Listing pages at `/en-ca/dog-food/dry/`, `/wet/`, `/toppers/`, `/treats/`
- Ingredients: compositeList expansion needed for vitamin/mineral blocks
- GA: HTML table, `parse_ga_html_table()`. Comma in numbers (1,000 → 1000.0)
- Product line prepended to name for uniqueness ("Sensitivities - Turkey...")
- Lines: Sensitivities, Carnivore, Skin + Coat, Gut Health, Weight Management

**Now Fresh** — `nowfresh.com/en-ca` | Same Petcurean/Contentful platform as Go!
- Same parsing patterns as Go! — compositeList, GA table, calorie format
- Product line prepended to name for uniqueness
- Lines: Senior, Adult, Puppy, Small Breed

**Taste of the Wild** — `tasteofthewildpetfood.com` | WordPress
- Listing at `/dog/taste-of-the-wild/` + `/dog/prey/`
- Ingredients: `<ul id="all-ingred-pills-list">` inside `<div id="collapseIngredients">`
- GA: HTML table. AAFCO: `<div id="aafco-tab-pane">`
- Word-boundary regex for type detection (`\bwet\b` prevents "Wetlands" match)
- Sub-brands: Taste of the Wild, Ancient Grains, PREY (LID)

**FirstMate** — `firstmate.com` | WooCommerce
- Discovery: `firstmate.com/product-sitemap.xml`
- Ingredients: `<ul class="product-ingredients-list list-ingredients">` with `<a>` tags
- GA: HTML table with colspan row for calories ("ME (calculated): 3400 kcal/kg | 527 kcal/cup")
- AAFCO: `<div class="product__guidelines__box">`
- Cat filter: regex `r"(?:^|-)cat(?:s|-)"` on URL slug

**Canadian Naturals** — `canadiannaturals.com` | WordPress
- Discovery: WP sitemap `wp-sitemap-posts-team-1.xml` or `/our-recipes/` listing
- Product name: `<h3>` inside first `.speaker-bio` div (h1 is empty, other h3s are reviews)
- Ingredients: `<strong>Ingredients:</strong>` parent `<p>` tag text
- GA: `<ul>` list items, NOT table. Ordered pattern matching needed (omega-6 before fat)
- Images: `.single-team-details` container `<img>` tags (no og:image)
- Deduplication by product name (some products have multiple URL paths)
- Supplementary calories from PetValu for 1 product missing from source site

**Nutrience** — `nutrience.com` | WooCommerce
- Ingredients: accordion UI — `<p class="title-acc js-accordion">` + `<div class="inner">` sibling
- GA: HTML table via `parse_ga_html_table()`
- Images: `.swiper-slide` / `.product-slider` containers (filter banners by aspect ratio)
- Lines: SubZero, Infusion, Care, Original
- Missing GA (5/76): supplement/treat products with non-standard markup
- Missing calories (6/76): supplements and treats without calorie data on page

**Acana + Orijen** — scraped from `homesalive.ca` (retailer fallback)
- Brand sites (Salesforce Commerce Cloud) are bot-protected. Retailer backfill works.
- Ingredients: `<div id="ingredients" data-role="content">` on Magento product pages
- GA: HTML table. Common.py defaults: ash/fiber/moisture → max, others → min
- Calorie formats: "kcal/120g cup", "cal/can", "kcal/treat" — all handled
- Product type: word-boundary `\bcan\b` (prevents "acana" matching)
- Sub-brands: Acana (Classics, Singles, Healthy Grains, Highest Protein, etc.) + Orijen (Amazing Grains, Freeze-Dried, Fit & Trim)

**Open Farm** — `openfarmpet.com` | Shopify + HTML
- Discovery: Shopify `/products.json` API for metadata/images/variants
- Ingredients: NOT in Shopify API — must fetch full product page HTML
- Tags encode: `_protein::`, `_lifestage::`, `_sensitivity::`, `_format::`, `_brand::`
- Goodbowl TM handles need URL encoding (`urllib.parse.quote(handle, safe='-')`)
- Variant size_kg: lb-to-kg conversion from title (grams field always 0)
- Lines: Goodbowl, Icelandic, RawMix, GoodGut, Epic Blend, Kind Earth
- Missing GA (11/129): genuinely absent from product page HTML, not a parser issue
  - Bundles/variety packs (Pate Variety Pack, RawMix Plus Bundle, Best Sellers Bundle) — multi-product bundles don't have their own GA
  - Supplement chews (Immune, Calming, Hip & Joint) — supplement products, no standard GA table on page
  - Bone broths (Turkey, Chicken, Beef, Bone Broth Bundle, Bone Broth Plus Bundle) — no GA table on page
- Missing calories (9/129): genuinely absent from product page HTML, not a parser issue
  - Toppers (Salmon & Cod, Arctic Char, Salmon) — have GA but no calorie content on page
  - Bundles (Pate Variety Pack, RawMix Plus Bundle, Best Sellers Bundle) — no calorie content
  - Supplement chews (Immune, Calming, Hip & Joint) — no calorie content

**Blue Buffalo** — `bluebuffalo.com/en-ca` | Episerver CMS
- Discovery: Canadian sitemap `sitemap.en-ca.xml` (163 URLs, much more than expected)
- URL prefixes: `/en-ca/dry-dog-food/`, `/en-ca/wet-dog-food/`, `/en-ca/dog-treats/`
- Ingredients: `ingredientsJson` JS variable (regex + json.loads)
- GA: `window.guaranteedAnalysisHtml = \`...\`` JS template literal → parse as HTML table
- Calories: `window.feedingGuidelinesHtml = \`...\`` JS template literal, PetSmart.com fallback for missing treats
- Product name: h1 (line) + Hero-flag qualifier (breed/life stage) + h3 (recipe). Wet food gets " Wet Food" suffix.
- Sub-brands: Life Protection, Wilderness, Basics, Freedom, True Solutions
- Missing calories (36/163): treats that lack `feedingGuidelinesHtml` and aren't on PetSmart

**Performatrin** — `petvalu.ca` | Next.js + Contentful (Pet Valu house brand)
- Product pages at `/product/{name}/{sku}`. Pagination up to 20 pages.
- Ingredients/GA: `div.imported-html` tabs mapped by `<nav>` button position (not heading search)
- GA: plain-text `<br>`-separated lines in `<p>` tags (not HTML table)
- Images: `og:image` primary, `<link rel="preload" as="image">` fallback (pvimages-prod URLs)
- Sub-brands: Ultra, Naturals, Prime
- Missing calories (4/84): genuinely absent from all known sources (verified CA and US sites)

### Vet-Only Brands

**Rayne Clinical Nutrition** — `raynenutrition.com` | Shopify
- Discovery: `/products.json` (single request, all data)
- Ingredients: `body_html` tab content (`#tab2`), marketing copy stripped ("Yup, that's it!")
- Images + variants from Shopify JSON
- GA: static lookup from InDesign diet pages at `vets.rayneclinical.com` (browsed via Playwright → `indd.adobe.com`), GA images (PNG), and diet page PDFs. 12 products with "% As Is" GA (direct + sample mapping). DIAG (diagnostic elimination) products intentionally lack GA — not nutritionally balanced.
- Calories: 100% coverage from InDesign diet pages. Formats: kcal/kg + kcal/cup (dry), kcal/can (wet pate), kcal/box (stews), kcal/treat (treats/dental chews).
- Novel proteins: kangaroo, rabbit, crocodilian, BSFL. Premium vet clinical nutrition.
- Missing GA (12/24): 4 DIAG products (no GA by design), 4 treats (jerky/meatballs — g/1000 kcal only), 2 rolls (g/1000 kcal only), 2 WellStride (toppers/treats, minimal data)

**Authority** — `petsmart.ca` | Next.js RSC + JSON-LD (PetSmart private-label, exclusive)
- PetSmart's private-label brand (est. 1995). 45 dog products scraped.
- No standalone brand site — all product pages on petsmart.ca
- Discovery: XML sitemaps (`sitemap_0.xml`–`sitemap_4.xml`), filter `/dog/` + `authority`
  - Listing page (`/dog/food/f/brand/authority`) is unreliable — includes non-Authority "recommended" products and misses some Authority products
- Detail: `petsmart.ca/dog/food/{category}/{slug}-{sku}.html`
- Metadata: JSON-LD `<script type="application/ld+json">` → name, SKU, brand, GTIN13, image, price, rating
- Nutritional data: Next.js RSC flight payloads (`self.__next_f.push([1,"..."])`) → unicode unescape → BS4 parse → text extraction for ingredients, GA, calories
- No hidden product API — Algolia search is server-side proxied (403 without credentials)
- Lines: Everyday Health (23), Sensitive Stomach & Skin (12), Healthy Weight (5), Digestive Support (3), High Performance (2)
- Types: dry (29), wet (14), supplements (2 — pumpkin toppers)
- Scraper: `scrapers/authority.py` — wafer-py + BS4, 100% data completeness

**Iams** — `petsmart.ca` | Next.js RSC + JSON-LD (via PetSmart, same as Authority)
- Mars Petcare brand. iams.ca stores all nutritional data as images — PetSmart has it as text.
- Discovery: listing page `/dog/food/f/brand/iams` (23 URLs), sitemaps as supplement
- Detail: same RSC + JSON-LD parsing as Authority scraper
- Sub-brands: Proactive Health (16), Advanced Health (3), unbranded (4)
- Types: dry (16), wet (7)
- Scraper: `scrapers/iams.py` — wafer-py + BS4, 100% data completeness

---

## Not Yet Scraped (Phase 2+)

| Brand | ~Products | Notes |
|-------|-----------|-------|
| Farmina (Vet Life) | ~10 | Vet channel. Italian brand, significant CA vet presence |
| Pedigree | ~15 | Mass market budget. Mars brand |
| Wellness | ~50 | Simple LID + Core Digestive Health |
| Merrick | ~35 | LID line. Nestle/Purina owned |
| Stella & Chewy's | ~45 | Freeze-dried raw focus |
| Nutro | ~25 | LID line. Mars brand. Weak CA presence |

---

## MyVetStore Reference

MyVetStore (`myvetstore.ca`) is not scrapable (ASP.NET, all APIs 401, clinic-specific). Manual product dump from Wilson's Animal Hospital saved in `docs/myvetstore-products.md`.

Used as ground truth to verify Big 3 scraper completeness — every product at the vet store should exist in our DB.
