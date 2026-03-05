# MyDogLog Scraper

Scrapes Canadian dog food product data from manufacturer websites into structured JSON.

For brand-specific technical details (CSS selectors, URL patterns, parsing quirks), see `docs/dog-food-brands-canada.md`.

## Setup

```bash
cd scraper
uv sync
```

## Usage

```bash
uv run python scrape.py royalcanin   # one brand
uv run python scrape.py all          # all brands
uv run python scrape.py --output-dir /tmp/test royalcanin  # custom output
```

Output goes to `data/brands/{slug}.json`.

## Tests

```bash
uv run pytest
```

## Sources

| Brand | Slug | Products | Method | Rate Limit |
|-------|------|----------|--------|------------|
| Royal Canin | `royalcanin` | 153 | JSON REST API (Azure APIM) | 0.5s |
| Purina | `purina` | 196 | Drupal search API + Gatsby page-data.json | 1.0s |
| Hill's | `hills` | 148 | Sitemap XML + HTML (AEM) + US fallback | 1.0s |
| Go! Solutions | `gosolutions` | 43 | HTML parse (Next.js + Contentful) | 1.0s |
| Now Fresh | `nowfresh` | 22 | HTML parse (same Petcurean platform as Go!) | 1.0s |
| Taste of the Wild | `tasteofthewild` | 21 | HTML parse (WordPress) | 1.0s |
| FirstMate | `firstmate` | 53 | HTML parse (WooCommerce) | 1.0s |
| Canadian Naturals | `canadiannaturals` | 20 | HTML parse (WordPress) + PetValu supplement | 1.0s |
| Nutrience | `nutrience` | 76 | HTML parse (WooCommerce) | 1.0s |
| Rayne | `rayne` | 24 | Shopify `/products.json` + static GA lookup | 0.5s |
| Acana + Orijen | `acana` | 60 | HTML parse from homesalive.ca (retailer) | 1.0s |
| Open Farm | `openfarm` | 129 | Shopify JSON + HTML page parse | 1.0s |
| Blue Buffalo | `bluebuffalo` | 163 | HTML parse (Episerver) + PetSmart fallback | 1.0s |
| Performatrin | `performatrin` | 84 | HTML parse (PetValu Next.js) | 1.0s |
| Iams | `iams` | 21 | Drupal JSON API (metadata only) | 1.0s |

### Data Source Notes

**Royal Canin** — Pure JSON. Listing via POST to facets endpoint, detail via GET per mainItemCode. All composition data in structured arrays.
- Auth: `ocp-apim-subscription-key` header (public key from frontend JS)
- Channel: `product_pillar` (`sptretail` / `vet`)

**Purina** — Two-step: Drupal search API returns listings, then Gatsby `page-data.json` per product has structured node data. PPVD vet products often need HTML fallback.
- Response text requires control char stripping (0x00-0x1F) before JSON parsing
- Calories: `guaranteedAnalysis.processed` (primary) or `feeding_instructions.processed` (fallback). Heading-based extraction avoids footnote false positives.
- ~13 products missing GA: supplements, dental chews, semi-moist — data genuinely absent from CMS

**Hill's** — Sitemap + HTML. AEM accordion panels for ingredients/GA. Product metadata from `window.dataLayer`.
- Channel: `itemBrand` in dataLayer (`pd` = vet, `sd` = retail)
- GA basis: dry matter % (not as-fed like others)
- ~16 sitemap URLs are discontinued (filtered out)
- US fallback (`hillspet.com`): same formulations, fills missing ingredients/GA/calories from CA pages

**Acana + Orijen** — Brand sites (Salesforce Commerce Cloud) are bot-protected. Scraped from homesalive.ca retailer instead. Both brands in one scraper file.

**Blue Buffalo** — Uses Canadian `en-ca` pages. Ingredients/GA/calories are in JS variables (`ingredientsJson`, `window.guaranteedAnalysisHtml`, `window.feedingGuidelinesHtml`), not in the DOM. PetSmart.com used as fallback calorie source for treats missing `feedingGuidelinesHtml`.

**Iams** — Ingredients, GA, and calories are stored as images on iams.ca. Scraper captures metadata only (name, images, sub-brand, EAN/UPC). Deferred to Phase 2 for OCR.

## Output Schema

Each brand file is a JSON envelope:

```json
{
  "brand": "Royal Canin",
  "website_url": "https://www.royalcanin.com/ca",
  "scraped_at": "2026-03-01T...",
  "scraper_version": "0.1.0",
  "stats": {
    "product_count": 156,
    "by_channel": {"retail": 86, "vet": 70},
    "by_type": {"dry": 112, "wet": 40, "treats": 4}
  },
  "products": [...]
}
```

Product fields (see `scrapers/common.py` for TypedDicts):

| Field | Required | Notes |
|-------|----------|-------|
| `name` | yes | Cleaned (no TM/R/C symbols) |
| `brand` | yes | e.g. "Royal Canin", "Go! Solutions" |
| `url` | yes | Canonical product page URL |
| `channel` | yes | "retail" or "vet" |
| `product_type` | yes | "dry", "wet", "treats", "supplements" |
| `sub_brand` | no | e.g. "Prescription Diet", "Pro Plan", "Wilderness" |
| `product_line` | no | e.g. "Sensitivities", "SubZero", "Grain Free" |
| `life_stage` | no | "puppy", "adult", "senior", "all_life_stages" |
| `ingredients_raw` | no | Comma-separated ingredient list |
| `guaranteed_analysis` | no | Dict: `crude_protein_min`, `crude_fat_min`, `crude_fiber_max`, `moisture_max`, etc. |
| `guaranteed_analysis_basis` | no | "as-fed" (most brands) or "dry-matter" (Hill's) |
| `calorie_content` | no | Normalized: "3649 kcal/kg, 369 kcal/cup" or "266 kcal/can" |
| `aafco_statement` | no | Full AAFCO nutritional adequacy statement |
| `health_tags` | no | e.g. `["digestive_health", "weight_management"]` |
| `variants` | no | Array of `{size_kg, size_description, upc?, sku?}` |
| `images` | no | Array of image URLs |
| `source_id` | no | Brand-specific ID (SKU, UPC, mainItemCode, EAN) |

## Adding a New Scraper

1. Create `scrapers/{brand}.py` with a `scrape_{brand}(output_dir: Path) -> int` function
2. Register it in `scrapers/__init__.py`
3. Add tests in `tests/test_{brand}.py` (focus on parsing logic, not integration)
4. Follow existing patterns: use `wafer.SyncSession` for HTTP, `common.Product` TypedDict for output, `write_brand_json()` for file output
5. Update `docs/dog-food-brands-canada.md` with brand details

## Known Data Gaps

- **Rayne GA (19/24 missing):** Static lookup covers 5 products from PDFs + 4 from GA images. Most treats/rolls/freeze-dried only have feature bullets, no GA data.
- **Rayne calories (21/24 missing):** Only 3 dry products have calorie data in diet page PDFs.
- **Purina GA (13/196 missing):** DentaLife chews, ALPO Moist & Meaty, vet supplements — data genuinely absent from CMS.
- **Purina variety packs:** Filtered out (13 packs) — bundles without individual ingredient data.
- **Hill's calories (36/148 missing):** Mostly wet food products where calorie data absent from both CA and US pages.
- **Hill's ingredients (2/148 missing):** CMS data issue — ingredient panels are empty/broken (reduced from 4 with US fallback).
- **Hill's GA basis:** Reported as dry-matter % (all others report as-fed %).
- **Blue Buffalo calories (36/163 missing):** Treats lacking `feedingGuidelinesHtml` that aren't on PetSmart (reduced from 58 with PetSmart fallback).
- **Nutrience GA (5/76 missing):** Supplement/treat products with non-standard markup.
- **Nutrience calories (6/76 missing):** Supplements and treats without calorie data on page.
- **Open Farm GA (11/129 missing):** Bundles, supplement chews, bone broths — no GA table on page.
- **Open Farm calories (9/129 missing):** Toppers, bundles, supplement chews — no calorie content on page.
- **Performatrin calories (4/84 missing):** Genuinely absent from all known sources (verified CA and US sites).
- **Royal Canin calorie (1/153 bad):** GI High Fiber Loaf reports 52 kcal/kg — upstream API data error.
- **Iams (100% missing):** Ingredients, GA, and calories stored as images — metadata only until Phase 2 OCR.
- **Iams images (0/21):** Drupal JSON API doesn't return image URLs.
