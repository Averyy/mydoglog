# Plan: Split product `type` into `type` + `format`

## Context

Product `type` conflates category (food/treat/supplement) with physical form (dry/wet). A wet pumpkin topper can't be both `supplement` and `wet_food`. Searching "can" misses wet supplements. Note: Hill's wet stews are NOT mistyped at the scraper level (Hill's emits `"wet"` correctly) — the issue is that `build.py` maps them correctly to `wet_food`, so the migration will handle these. Nutrience treats as `supplement` is a scraper-level issue to fix in Phase 2.

**Current:** 8-value enum: `dry_food`, `wet_food`, `treat`, `topper`, `supplement`, `probiotic`, `freeze_dried`, `whole_food`

**Target:**
| Column | Values | Nullable |
|---|---|---|
| `type` | `food`, `treat`, `supplement` | no |
| `format` | `dry`, `wet` | no |

Scrapers will be updated separately (Option C: two columns, scrapers provide both). Each scraper's `_detect_product_type` splits into two functions returning `type` + `format`. This plan covers schema, migration, `build.py`, and all app code.

**`type` — what is this product?**
- `food` — primary diet (kibble, canned food, raw, freeze-dried meals)
- `treat` — snacks, biscuits, dental chews, jerky, training rewards
- `supplement` — toppers, probiotics, bone broth, health chews, powders

**`format` — what's the physical form?**
- `dry` — kibble, freeze-dried, biscuits, powders, chews
- `wet` — canned, pouches, stews, pates, broths, rolls

## Phase 1: Schema, build pipeline, and app code

All changes ship together. Existing scrapers keep emitting `"dry"`, `"wet"`, `"treats"`, `"supplements"` — `build.py` maps translate these to the new columns.

### Step 1: Schema + Migration

**`src/lib/db/schema.ts`**
- Replace `productTypeEnum` values: `["food", "treat", "supplement"]`
- Add `productFormatEnum`: `["dry", "wet"]`
- Add `format: productFormatEnum("format")` to products table
- Add `isProbiotic: boolean("is_probiotic").notNull().default(false)` to products table

**Migration SQL** (run `yarn db:generate`, replace generated SQL):
```sql
CREATE TYPE "public"."product_format" AS ENUM('dry', 'wet');
ALTER TABLE "products" ADD COLUMN "format" "public"."product_format";
ALTER TABLE "products" ADD COLUMN "is_probiotic" boolean NOT NULL DEFAULT false;

-- Populate format from old type values (temporary — scrapers will overwrite)
UPDATE "products" SET "format" = CASE "type"::text
  WHEN 'dry_food' THEN 'dry'
  WHEN 'wet_food' THEN 'wet'
  WHEN 'freeze_dried' THEN 'dry'
  WHEN 'whole_food' THEN 'dry'
  WHEN 'treat' THEN 'dry'
  WHEN 'supplement' THEN 'dry'
  WHEN 'probiotic' THEN 'dry'
  WHEN 'topper' THEN 'dry'
END::product_format;
ALTER TABLE "products" ALTER COLUMN "format" SET NOT NULL;

-- Preserve probiotic identity before type migration
UPDATE "products" SET "is_probiotic" = true WHERE "type"::text = 'probiotic';

-- Migrate type enum
ALTER TYPE "public"."product_type" RENAME TO "product_type_old";
CREATE TYPE "public"."product_type" AS ENUM('food', 'treat', 'supplement');
ALTER TABLE "products" ALTER COLUMN "type" TYPE "public"."product_type" USING (
  CASE "type"::text
    WHEN 'dry_food' THEN 'food'
    WHEN 'wet_food' THEN 'food'
    WHEN 'freeze_dried' THEN 'food'
    WHEN 'whole_food' THEN 'food'
    WHEN 'treat' THEN 'treat'
    WHEN 'supplement' THEN 'supplement'
    WHEN 'probiotic' THEN 'supplement'
    WHEN 'topper' THEN 'supplement'
  END
)::product_type;
DROP TYPE "public"."product_type_old";
```

Note: format defaults to `dry` for supplements/treats during migration. Scrapers will correct wet supplements (pumpkin topper, bone broth, etc.) when re-run.

### Step 2: `scraper/build.py`

- Update `PRODUCT_TYPE_MAP` values: all map to `food`, `treat`, or `supplement`
- Add `FORMAT_MAP` alongside it: maps scraper values to `dry` or `wet`
- Add `IS_PROBIOTIC_MAP`: maps `"probiotic"` → `True`, all others → `False`
- Update `upsert_product`: add `format` and `is_probiotic` to INSERT columns, VALUES, and ON CONFLICT SET

```python
PRODUCT_TYPE_MAP = {
    "dry": "food", "dry_food": "food",
    "wet": "food", "wet_food": "food",
    "treats": "treat", "treat": "treat",
    "topper": "supplement", "supplement": "supplement",
    "supplements": "supplement", "probiotic": "supplement",
    "freeze_dried": "food", "whole_food": "food",
}

FORMAT_MAP = {
    "dry": "dry", "dry_food": "dry",
    "wet": "wet", "wet_food": "wet",
    "treats": "dry", "treat": "dry",
    "topper": "wet", "supplement": "dry",
    "supplements": "dry", "probiotic": "dry",
    "freeze_dried": "dry", "whole_food": "dry",
}
```

Note: `topper` defaults to `wet` in FORMAT_MAP as a reasonable default. Once scrapers are updated to emit format directly, this map becomes a fallback.

### Step 3: App code

#### `src/lib/types.ts`
- Add `format: string | null` to `ProductSummary`
- Add `format: string | null` to `FeedingPlanItem`

#### `src/lib/labels.ts` (lines 2-14)
- `PRODUCT_TYPE_LABELS` (line 2): replace 8-value map → `{ food: "Food", treat: "Treat", supplement: "Supplement" }`
- Add `PRODUCT_FORMAT_LABELS`: `{ dry: "Kibble", wet: "Wet" }`
- `SUPPLEMENT_PRODUCT_TYPES` (line 14): rename → `NON_FOOD_TYPES = new Set(["treat", "supplement"])`
- Update all importers of `SUPPLEMENT_PRODUCT_TYPES` to use `NON_FOOD_TYPES`

#### `src/lib/nutrition.ts` (lines 88-133)
- Rekey `TYPE_DEFAULT_UNITS` (line 88) to use type+format combo:
  ```ts
  food/dry → cup, g
  food/wet → can, g
  treat → treat, g  (format doesn't matter)
  supplement/dry → scoop, g
  supplement/wet → tbsp, g
  ```
- Update `getAvailableUnits` (line 104) signature: add `productFormat` param, use combined key for fallback

#### `src/lib/correlation/engine.ts`
- No `"dry_food"` string exists in this file — no changes needed
- `estimateGrams` switches on `unit` (cup/can/scoop/etc), NOT product type — no changes needed
- **Probiotic exclusion:** Lines 335, 347, 803 filter `type !== "probiotic"`. Change all three to `info?.isProbiotic` (uses the `is_probiotic` column added in Step 1)

#### `src/lib/correlation/query.ts`
- Line 311: add `format: products.format` and `isProbiotic: products.isProbiotic` to select alongside `type: products.type`
- Lines 342-345: `productInfo` map — change type to `Map<string, { type: string; format: string; isProbiotic: boolean; calorieContent: string | null }>`, default `"dry_food"` → `"food"`, add format default `"dry"`, add `isProbiotic` from query
- Line 424: `fetchIngredientProductMap` — add `format: products.format` and `isProbiotic: products.isProbiotic` to select
- Line 459: default `"dry_food"` → `"food"`

#### `src/lib/correlation/types.ts`
- Line 268: `CorrelationInput.productInfo` map type — add `format: string` and `isProbiotic: boolean` to the value type: `Map<string, { type: string; format: string; isProbiotic: boolean; calorieContent: string | null }>`
- Line 138: `IngredientProductEntry.productType` — stays as-is (already `string`)

#### `src/lib/correlation/engine.test.ts`
- Any tests referencing `"dry_food"` in productTypes → update to `"food"`

#### `src/app/api/products/route.ts` (lines 5-15)
- `TYPE_KEYWORDS` (line 5): rename to `FORMAT_KEYWORDS`, change values to filter on `format` column:
  ```ts
  const FORMAT_KEYWORDS: Record<string, string> = {
    can: "wet", cans: "wet", wet: "wet", canned: "wet",
    dry: "dry", kibble: "dry", kibbles: "dry", bag: "dry", bags: "dry",
  }
  ```
- Search logic: when keyword matches, filter `products.format = X` (instead of `products.type`)
- Add `format: products.format` to select query

#### `src/components/product-picker.tsx` (line 262)
- `formatType(type, calorieContent)` → `formatType(type, format, calorieContent)`:
  - `format === "wet"` → check calorie for pouch/box, default "Can"
  - `format === "dry"` && `type === "food"` → "Kibble"
  - `type === "treat"` → "Treat"
  - `type === "supplement"` → "Supplement"

#### `src/app/(app)/dogs/[id]/food/page.tsx`
- **Note:** There is no separate `food-scorecard/page.tsx` — scorecard UI lives in the food page
- Line 21: remove import of `SUPPLEMENT_PRODUCT_TYPES`, import `NON_FOOD_TYPES` instead
- Line 128: `SUPPLEMENT_PRODUCT_TYPES.has(item.type)` → `item.type !== "food"`
- Line 134: `SUPPLEMENT_PRODUCT_TYPES.has(item.type)` → `item.type !== "food"`

#### `src/components/backfill-modal.tsx`
- Line 25: import `NON_FOOD_TYPES` instead of `SUPPLEMENT_PRODUCT_TYPES`
- Line 81: builds product object from `FeedingPlanItem` — add `format: item.format`
- Line 91: `getAvailableUnits(null, item.type)` → add format param
- Line 114: `SUPPLEMENT_PRODUCT_TYPES.has(...)` → `NON_FOOD_TYPES.has(...)`
- Line 138: `getAvailableUnits(p.calorieContent, p.type)` → add format param
- Line 323: `getAvailableUnits(product.product.calorieContent, product.product.type)` → add format param

#### `src/components/ingredient-row.tsx`
- Line 8: import `NON_FOOD_TYPES` instead of `SUPPLEMENT_PRODUCT_TYPES`
- Line 181: `SUPPLEMENT_PRODUCT_TYPES.has(entry.productType)` → `NON_FOOD_TYPES.has(entry.productType)`
- Note: label granularity reduces — former "Probiotic" and "Topper" entries will both show "Supplement". This is intentional per the new taxonomy.

#### `src/components/food-score-card.tsx`
- Component was refactored — no longer accepts `productType` prop. Current props: `brandName`, `productName`, `imageUrl`, `isCurrent`, `dateLabel`, `className`, `children`
- If supplement badge is still needed, re-add `productType` prop and show badge when `productType !== "food"`
- Otherwise, badge logic may need to live in the parent page instead

#### `src/app/api/dogs/[id]/food/route.ts`
- Line 35: add `format: products.format` alongside existing `productType: products.type`
- Line 71-81: include `format` in response item mapping

#### `src/app/api/dogs/[id]/food/scorecard/route.ts`
- Line 168: add `format: products.format` alongside `productType: products.type`
- Line 203-213: include `format` in response mapping

#### `src/lib/routine.ts`
- Line 32: add `format: products.format` alongside `productType: products.type`
- Line 62: include `format` in mapped output

#### `src/components/routine-editor.tsx`
- Line 67: `createPlanItem` builds `ProductSummary` from `FeedingPlanItem` — add `format: from.format ?? null`
- Line 206: `getAvailableUnits(calContent, item.product.type)` → add format param
- Line 409: `getAvailableUnits(calorieContent, item.product?.type)` → add format param

#### `src/components/treat-logger.tsx` + `src/components/daily-checkin.tsx`
- `productType="treat"` — unchanged, still valid (line 452 in daily-checkin)

### Execution order

1. `schema.ts` changes → `yarn db:generate` → hand-edit migration SQL → run migration
2. `build.py` changes → `uv run python build.py` to populate new values
3. All TypeScript/TSX changes (labels, nutrition, correlation, API routes, components, page)
4. `yarn build`
5. `npx vitest run`

### Verification

1. `yarn build` — compiles
2. `npx vitest run` — tests pass
3. DB: `SELECT type, format, count(*) FROM products GROUP BY type, format ORDER BY 1, 2`
4. Search "can" → returns `format=wet` (food AND supplements)
5. Search "kibble" → returns `format=dry`
6. Supplement cards show badge + use supplement scorecard form
7. Product picker shows "Can"/"Kibble"/"Supplement" labels

## Phase 2: Scraper updates (one-by-one)

No changes required for Phase 1 to work. All 17 scrapers currently emit only 4 values: `"dry"`, `"wet"`, `"treats"`, `"supplements"`. The `build.py` maps handle translation. Scrapers will be updated one-by-one to emit `type` + `format` + `is_probiotic` directly.

**Per-scraper update:** Split `_detect_product_type()` into `_detect_type()` (food/treat/supplement), `_detect_format()` (dry/wet), and optionally flag `is_probiotic`. Priority scrapers for format accuracy:
- **Rayne** — has wet supplements (rolls, toppers)
- **Royal Canin** — API metadata could provide format directly
- **Go!/Now** — toppers should be supplement/wet
- **Purina** — 5 supplements, verify wet vs dry
- **Nutrience** — has treats misclassified as supplements (scraper-level fix)
