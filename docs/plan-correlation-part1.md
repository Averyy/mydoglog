# Correlation Engine — Part 1: Data Collection + Analysis Engine

The pure computation layer. Types, engine functions, DB queries, and tests. Zero UI changes — all about collecting, analyzing, and generating correlation data.

**Depends on:** Phase 2 complete (feeding periods, daily check-in, quick loggers, food scorecard page all working).

---

## 1a. Types (`src/lib/correlation/types.ts`)

```ts
/** Which confidence bracket an ingredient score falls into. */
export type Confidence = "high" | "medium" | "low" | "insufficient"
// high = ≥14 days logged data, medium = 7-13, low = 3-6, insufficient = <3

/** A single ingredient's presence in a product, enriched with family/group metadata. */
export interface IngredientExposure {
  ingredientId: string
  family: string              // e.g. "chicken", "rice", "salmon"
  sourceGroup: string         // e.g. "poultry", "grain", "fish"
  formType: string | null     // e.g. "meal", "raw", "by_product", "hydrolyzed"
  isHydrolyzed: boolean
  position: number            // weight order in the product (1 = first listed)
  isAmbiguous: boolean        // true for "Meat Meal", "Poultry Fat", etc.
  ambiguousFamilies?: string[] // if ambiguous, all possible families
}

/** One day's complete snapshot: what was consumed and what happened. */
export interface DaySnapshot {
  date: string                       // YYYY-MM-DD
  ingredientFamilies: IngredientExposure[] // all ingredients from feeding periods + treats
  poopScores: number[]               // all poop firmness scores for this day (1-7)
  avgPoopScore: number | null        // mean of poopScores, or scorecard fallback
  itchScore: number | null           // daily itch score (1-5)
  vomitCount: number                 // number of vomit events
  isTransitionBuffer: boolean        // true = within N days of food change, EXCLUDED from scoring
  isExposureBuffer: boolean          // true = within N days of accidental exposure, EXCLUDED
  isMedicationActive: boolean        // true = at least one medication active
  pollenIndex: number | null         // pollen level if available
  dataSource: "event_logs" | "scorecard_fallback" | "none"
}

/** Per-ingredient correlation result. */
export interface IngredientScore {
  family: string
  sourceGroup: string
  avgPoopScore: number | null
  avgItchScore: number | null
  badDayCount: number          // days with poop score ≥5
  goodDayCount: number         // days with poop score ≤3
  totalDaysExposed: number     // non-excluded days with this ingredient
  daysWithLogData: number      // subset of totalDaysExposed that had actual event logs
  confidence: Confidence
  weight: number               // effective weight (1.0 normal, 0.5 ambiguous, boosted for top-5 position)
  productsContaining: string[] // product IDs containing this ingredient
  crossReactivityGroup: string | null // e.g. "poultry" if flagged
  isHydrolyzed: boolean
}

/** Top-level output of the correlation engine. */
export interface CorrelationResult {
  ingredientScores: IngredientScore[]
  dateRange: { start: string; end: string }
  transitionBufferDays: number
  exposureBufferDays: number
  totalDaysAnalyzed: number
  totalDaysExcluded: number
  totalDaysWithLogData: number
}

/** Options for the correlation computation. */
export interface CorrelationOptions {
  transitionBufferDays: number  // default 5
  exposureBufferDays: number    // default 5
  includeScoreCardFallback: boolean // default true
  excludeMedicationPeriods: boolean // default false
}
```

---

## 1b. Pure Correlation Engine (`src/lib/correlation/engine.ts`)

All functions are pure — they take data arrays as input, zero DB access. Fully testable with mock data.

### `buildDaySnapshots()`

```
buildDaySnapshots(
  feedingPeriods: FeedingPeriod[],
  poopLogs: PoopLog[],
  itchinessLogs: ItchinessLog[],
  vomitLogs: VomitLog[],
  treatLogs: TreatLogWithIngredients[],
  productIngredientMap: Map<string, IngredientExposure[]>,  // productId → ingredients
  scorecards: FoodScorecard[],
  exposures: AccidentalExposure[],
  medications: Medication[],
  pollenLogs: PollenLog[],
  options: CorrelationOptions,
) → DaySnapshot[]
```

Logic:
1. Determine date range: earliest feeding period start → today (or latest end date).
2. For each date in range:
   - **Resolve active feeding periods:** find all `feedingPeriods` where `startDate <= date` and (`endDate >= date` or `endDate` is null). Collect product IDs.
   - **Collect routine ingredients:** for each active product, look up `productIngredientMap` to get all `IngredientExposure` entries.
   - **Add treat ingredients:** find treat logs for this date, look up their product ingredients from `productIngredientMap`, merge into the day's exposure list.
   - **Deduplicate ingredient families:** if the same family appears from multiple sources, keep the one with the lowest position (most prominent).
   - **Mark transition buffer:** detect food changes by comparing this day's active product set to the previous day's. The first `transitionBufferDays` days after ANY change → `isTransitionBuffer = true`.
   - **Mark exposure buffer:** if an accidental exposure occurred within the last `exposureBufferDays` days → `isExposureBuffer = true`.
   - **Attach poop data:** all poop log `firmnessScore` values for this date → `poopScores`. Compute mean → `avgPoopScore`.
   - **Scorecard fallback:** if no poop logs for this date BUT the active feeding period has a scorecard with `poopQuality`, use that value as `avgPoopScore` and set `dataSource = "scorecard_fallback"`.
   - **Attach itch data:** latest itchiness log score for this date.
   - **Attach vomit count:** count of vomit logs for this date.
   - **Medication status:** check if any medication's date range covers this date.
   - **Pollen:** find pollen log for this date (by dog's location).
3. Return array sorted by date ascending.

### `computeIngredientScores()`

```
computeIngredientScores(
  snapshots: DaySnapshot[],
  options: CorrelationOptions,
) → IngredientScore[]
```

Logic:
1. Collect all unique ingredient families across all snapshots.
2. For each family:
   - Filter snapshots to days where this family appears in `ingredientFamilies`.
   - Exclude days where `isTransitionBuffer` or `isExposureBuffer` is true.
   - Optionally exclude days where `isMedicationActive` is true (if `options.excludeMedicationPeriods`).
   - Optionally exclude days where `dataSource === "scorecard_fallback"` (if `!options.includeScoreCardFallback`).
   - From remaining days:
     - `avgPoopScore` = mean of all `avgPoopScore` values (ignoring nulls).
     - `avgItchScore` = mean of all `itchScore` values (ignoring nulls).
     - `badDayCount` = days where `avgPoopScore >= 5`.
     - `goodDayCount` = days where `avgPoopScore <= 3`.
     - `daysWithLogData` = days where `dataSource === "event_logs"`.
   - **Position weighting:** if the ingredient typically appears in position ≤5 (top 5 by weight), its weight is 1.0. Positions 6-10 get 0.8. Positions 11+ get 0.6. Average across all products containing it.
   - **Ambiguous handling:** if `isAmbiguous`, the ingredient contributes to ALL `ambiguousFamilies` but each contribution has weight multiplied by 0.5.
   - **Hydrolyzed distinction:** hydrolyzed forms are scored separately from non-hydrolyzed (e.g. "Chicken (hydrolyzed)" is a different entry than "Chicken").
   - Compute `confidence` via `computeConfidence()`.
3. Sort by `avgPoopScore` descending (highest = most problematic). Secondary sort by `totalDaysExposed` descending for tiebreaker.

### `flagCrossReactivity()`

```
flagCrossReactivity(
  scores: IngredientScore[],
  crossReactivityGroups: { groupName: string; families: string[] }[],
) → IngredientScore[]
```

Logic:
- For each cross-reactivity group (poultry, ruminant, fish):
  - Find all ingredient scores whose family is in the group.
  - If **2+ families** in the group both have `avgPoopScore >= 4.0` or `badDayCount / totalDaysExposed > 0.3`:
    - Annotate each with `crossReactivityGroup = groupName`.
  - This flags patterns like "chicken bad AND turkey bad → poultry group pattern."

### `computeConfidence()`

```
computeConfidence(
  daysWithLogData: number,
  totalDaysExposed: number,
  hasEventLogs: boolean,
  hasScorecardOnly: boolean,
) → Confidence
```

Logic:
- If `daysWithLogData >= 14` → `"high"`
- If `daysWithLogData >= 7` → `"medium"`
- If `daysWithLogData >= 3` → `"low"`
- Otherwise → `"insufficient"`
- If only scorecard data (no event logs), cap at `"medium"` regardless of day count.

---

## 1c. DB Query Layer (`src/lib/correlation/queries.ts`)

Single function that fetches all raw data needed by the engine. Returns typed arrays ready for pure function consumption.

### `getCorrelationData()`

```
getCorrelationData(
  dogId: string,
  dateRange?: { start: string; end: string },
) → Promise<CorrelationData>
```

Returns:
```ts
interface CorrelationData {
  feedingPeriods: FeedingPeriod[]
  poopLogs: PoopLog[]
  itchinessLogs: ItchinessLog[]
  vomitLogs: VomitLog[]
  treatLogs: TreatLogWithIngredients[]  // treat logs joined with product ingredients
  productIngredientMap: Map<string, IngredientExposure[]>  // productId → enriched ingredients
  scorecards: FoodScorecard[]
  exposures: AccidentalExposure[]
  medications: Medication[]
  pollenLogs: PollenLog[]
  crossReactivityGroups: { groupName: string; families: string[] }[]
}
```

Queries:
1. All feeding periods for dogId (optionally filtered by date range overlap).
2. All poop/itch/vomit logs for dogId in range.
3. All treat logs for dogId in range, with product info.
4. Collect all unique product IDs from feeding periods + treat logs. For each:
   - JOIN `product_ingredients` → `ingredients` to build `IngredientExposure[]` per product.
   - One query: `SELECT pi.product_id, pi.position, i.* FROM product_ingredients pi JOIN ingredients i ON pi.ingredient_id = i.id WHERE pi.product_id IN (...)`.
   - Group into `Map<productId, IngredientExposure[]>`.
5. Food scorecards for all plan group IDs in the feeding periods.
6. Accidental exposures for dogId in range.
7. Medications for dogId (active during range).
8. Pollen logs matching dog's location in range.
9. Cross-reactivity groups from `ingredient_cross_reactivity` table.

---

## 1d. Tests (`src/lib/correlation/__tests__/engine.test.ts`)

All tests use mock data — no DB. Import pure functions from `engine.ts`.

### Test cases:

**Transition buffer:**
- Create 2 feeding periods (food A ends day 10, food B starts day 11). Log poop scores days 1-20.
- With `transitionBufferDays = 5`: days 11-15 should have `isTransitionBuffer = true`.
- `computeIngredientScores` should NOT include days 11-15 in any scores.

**Treat inclusion:**
- Feeding period has Product A (chicken + rice). Treat on day 5 has Product B (beef jerky).
- Day 5 snapshot should include chicken, rice, AND beef families.

**Ambiguous ingredients:**
- Product with "Poultry By-Product Meal" (ambiguous, could be chicken/turkey/duck).
- Score should contribute to all three families at 0.5 weight each.

**Hydrolyzed distinction:**
- Product A has "Chicken Meal" (not hydrolyzed). Product B has "Hydrolyzed Chicken" (hydrolyzed).
- These should produce TWO separate `IngredientScore` entries: "Chicken" and "Chicken (hydrolyzed)".

**Scorecard fallback:**
- Feeding period with scorecard `poopQuality = 3` but no daily poop logs.
- `buildDaySnapshots` should set `avgPoopScore = 3` and `dataSource = "scorecard_fallback"`.
- Confidence capped at "medium" when only scorecard data.

**Cross-reactivity:**
- Chicken ingredient with avgPoopScore 5.2, turkey ingredient with avgPoopScore 4.8.
- `flagCrossReactivity` should annotate both with `crossReactivityGroup = "poultry"`.

**Confidence levels:**
- 14+ days with event logs → "high"
- 7-13 days → "medium"
- 3-6 days → "low"
- <3 days → "insufficient"
- 20 days but all scorecard-only → capped at "medium"

**Edge cases:**
- No data at all → empty `CorrelationResult` with zero totals.
- Single feeding period, no poop logs → all ingredients get `confidence = "insufficient"`.
- Overlapping feeding periods (two foods at once) → both contribute ingredients to shared days.
- Food with zero logs and no scorecard → excluded from scoring entirely.

**Ingredient position weighting:**
- Product where "Chicken" is position 1 and "Rice" is position 12.
- Chicken should have weight 1.0, rice should have weight 0.6.

**Medication exclusion:**
- Medication active days 5-10. With `excludeMedicationPeriods = true`, those days excluded from scoring.
- With `excludeMedicationPeriods = false`, those days included (default).

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/lib/correlation/types.ts` | **Create** | All correlation type definitions |
| `src/lib/correlation/engine.ts` | **Create** | Pure functions: buildDaySnapshots, computeIngredientScores, flagCrossReactivity, computeConfidence |
| `src/lib/correlation/queries.ts` | **Create** | getCorrelationData — DB fetch layer |
| `src/lib/correlation/__tests__/engine.test.ts` | **Create** | 10+ test cases for all engine functions |

## Verification

- `yarn build` passes
- `yarn test` — all engine tests pass
- No UI changes — this is purely the data/computation layer
