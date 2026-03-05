# Correlation Engine — Part 2: Displaying Correlation Data

Minimal UI to surface the engine output from Part 1 so we can verify and fine-tune the underlying data. No fancy charts or exports — just enough to see if the numbers are right.

**Depends on Part 1** (types, engine, queries, tests) being complete.

---

## 2a. Correlation API Endpoint (`src/app/api/dogs/[id]/correlations/route.ts`)

### `GET /api/dogs/[id]/correlations`

Query params:
- `bufferDays` — transition buffer (default 5, range 0-14)
- `exposureBufferDays` — accidental exposure buffer (default 5, range 0-14)
- `startDate` / `endDate` — optional date range filter
- `includeScorecardFallback` — include scorecard-only data (default true)
- `excludeMedicationPeriods` — exclude days with active medications (default false)

Auth: requires dog ownership.

Logic:
1. `getCorrelationData(dogId, dateRange)` — fetch all raw data.
2. `buildDaySnapshots(...)` — build daily snapshots with buffer marking.
3. `computeIngredientScores(snapshots, options)` — per-ingredient scores.
4. `flagCrossReactivity(scores, crossReactivityGroups)` — annotate cross-reactive patterns.
5. Return `CorrelationResult` JSON.

Response shape:
```json
{
  "ingredientScores": [
    {
      "family": "chicken",
      "sourceGroup": "poultry",
      "avgPoopScore": 4.8,
      "avgItchScore": 2.3,
      "badDayCount": 8,
      "goodDayCount": 3,
      "totalDaysExposed": 22,
      "daysWithLogData": 18,
      "confidence": "high",
      "weight": 1.0,
      "productsContaining": ["prod-id-1", "prod-id-2"],
      "crossReactivityGroup": "poultry",
      "isHydrolyzed": false
    }
  ],
  "dateRange": { "start": "2025-10-01", "end": "2026-03-05" },
  "transitionBufferDays": 5,
  "exposureBufferDays": 5,
  "totalDaysAnalyzed": 120,
  "totalDaysExcluded": 15,
  "totalDaysWithLogData": 85
}
```

---

## 2b. Improve Food Scorecard API (`src/app/api/dogs/[id]/food-scorecard/route.ts`)

Modify the existing `aggregateLogStats()` and response to surface ingredient data on the scorecard.

### Transition buffer in log stats

- Accept the previous food change date (derived from plan groups sorted by start date).
- Exclude poop/itch/vomit logs that fall within the first 5 days after `startDate` (the transition period when the dog is adjusting to new food).
- This means `aggregateLogStats()` gets a new parameter: `excludeBeforeDate: string | null` (startDate + 5 days, or null if first ever food).
- The WHERE clause adds `AND date >= excludeBeforeDate` when set.

### Top ingredient families per product

- For each feeding plan group, query top 5 ingredients by position:
  ```sql
  SELECT DISTINCT i.family, i.source_group, i.is_hydrolyzed, MIN(pi.position) as position
  FROM product_ingredients pi
  JOIN ingredients i ON pi.ingredient_id = i.id
  WHERE pi.product_id IN (...product IDs in this group...)
    AND i.family IS NOT NULL
    AND i.category IN ('protein', 'carb', 'fat')  -- skip vitamins/minerals
  GROUP BY i.family, i.source_group, i.is_hydrolyzed
  ORDER BY position
  LIMIT 5
  ```
- Return as `topIngredients: { family: string; sourceGroup: string; isHydrolyzed: boolean }[]` on each `FeedingPlanGroup`.

### Confidence level

- Compute confidence per group using `computeConfidence()` (or inline the same logic).
- Return as `confidence: Confidence` on `LogStats`.

### Treat exposure count

- Count distinct treat products during each feeding period that introduce NEW ingredient families not already in the routine.
- Return as `newTreatFamilyCount: number` on `LogStats`.

---

## 2c. Ingredient Display on Food Scorecard Cards

### `FoodScoreCard` component changes (`src/components/food-score-card.tsx`)

Add optional `topIngredients` prop:

```ts
interface FoodScoreCardProps {
  // ... existing props
  topIngredients?: { family: string; sourceGroup: string; isHydrolyzed: boolean }[]
}
```

Render as compact tags below the product name:
- Protein sources (poultry/red_meat/fish/egg/dairy) get a sage-colored badge.
- Carbs/other get a muted badge.
- Hydrolyzed ingredients get a small "H" suffix badge (e.g. "Chicken (H)").
- Show max 5 tags. If more, show "+N more".
- Tags are small (`text-[11px]`), rounded pills, inline-flex with gap-1.

### `FeedingPlanGroup` type changes (`src/lib/types.ts`)

```ts
export interface FeedingPlanGroup {
  // ... existing fields
  topIngredients?: { family: string; sourceGroup: string; isHydrolyzed: boolean }[]
}

export interface LogStats {
  // ... existing fields
  confidence: Confidence
  transitionDaysExcluded: number
  newTreatFamilyCount: number
}
```

### Food scorecard page changes (`src/app/(app)/dogs/[id]/food-scorecard/page.tsx`)

- Pass `topIngredients` from API response to each `FoodScoreCard`.
- Show confidence indicator next to log stats (small badge: "High", "Med", "Low", "—").
- Show treat exposure note when `newTreatFamilyCount > 0`: "N new ingredient families from treats during this period".

---

## 2d. Ingredient Correlation Page (`src/app/(app)/dogs/[id]/correlations/page.tsx`)

Full page. Three sections vertically.

### Top section: "Potential Problem Ingredients"

Red-flagged families with high bad-day ratio (`badDayCount / totalDaysExposed > 0.3` AND `avgPoopScore >= 4.0` AND `confidence != "insufficient"`).

- Each row: ingredient family name, source group badge (colored by group), # products, avg poop score (color-coded: sage ≤3, amber 3-5, adobe red ≥5), avg itch score, bad days / total days, confidence indicator.
- Cross-reactivity callout card when detected: "Poultry group (chicken, turkey) — consistently associated with poor scores. Consider eliminating the entire group."

### Middle section: "Inconclusive / Insufficient Data"

Ingredients where `confidence === "insufficient"` or results are mixed (neither clearly good nor bad).

- Same columns but muted styling.
- "Need more data" badge on insufficient items.

### Bottom section: "Well-Tolerated Ingredients"

Green-flagged families with `goodDayCount / totalDaysExposed > 0.5` AND `avgPoopScore <= 3.5` AND `confidence != "insufficient"`.

- Same columns, sage-green accent.

### Filters (top of page, collapsible)

- **Transition buffer slider** — 0-14 days, default 5. Re-fetches on change.
- **Date range picker** — start/end date inputs.
- **Scorecard fallback toggle** — include/exclude scorecard-only data.
- **Medication exclusion toggle** — exclude medication periods.
- All filters update query params and re-fetch `/api/dogs/[id]/correlations`.

### Confidence indicators

Per-row badge:
- High: filled sage dot
- Medium: half-filled sage dot
- Low: outlined dot
- Insufficient: dashed circle with "?" — row dimmed

### Empty state

If no feeding periods or fewer than 3 days of data: "Not enough data yet. Keep logging daily check-ins and the correlation engine will find patterns."

---

## 2e. Nav Integration

### Bottom nav (`src/app/(app)/bottom-nav.tsx`)

Add "Insights" item with a chart/sparkles icon. Links to `/dogs/[id]/correlations`.

Position: after Dashboard, before the `+` button. Nav order: Dashboard / Insights / + / Scorecard / Settings (or similar — maintain balance).

### Desktop nav (`src/app/(app)/desktop-nav-links.tsx`)

Add "Insights" link in the same position.

### Food scorecard page cross-link

On `src/app/(app)/dogs/[id]/food-scorecard/page.tsx`:
- Below the page header, add a link: "See ingredient analysis →" that navigates to `/dogs/[id]/correlations`.
- Only show if there are at least 2 feeding period groups (need comparison data for correlation to be useful).

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/app/api/dogs/[id]/correlations/route.ts` | **Create** | GET endpoint — runs correlation engine, returns IngredientScore[] |
| `src/app/(app)/dogs/[id]/correlations/page.tsx` | **Create** | Correlation results page — problem/tolerated/inconclusive sections, filters |
| `src/app/api/dogs/[id]/food-scorecard/route.ts` | **Modify** | Transition buffer in aggregateLogStats, top ingredients query, confidence, treat family count |
| `src/components/food-score-card.tsx` | **Modify** | Add topIngredients prop, render ingredient tags |
| `src/lib/types.ts` | **Modify** | Add topIngredients to FeedingPlanGroup, confidence/transitionDaysExcluded/newTreatFamilyCount to LogStats |
| `src/app/(app)/dogs/[id]/food-scorecard/page.tsx` | **Modify** | Pass topIngredients to cards, show confidence badge, treat note, cross-link to correlations |
| `src/app/(app)/bottom-nav.tsx` | **Modify** | Add Insights nav item |
| `src/app/(app)/desktop-nav-links.tsx` | **Modify** | Add Insights nav link |

## Verification

- `yarn build` passes
- Correlations page renders with real data
- Adjusting filter params (buffer days, date range, toggles) produces visibly different results
- Problem/tolerated/inconclusive sections categorize ingredients correctly
- Food scorecard cards show ingredient tags and confidence badges
- Nav items appear on both mobile and desktop
- All new endpoints require auth + dog ownership
- Invoke `frontend-design` skill for UI review on correlations page
