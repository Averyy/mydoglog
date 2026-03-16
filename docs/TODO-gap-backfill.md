# Gap Backfill Banner

## Problem

Missed logging days weaken correlation engine confidence. Users don't realize they have gaps until data quality suffers. The app needs to surface unlogged days and make it easy to catch up.

## Solution

Persistent banner on Home between the quick-log grid and log feed. Detects unlogged days within the active feeding period and lets the user backfill them in one quick flow — same scorecard-style multi-select pickers used by the existing food backfill.

> "You have 3 unlogged days (Mar 11–13). Backfill?"

### Why a banner, not a calendar

- Less code (no calendar component, no new page)
- More actionable (tells you what to do, not just what you missed)
- Better for correlation (fills actual data gaps)
- Mobile-friendly (no tiny calendar grid on phone)

A calendar could come later as a nice-to-have on Insights.

## Gap Detection

A date is a **gap** if ALL of the following are true:

1. The date has an active (non-backfill) feeding period covering it
2. The date is NOT within an active food transition (has `transitionDays` set and date falls within the transition window)
3. The date has zero `poopLogs` entries
4. The date has no existing backfill feeding periods covering it
5. The date is within the last 14 days

Poop logs are the primary signal — itch-only days are still considered gaps since poop is the core GI correlation input. Days before the dog's first feeding period don't count.

Transition days are excluded because the data isn't valuable as an aggregate — the whole point of a transition is tracking the gradual change, which requires real daily logs.

## Backfill Flow

**Single flow regardless of gap count.** The user sees the same scorecard-style multi-select pickers from the existing food backfill (`FecalScorePickerMulti` + `ItchScorePickerMulti`). They select the range of poop scores (1-7) and itch scores (0-5) that applied across all the gap days. One screen, two pickers, done.

This works the same whether the gap is 2 days or 14 — the user is giving an aggregate "how was it generally?" answer, not per-day recall.

### What gets created

Backfill feeding periods + scorecard, reusing the existing backfill data model:

1. **New feeding period rows** (`isBackfill = true`) mirroring the active routine's products for the gap date range, with a new `planGroupId`
2. **A `foodScorecard`** on that plan group with the user's selected `poopQuality[]` and `itchSeverity[]` arrays

This keeps backfill data clearly separated from real daily logs and gives it the appropriate 0.5x confidence weight in the correlation engine (vs 1.0x for actual observed logs). Backfill estimates shouldn't masquerade as real data.

### Correlation engine change

The engine's `buildBackfillSnapshots` currently skips ALL dates within the non-backfill feeding period window, even dates with zero daily logs. This means gap backfill scorecards for dates inside the active routine's range would be silently ignored.

**Required fix:** Change the skip condition from "date is in daily window" to "date has an actual daily snapshot with real log data." Dates within the window that have no logs should fall through to backfill snapshot processing. This is a small, targeted change — the skip logic exists to prevent backfill data from overriding real logs, and that invariant is preserved.

### Skip days

Some days you genuinely can't recall (dog was with a sitter, too long ago, etc.). The banner has a "Skip" action that marks selected days as intentionally ignored. Skipped days are excluded from correlation entirely — they don't hurt data quality because the engine knows to ignore them, unlike silent gaps which dilute confidence.

## API

### `GET /api/dogs/[id]/gaps`

Returns unlogged dates within the last 14 days that have an active feeding period.

**Query logic:**
1. Get all non-backfill feeding periods for the dog
2. Enumerate dates from `max(earliest_period_start, today - 14)` to `yesterday`
3. Filter to dates covered by a feeding period (using `resolveActivePlan` logic)
4. Exclude dates that have any `poopLogs` entry
5. Exclude dates that already have backfill feeding periods covering them
6. Exclude dates marked as skipped in `skipped_days`

**Response:**
```json
{
  "gaps": ["2026-03-11", "2026-03-12", "2026-03-13"],
  "count": 3,
  "activeRoutine": {
    "planGroupId": "abc-123",
    "items": [
      { "productId": "prod-1", "productName": "Acana Singles", "quantity": 150, "quantityUnit": "g" }
    ]
  }
}
```

The response includes the active routine so the backfill POST can mirror its products without a second round-trip.

### `POST /api/dogs/[id]/gaps/backfill`

Creates backfill feeding periods + scorecard for gap dates.

**Request body:**
```json
{
  "dates": ["2026-03-11", "2026-03-12", "2026-03-13"],
  "poopQuality": [2, 3],
  "itchSeverity": [0, 1]
}
```

**Behavior:**
1. Validate all dates are legitimate gaps (have feeding period, no existing logs, within 14 days)
2. Resolve the active routine's products for the gap date range
3. Group contiguous gap dates into ranges (e.g., Mar 11-13 = one range, Mar 5 + Mar 8 = two ranges)
4. For each contiguous range, in a transaction:
   - Create feeding period rows (`isBackfill = true`) for each product in the active routine, with a new `planGroupId`, `startDate` = range start, `endDate` = range end
   - Create a `foodScorecard` with the provided `poopQuality` and `itchSeverity` arrays
5. Return created plan group IDs

### `POST /api/dogs/[id]/gaps/skip`

Marks dates as intentionally skipped (can't remember, dog was with sitter, etc.).

**Request body:**
```json
{
  "dates": ["2026-03-11", "2026-03-12"]
}
```

**Behavior:**
1. Validate dates are legitimate gaps
2. Insert rows into `skipped_days` table (dogId, date) with ON CONFLICT ignore
3. Correlation engine excludes these dates entirely

### Schema addition

New `skipped_days` table: `id`, `dog_id` (FK → dogs), `date`, `created_at`. Unique constraint on (dog_id, date).

## UI

### Banner Component

- Placement: between QuickLogGrid and LogFeed on Home
- Only renders when gaps exist (fetched via `GET /gaps`)
- Shows count and date range: "You have 3 unlogged days (Mar 11–13)"
- Two actions: **"Backfill"** button and **"Skip"** button
- Skip marks selected days as intentionally ignored (can't remember, dog was with a sitter, etc.) — these days are excluded from correlation and won't show in the banner again
- Per-dog: only shows gaps for the currently selected dog tab

### Backfill Modal

- Responsive container: Drawer on mobile, Dialog on desktop (existing pattern)
- Header: "Backfill Mar 11–13" with date range
- Body: `FecalScorePickerMulti` + `ItchScorePickerMulti` (reused from existing backfill)
- Footer: "Save" button
- On save: POST to `/gaps/backfill`, close modal, refresh banner + log feed

### Post-backfill

- Banner disappears (no more gaps)
- LogFeed refreshes
- `log-saved` window event fired so other components refresh

## Edge Cases

- **Gap spans a food change:** Contiguous date grouping means each range maps to whatever routine was active during that range. If the routine changed mid-gap, the ranges will be split at the change boundary (since `resolveActivePlan` returns different plan groups for different dates). Each range gets its own backfill plan group with the correct products.
- **User logs a day manually after gap detected but before backfill:** The POST validates that each date is still a gap. Dates with existing logs are rejected.
- **>14 day absence:** Banner shows up to 14 gap days. Older unlogged periods can be covered via the existing food backfill flow on the Food page.
- **No active feeding period:** No gaps detected, no banner shown.
- **Multiple dogs:** Each dog's gaps are independent. Banner shows for the currently selected dog tab.
- **Non-contiguous gaps:** Dates are grouped into contiguous ranges. Each range gets its own backfill plan group + scorecard. The same poop/itch scores are applied to all ranges (single user input covers the whole gap set).

## What This Reuses

- `FecalScorePickerMulti` component (from food backfill scorecard form)
- `ItchScorePickerMulti` component (from food backfill scorecard form)
- Backfill feeding period + scorecard creation pattern (from `POST /food/backfill`)
- Responsive Drawer/Dialog container pattern
- `resolveActivePlan` logic for determining active feeding periods
- `getToday`, `shiftDate`, `enumerateDates` date utilities
- `log-saved` event pattern for cross-component refresh
- Correlation engine backfill snapshot processing (with the window-skip fix)

## What's New

- Correlation engine fix: `buildBackfillSnapshots` skip condition narrowed to dates with actual logs
- `GET /api/dogs/[id]/gaps` route
- `POST /api/dogs/[id]/gaps/backfill` route
- `GapBanner` component (banner + backfill modal trigger)
- Backfill modal content (thin wrapper around existing scorecard pickers)
