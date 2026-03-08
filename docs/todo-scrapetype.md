# Plan: Split product `type` into `type` + `format`

## Context

Product `type` conflates category (food/treat/supplement) with physical form (dry/wet). A wet pumpkin topper can't be both `supplement` and `wet_food`. Searching "can" misses wet supplements. Note: Hill's wet stews are NOT mistyped at the scraper level (Hill's emits `"wet"` correctly) — the issue is that `build.py` maps them correctly to `wet_food`, so the migration will handle these. Nutrience treats as `supplement` is a scraper-level issue to fix in Phase 2.

**Current (live):**
| Column | Values | Nullable |
|---|---|---|
| `type` | `food`, `treat`, `supplement` | no |
| `format` | `dry`, `wet` | no |

**`type` — what is this product?**
- `food` — primary diet (kibble, canned food, raw, freeze-dried meals)
- `treat` — snacks, biscuits, dental chews, jerky, training rewards
- `supplement` — toppers, probiotics, bone broth, health chews, powders

**`format` — what's the physical form?**
- `dry` — kibble, freeze-dried, biscuits, powders, chews
- `wet` — canned, pouches, stews, pates, broths, rolls

## Phase 1: Schema, build pipeline, and app code — DONE

Completed 2026-03-08. All changes shipped together.

**What was done:**
- Schema: replaced 8-value `productTypeEnum` → 3 values, added `productFormatEnum` + `format` column
- Migration: custom SQL in `drizzle/0004_quick_ego.sql` — populates format from old types, then migrates the type enum via CASE expressions. Result: 728 dry food, 373 wet food, 114 dry treats, 37 dry supplements
- Types: added `format` to `ProductSummary`, `FeedingPlanItem`, `CorrelationInput.productInfo`
- Labels: `PRODUCT_TYPE_LABELS` → 3 entries, added `PRODUCT_FORMAT_LABELS`, renamed `SUPPLEMENT_PRODUCT_TYPES` → `NON_FOOD_TYPES`
- Nutrition: rekeyed `TYPE_DEFAULT_UNITS` to type+format combos (`food/dry`, `food/wet`, `treat`, `supplement/dry`, `supplement/wet`), added `productFormat` param to `getAvailableUnits()`
- Correlation engine: removed 3 probiotic exclusion filters (gram weighting handles trace quantities naturally)
- Correlation query: added `format` to product info queries, updated defaults `"dry_food"` → `"food"`
- Product search API: `TYPE_KEYWORDS` → `FORMAT_KEYWORDS`, now filters on `products.format`
- All API routes (`/food`, `/food/scorecard`, `/treats`, `/products`, `/products/[id]`, routine): added `format` to selects and response mappings
- All components (product-picker, backfill-modal, routine-editor, ingredient-row, treat-logger, food page): updated to use `NON_FOOD_TYPES`, pass `format` through, `formatType()` uses format-based logic
- Tests: updated productInfo shape in engine.test.ts, all 140 tests pass
- Build: `yarn build` passes clean

**Not done (deferred to Phase 2):** `build.py` and scraper updates — existing scrapers still emit `"dry"`, `"wet"`, `"treats"`, `"supplements"` which `build.py` maps via `PRODUCT_TYPE_MAP`/`FORMAT_MAP`.

## Phase 2: Scraper updates (one-by-one)

No changes required for Phase 1 to work. All 17 scrapers currently emit only 4 values: `"dry"`, `"wet"`, `"treats"`, `"supplements"`. The `build.py` maps handle translation. Scrapers are updated one at a time to emit `type` + `format` directly.

### Pre-work: `build.py` + `common.py`

**`scraper/build.py`:**
- Update `PRODUCT_TYPE_MAP` values: all map to `food`, `treat`, or `supplement`
- Add `FORMAT_MAP` alongside it: maps scraper values to `dry` or `wet`
- Update `upsert_product`: add `format` to INSERT columns, VALUES, and ON CONFLICT SET
- Handle both updated and legacy scrapers: if `product_format` key exists in JSON → use directly, otherwise fall back to `FORMAT_MAP`

**`scraper/scrapers/common.py`:**
- Add `product_format: NotRequired[str]` to `Product` TypedDict
- Update `product_type` comment

### Per-scraper workflow

For each scraper:
1. Update `_detect_product_type()` → split into `_detect_type()` (food/treat/supplement) and `_detect_format()` (dry/wet)
2. Update the scraper's product dict to include `"product_type"` and `"product_format"` keys
3. Run the scraper: `uv run python -m scrapers.<name>`
4. Spot-check JSON output: verify type/format values make sense for a handful of products
5. Run build: `uv run python build.py`
6. Verify DB: `SELECT name, type, format FROM products WHERE brand_id = '<brand>' ORDER BY name LIMIT 20`
7. Check the box below once confirmed

### Scraper checklist

Priority order — scrapers most likely to have format edge cases first:

- [x] **rayne** — has wet supplements (rolls, toppers)
- [x] **royalcanin** — API `digital_sub_category` metadata could provide format directly
- [x] **gosolutions** — toppers should be supplement/wet
- [x] **nowfresh** — shares Go! CMS, toppers should be supplement/wet
- [x] **purina** — 5 supplements, verify wet vs dry
- [x] **nutrience** — has treats misclassified as supplements (fix type detection)
- [x] **hills** — large catalog, verify wet stews get format=wet
- [x] **acana** — freeze-dried + wet + treats, verify format detection
- [x] **openfarm** — has `_productType::` tags, toppers/supplements
- [x] **firstmate** — uses WP categories + can size detection
- [x] **bluebuffalo** — straightforward dry/wet/treats
- [x] **iams** — food-toppers URL path → supplement/wet
- [x] **authority** — same structure as IAMS
- [x] **tasteofthewild** — straightforward dry/wet/treats/supplements
- [x] **canadiannaturals** — simple keyword detection
- [x] **performatrin** — straightforward wet keyword detection

### Phase 3: Remove legacy mappings

After all scrapers are updated, clean up `build.py` to only accept the new values:

- [x] `PRODUCT_TYPE_MAP` — remove all legacy keys (`"dry"`, `"wet"`, `"treats"`, `"supplements"`, `"topper"`, `"probiotic"`, `"freeze_dried"`, `"whole_food"`, `"dry_food"`, `"wet_food"`). Only keep `"food"`, `"treat"`, `"supplement"`.
- [x] `FORMAT_MAP` — delete entirely. Format always comes from `product_format` key directly.
- [x] `upsert_product` — remove `FORMAT_MAP` fallback, require `product["product_format"]` directly.
- [x] `Product` TypedDict in `common.py` — make `product_format` required (remove `NotRequired`).
- [x] Verify: `uv run python build.py` still loads all products correctly.
- [x] **Full codebase audit** — grep for any remaining references to old type values across Python and TypeScript:
  - Old enum values: `dry_food`, `wet_food`, `freeze_dried`, `whole_food`, `probiotic`, `topper`
  - Old scraper values: `"dry"` or `"wet"` used as product_type (not format), `"treats"`, `"supplements"`
  - Stale comments or docs referencing the old 8-value enum
  - Any `SUPPLEMENT_PRODUCT_TYPES` references that survived
  - Any `TYPE_KEYWORDS` or `TYPE_DEFAULT_UNITS` references using old keys
