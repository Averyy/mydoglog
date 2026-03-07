# Plan: Split product `type` into `type` + `format`

## Context

Product `type` conflates category (food/treat/supplement) with physical form (dry/wet). A wet pumpkin topper can't be both `supplement` and `wet_food`. Searching "can" misses wet supplements. Current scraper types also have errors (Hill's wet stews as `dry_food`, Nutrience treats as `supplement`).

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

## Phase 1: Schema + Migration

**`src/lib/db/schema.ts`**
- Replace `productTypeEnum` values: `["food", "treat", "supplement"]`
- Add `productFormatEnum`: `["dry", "wet"]`
- Add `format: productFormatEnum("format")` to products table

**Migration SQL** (run `yarn db:generate`, replace generated SQL):
```sql
CREATE TYPE "public"."product_format" AS ENUM('dry', 'wet');
ALTER TABLE "products" ADD COLUMN "format" "public"."product_format";

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

## Phase 2: `scraper/build.py`

- Update `PRODUCT_TYPE_MAP` values: all map to `food`, `treat`, or `supplement`
- Add `FORMAT_MAP` alongside it: maps scraper values to `dry` or `wet`
- Update `upsert_product`: add `format` to INSERT columns, VALUES, and ON CONFLICT SET

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

## Phase 3: App Code Changes

### `src/lib/types.ts`
- Add `format: string | null` to `ProductSummary`
- Add `format: string | null` to `FeedingPlanItem`

### `src/lib/labels.ts`
- `PRODUCT_TYPE_LABELS`: `{ food: "Food", treat: "Treat", supplement: "Supplement" }`
- Add `PRODUCT_FORMAT_LABELS`: `{ dry: "Kibble", wet: "Wet" }`
- Rename `SUPPLEMENT_PRODUCT_TYPES` → `NON_FOOD_TYPES = new Set(["treat", "supplement"])`

### `src/lib/nutrition.ts`
- Rekey `TYPE_DEFAULT_UNITS` to use type+format combo:
  ```ts
  food/dry → cup, g
  food/wet → can, g
  treat → treat, g  (format doesn't matter)
  supplement/dry → scoop, g
  supplement/wet → tbsp, g
  ```
- Update `getAvailableUnits(calorieContent, productType, productFormat)` — add `productFormat` param, use combined key for fallback

### `src/lib/correlation/engine.ts`
- Update `estimateGrams` switch to use new type+format values:
  ```ts
  food/dry → 300, food/wet → 370
  treat → 10
  supplement/dry → 5, supplement/wet → 30
  default → 200
  ```
- Lines 176-184: replace old 8-value switch

### `src/lib/correlation/query.ts`
- `productTypes` map (line 340-342): also store format → change to `Map<string, { type: string; format: string }>`
- Line 309: select `format: products.format` alongside `type: products.type`
- Line 342: default `"dry_food"` → `{ type: "food", format: "dry" }`
- `fetchIngredientProductMap` (line 412-452): default `"dry_food"` → `"food"`

### `src/lib/correlation/types.ts`
- `CorrelationInput.productTypes` comment: update from `"dry_food"` to `"food"`
- `IngredientProductEntry.productType`: stays as-is (already `string`)

### `src/lib/correlation/engine.test.ts`
- Line 93: `productTypes: new Map()` — stays as-is (empty map)
- Any tests referencing `"dry_food"` in productTypes → update

### `src/app/api/products/route.ts`
- `TYPE_KEYWORDS`: change values to filter on `format` column:
  ```ts
  const FORMAT_KEYWORDS: Record<string, string> = {
    can: "wet", cans: "wet", wet: "wet", canned: "wet",
    dry: "dry", kibble: "dry", kibbles: "dry", bag: "dry", bags: "dry",
  }
  ```
- Search logic: when keyword matches, filter `products.format = X` (instead of `products.type`)
- Add `format: products.format` to select query

### `src/components/product-picker.tsx`
- `formatType(type, calorieContent)` → `formatType(type, format, calorieContent)`:
  - `format === "wet"` → check calorie for pouch/box, default "Can"
  - `format === "dry"` && `type === "food"` → "Kibble"
  - `type === "treat"` → "Treat"
  - `type === "supplement"` → "Supplement"

### `src/app/(app)/dogs/[id]/food-scorecard/page.tsx`
- `NON_FOOD_TYPES`: simplify to `new Set(["treat", "supplement"])`
- Remove import of old `SUPPLEMENT_PRODUCT_TYPES`, use `NON_FOOD_TYPES` or inline `type !== "food"` checks
- `scorecardModeForGroup`: check `item.type !== "food"`
- `rateLabel`: check `type === "treat"` → "Rate this treat", `type === "supplement"` → "Rate this supplement"
- Backfill modal mode: check `backfillProduct?.product.type !== "food"`
- "Found in:" rows: show type label when `type !== "food"`
- Pass `productType` to `FoodScoreCard` — unchanged

### `src/components/food-score-card.tsx`
- Badge: show when `productType !== "food"` (instead of checking set membership)

### `src/app/api/dogs/[id]/feeding/route.ts`
- Add `format: products.format` to select (line ~35)
- Include in response item mapping

### `src/app/api/dogs/[id]/food-scorecard/route.ts`
- Add `format: products.format` to select
- Include in response

### `src/lib/routine.ts`
- Add `format: products.format` to select
- Include in mapped output

### `src/components/treat-logger.tsx` + `src/components/daily-checkin.tsx`
- `productType="treat"` — unchanged, still valid

## Phase 4: Scraper JSON + scraper code

No changes in this plan. Scrapers keep emitting current values (`dry`, `wet`, `treats`, `supplements`). `build.py` maps them. User will update scrapers separately to emit `type` + `format` directly.

## Execution Order

1. `schema.ts` changes → `yarn db:generate` → hand-edit migration SQL → run migration
2. `build.py` changes → `uv run python build.py` to populate new values
3. All TypeScript/TSX changes (labels, nutrition, correlation, API routes, components, page)
4. `yarn build`
5. `npx vitest run`

## Verification

1. `yarn build` — compiles
2. `npx vitest run` — tests pass
3. DB: `SELECT type, format, count(*) FROM products GROUP BY type, format ORDER BY 1, 2`
4. Search "can" → returns `format=wet` (food AND supplements)
5. Search "kibble" → returns `format=dry`
6. Supplement cards show badge + use supplement scorecard form
7. Product picker shows "Can"/"Kibble"/"Supplement" labels
