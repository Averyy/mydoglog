# Product Pricing Implementation Plan

## Context
Add pricing data to products so the user can track food costs. Two data paths: automated extraction from retail scrapers (Shopify, PetSmart), and manual entry for vet foods (user pastes MyVetStore pages → encoded into `_FALLBACK_DATA`). Pricing is stored as a `pricing_json` JSONB column on the products table — separate from `variants_json`, no FK, no separate table.

## Verified Pricing Availability (checked via Playwright 2026-03-27)

| Source | Available? | Method | Brands |
|---|---|---|---|
| PetSmart JSON-LD | **Yes** | `offers.price` + `priceCurrency: "CAD"` per page | 14 brands: Authority, Canidae, Eukanuba, Hills Retail, Iams, Instinct, Natural Balance, Nulo, Nutro, Pedigree, Purina Retail, Simply Nourish, Stella & Chewy's, Wellness |
| Shopify (Rayne) | **Yes** | `variant.price` per size | Rayne |
| Shopify (Open Farm) | **Yes** | `variant.price` per size | Open Farm |
| Shopify (Royal Canin shop) | **Yes** | `variant.price` via `shop.royalcanin.ca/products.json` | Royal Canin retail (~30 dog products) |
| Hill's manufacturer | **No** | "Buy Now" → retailer links | Hill's Vet |
| Purina manufacturer | **No** | No price on pages | Purina Vet |
| Farmina manufacturer | **No** | "Find a retailer" only | Farmina |
| MyVetStore | **Manual** | User pastes page text | All vet brands at clinic |

**No pricing available:** Acana/Orijen, Blue Buffalo, Canadian Naturals, FirstMate, Fromm, Go Solutions, Kirkland, Merrick, Now Fresh, Nutrience, Nutrish, Performatrin, Taste of the Wild (all scraped from manufacturer sites that don't list prices)

## Data Structure
```json
[
  { "size": "3.6 kg", "price_cad": 72.50, "source": "myvetstore" },
  { "size": "11.3 kg", "price_cad": 199.71, "source": "myvetstore" },
  { "size": "377 g (12 pack)", "price_cad": 82.20, "pack_size": 12, "source": "myvetstore" }
]
```

Display: **$/kg for dry**, **$/can for wet**, **ranges for multi-size** (e.g. "$6.12 - $11.40/kg")

---

## Phase 1: Foundation

### 1.1 Python types — `scraper/scrapers/common.py`
- Add `Pricing` TypedDict: `size` (str), `price_cad` (float), `source` (str), `pack_size` (NotRequired[int])
- Add `pricing: NotRequired[list[Pricing]]` to `Product` TypedDict

### 1.2 Seed pipeline — `scraper/seed_db.py`
- Add `pricing_json` to `upsert_product` INSERT column list and ON CONFLICT UPDATE SET
- Serialize via `json.dumps(product.get("pricing"))` — same pattern as variants

### 1.3 DB schema — `src/lib/db/schema.ts`
- Add `pricingJson: jsonb("pricing_json")` to products table

### 1.4 Migration
- `yarn db:generate` → `ALTER TABLE "products" ADD COLUMN "pricing_json" jsonb;`
- Run migration on local dev DB

### 1.5 TypeScript types
- Add `PricingEntry` interface (`size`, `price_cad`, `source`, `pack_size?`)
- Add `pricingJson` to product API responses

---

## Phase 2: Automated Retail Pricing

### 2.1 Shopify — Rayne (`scraper/scrapers/rayne.py`)
- **Verified:** Shopify JSON has `variant.price` (e.g. `"44.44"` for 6.6lb, `"137.80"` for 24lb)
- Add `_parse_pricing()` alongside existing `_parse_variants()`
- Extract `float(v.get("price"))` + `v.get("title")` for each variant
- Source: `"raynenutrition.com"`

### 2.2 Shopify — Open Farm (`scraper/scrapers/openfarm.py`)
- **Verified:** Same Shopify structure, `variant.price` available
- Add `_parse_pricing()` alongside `_parse_variants()`
- Source: `"openfarmpet.com"`

### 2.3 PetSmart JSON-LD — 14 brands (`scraper/scrapers/petsmart.py`)
- **Verified:** JSON-LD has `offers: { price: "5.29", priceCurrency: "CAD" }` per product
- Add `_parse_pricing_from_json_ld()` in `parse_product()`
- Extract `offers.price` from each JSON-LD Product entry, parse size from product name
- Source: `"petsmart.ca"`
- **Critical: dedup must collect pricing from dropped size variants.** Each bag size is a separate PetSmart page. The scraper visits all pages, then dedup keeps the shortest-named product and drops the rest. Currently the dropped products' data is lost. The dedup function needs to be modified to:
  1. Collect `pricing` from all products in a size-variant group
  2. Merge them into the surviving product's `pricing` array
  - This way the kept product has pricing for all sizes even though it only has one variant

### 2.4 Royal Canin Retail — manual match from `shop.royalcanin.ca`
- **Verified:** Shopify store at `shop.royalcanin.ca/products.json`, ~30 dog products (retail only)
- Product names differ between `royalcanin.com/ca` (current scraper source) and the shop — automated fuzzy matching is unreliable
- **Same manual approach as vet pricing:** fetch shop JSON, manually map shop product names to existing Royal Canin product slugs, store in `_FALLBACK_DATA` in `royalcanin.py`
- One-time job (~30 products), refresh when prices change
- Source: `"shop.royalcanin.ca"`

---

## Phase 3: Manual Vet Pricing

### 3.1 Hills Vet (`scraper/scrapers/hills_vet.py`)
- `_FALLBACK_DATA` is dict-of-dicts keyed by URL slug
- Add `"pricing": [...]` key to each entry
- Add merge code: `if fb.get("pricing"): product["pricing"] = fb["pricing"]`

### 3.2 Purina Vet (`scraper/scrapers/purina_vet.py`)
- `_FALLBACK_DATA` uses tuples: `(ingredients, GA, calories)`
- Extend to 4-element tuple: `(ingredients, GA, calories, pricing)`
- Guard with `len(fb) > 3` for backwards compat
- Add merge code

### 3.3 Rayne
- Already has automated Shopify pricing from Phase 2
- If vet clinic prices needed separately, add `_VET_PRICING` dict later

### 3.4 Farmina (`scraper/scrapers/farmina.py`)
- No existing `_FALLBACK_DATA` — add one following the Hills dict pattern
- Add merge code in main scrape function

### 3.5 Royal Canin Vet
- Royal Canin vet products are NOT on `shop.royalcanin.ca` (retail only)
- Vet prices via MyVetStore paste → `_FALLBACK_DATA` in `royalcanin.py`

### 3.6 Data entry workflow
- User pastes MyVetStore page text
- Parse product names + sizes + prices (ignore AutoOrder price, use full price)
- Update `_FALLBACK_DATA` in the appropriate vet scraper file
- User reviews, commits, deploys — seed_db picks it up

---

## Phase 4: Display / UI

### 4.1 Pricing utility — new `src/lib/pricing.ts`
- `parseSizeKg(size: string): number` — parse "3.6 kg", "6.6 lb", "370 g", etc.
- `computeUnitPrices(pricing, format)` — returns `{ min, max, unit }`
  - Dry: $/kg = price_cad / size_kg
  - Wet: $/can = price_cad / pack_size (or raw price if pack_size=1)
- `formatPriceRange(min, max, unit)` — "$8.52/kg" or "$6.12 - $11.40/kg"

### 4.2 Display in compare view
- Add pricing row to compare columns
- Show range or single value per product

### 4.3 Meal cost calculation (future)
- User's feeding plan has serving size → multiply by $/kg or $/can
- Roll up to daily/monthly cost

---

## Verification
1. After Phase 1: `yarn build` passes, `uv run python seed_db.py` works with null pricing
2. After Phase 2: Re-scrape Rayne + Open Farm, confirm `pricing` arrays in output JSON. Re-scrape one PetSmart brand, confirm pricing collected through dedup.
3. After Phase 3: Add a few test entries to Hills vet `_FALLBACK_DATA`, re-seed, query DB to confirm pricing_json populated
4. After Phase 4: `yarn build` passes, compare view shows pricing for products that have it

## Implementation order
Phase 1 first, then Phase 2 + 3 in parallel, Phase 4 last.
