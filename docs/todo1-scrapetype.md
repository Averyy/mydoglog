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

### `src/lib/labels.ts` (lines 2-14)
- `PRODUCT_TYPE_LABELS` (line 2): replace 8-value map → `{ food: "Food", treat: "Treat", supplement: "Supplement" }`
- Add `PRODUCT_FORMAT_LABELS`: `{ dry: "Kibble", wet: "Wet" }`
- `SUPPLEMENT_PRODUCT_TYPES` (line 14): rename → `NON_FOOD_TYPES = new Set(["treat", "supplement"])`
- Update all importers of `SUPPLEMENT_PRODUCT_TYPES` to use `NON_FOOD_TYPES`

### `src/lib/nutrition.ts` (lines 88-133)
- Rekey `TYPE_DEFAULT_UNITS` (line 88) to use type+format combo:
  ```ts
  food/dry → cup, g
  food/wet → can, g
  treat → treat, g  (format doesn't matter)
  supplement/dry → scoop, g
  supplement/wet → tbsp, g
  ```
- Update `getAvailableUnits` (line 104) signature: add `productFormat` param, use combined key for fallback

### `src/lib/correlation/engine.ts`
- Line 831: change default `"dry_food"` → `"food"` in `const productType = info?.type ?? "dry_food"`
- Note: `estimateGrams` (line 159) switches on `unit` (cup/can/scoop/etc), NOT product type — no changes needed there

### `src/lib/correlation/query.ts`
- Line 311: add `format: products.format` to select alongside `type: products.type`
- Lines 342-345: `productInfo` map — change type to `Map<string, { type: string; format: string; calorieContent: string | null }>`, default `"dry_food"` → `"food"`, add format default `"dry"`
- Lines 402-468: `fetchIngredientProductMap` — line 421 add `format: products.format` to select, line 456 default `"dry_food"` → `"food"`

### `src/lib/correlation/types.ts`
- `CorrelationInput.productTypes` comment: update from `"dry_food"` to `"food"`
- `IngredientProductEntry.productType`: stays as-is (already `string`)

### `src/lib/correlation/engine.test.ts`
- Any tests referencing `"dry_food"` in productTypes → update to `"food"`

### `src/app/api/products/route.ts` (lines 5-15)
- `TYPE_KEYWORDS` (line 5): rename to `FORMAT_KEYWORDS`, change values to filter on `format` column:
  ```ts
  const FORMAT_KEYWORDS: Record<string, string> = {
    can: "wet", cans: "wet", wet: "wet", canned: "wet",
    dry: "dry", kibble: "dry", kibbles: "dry", bag: "dry", bags: "dry",
  }
  ```
- Search logic: when keyword matches, filter `products.format = X` (instead of `products.type`)
- Add `format: products.format` to select query

### `src/components/product-picker.tsx` (line 169)
- `formatType(type, calorieContent)` → `formatType(type, format, calorieContent)`:
  - `format === "wet"` → check calorie for pouch/box, default "Can"
  - `format === "dry"` && `type === "food"` → "Kibble"
  - `type === "treat"` → "Treat"
  - `type === "supplement"` → "Supplement"

### `src/app/(app)/dogs/[id]/food-scorecard/page.tsx`
- Line 35: remove import of `SUPPLEMENT_PRODUCT_TYPES`, import `NON_FOOD_TYPES` instead
- Line 1023: `NON_FOOD_TYPES` local definition → remove (use the one from labels.ts)
- Line 1027: `scorecardModeForGroup` — change `SUPPLEMENT_PRODUCT_TYPES.has(item.type)` → `item.type !== "food"`
- Line 1035, 1041, 1057: `NON_FOOD_TYPES.has(...)` → `type !== "food"` checks
- Line 1315: `SUPPLEMENT_PRODUCT_TYPES.has(...)` → check `type === "treat"` → "Rate this treat", `type === "supplement"` → "Rate this supplement"
- Line 1328: `SUPPLEMENT_PRODUCT_TYPES.has(...)` → `backfillProduct?.product.type !== "food"`

### `src/components/food-score-card.tsx`
- Component was refactored — no longer accepts `productType` prop. Current props: `brandName`, `productName`, `imageUrl`, `isCurrent`, `dateLabel`, `className`, `children`
- If supplement badge is still needed, re-add `productType` prop and show badge when `productType !== "food"`
- Otherwise, badge logic may need to live in the parent page instead

### `src/app/api/dogs/[id]/feeding/route.ts`
- Line 35: add `format: products.format` alongside existing `productType: products.type`
- Line 77: include `format` in response item mapping

### `src/app/api/dogs/[id]/food-scorecard/route.ts`
- Line 167: add `format: products.format` alongside `productType: products.type`
- Line 208: include `format` in response mapping

### `src/lib/routine.ts`
- Line 32: add `format: products.format` alongside `productType: products.type`
- Line 62: include `format` in mapped output

### `src/components/routine-editor.tsx`
- Line 67: passes `type: from.type` to `PlanItem` — may need to also pass `format`
- Line 208: calls `getAvailableUnits(calContent, item.product.type)` — update to pass format as third arg

### `src/components/treat-logger.tsx` + `src/components/daily-checkin.tsx`
- `productType="treat"` — unchanged, still valid (line 452 in daily-checkin)

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
