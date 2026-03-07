# Page Reorganization Plan

Three pages, three user modes: log, manage, analyze.

## New Structure

| Page | Route | Purpose |
|------|-------|---------|
| **Home** | `/` | Log + recent activity |
| **Food** | `/dogs/[id]/food` | Manage routine + food history |
| **Insights** | `/dogs/[id]/insights` | Ingredient correlation + future Phase 4 analytics |
| **Settings** | `/settings` | Unchanged |

**Nav:** Home, Food, Log (+), Insights, Settings

---

## Home (`/`)

Replaces current dashboard. Two sections only.

**Current homepage** (`page.tsx` → `dashboard-client.tsx`):
- Dog switcher tabs (keep)
- Header with dog name/breed (keep)
- Quick-log 2x2 grid (keep) — all logging modals centralized in `log-action-sheet.tsx`
- Today's summary boxes: stool/itch/treats (REMOVE)
- "Last recorded" fallback (REMOVE)
- Routine summary section (REMOVE — moves to Food page)
- Food Scorecard link (REMOVE — now a nav item)

### Quick-log buttons
- Daily Check-in, Log Stool, Log Itch, Log Treat (existing 2x2 grid, keep as-is)

### Log feed
- Chronological list of recent **manual** log entries, most recent first
- Only user-initiated logs — no backfills, no implicit routine records
- Shows: entry type, value/score, timestamp
- Entry types: poop (score + label), itch (score + label), treat (product name), daily check-in
- Initial load: last 7 days
- "Load more" adds another 7 days
- No summary stats, no routine preview, no scorecard link

---

## Food (`/dogs/[id]/food`)

Merges current Routine (`/dogs/[id]/feeding`) and the scorecard ratings from Food Scorecard page.

**Current feeding page** uses:
- `ActivePlanCard` (`src/components/active-plan-card.tsx`, 109 lines) — shows current food + medications
- `RoutineEditor` (`src/components/routine-editor.tsx`, 607 lines) — dialog for editing routine
- `FoodScorecardForm` (`src/components/food-scorecard-form.tsx`, 184 lines) — modal form triggered on routine change

### Active routine (top)
- Active plan card (food + supplements + medications) — existing `ActivePlanCard`
- Edit routine button — opens existing `RoutineEditor`
- Same scorecard-on-change flow when switching routines

### Food history (below)
- Chronological list of past plan groups (most recent first)
- Each entry shows: date range, duration, products, medication periods, backfill badge
- Scorecard displayed inline using `ScoreGrid` (`src/components/score-grid.tsx`, 96 lines — already created, untracked)
- `FoodScoreCard` (`src/components/food-score-card.tsx`) wraps each product — current props: `brandName`, `productName`, `imageUrl`, `isCurrent`, `dateLabel`, `className`, `children`
- Ability to add/edit scorecard for any past plan group inline via `FoodScorecardForm` modal
- Backfill flow ("Add past food") lives here — 2-step modal: pick product → enter dates → optionally rate
- Food cards can expand to show ingredient list (loaded per-product)

### Migration notes
- Route changes from `/dogs/[id]/feeding` to `/dogs/[id]/food`
- Redirect old route to new
- Pull scorecard display + food card rendering out of current `food-scorecard/page.tsx` (1334 lines) into the Food page
- Scorecard *entry form* stays as modal/drawer (existing `FoodScorecardForm` pattern)
- `score-grid.tsx` already exists as a shared component — commit it

---

## Insights (`/dogs/[id]/insights`)

Takes the analysis content from current Food Scorecard page.

**Current food-scorecard page** (1334 lines) contains these extractable sections:
- `IngredientAnalysisSection()` — main analysis block with signal mode toggle (stool/itch/both)
- `IngredientRow()` — expandable ingredient analysis with cross-reactivity info
- `ProductIngredientList()` — classified ingredients with salt position marker
- These are **deeply coupled to local state** — extraction will need careful refactoring

### Current content (moved from food-scorecard)
- Ingredient correlation results (GI + skin tracks)
- Ingredient score breakdowns
- Product-ingredient cross-reference

### Phase 4 additions (future)
- Dashboard timeline (time-series graph + Gantt bars)
- Pollen + weather + season overlays
- Extended correlation (medication-aware, season-aware)
- LLM export button

### Migration notes
- Route changes from `/dogs/[id]/food-scorecard` to `/dogs/[id]/insights`
- Redirect old route to new
- Correlation components need extraction from page-level functions into standalone components
- Data fetching: current `/api/dogs/[id]/food-scorecard/` endpoint returns everything (correlation + product ingredients + plan groups). Keep as-is during build, clean up endpoints after pages are working.

---

## Implementation Order

1. **Create log feed API + component** — new endpoint merging poop/itch/treat/checkin logs, new feed component
2. **Rebuild homepage** — strip `dashboard-client.tsx` to quick-log buttons + log feed (remove Today section, routine summary, scorecard link)
3. **Create Food page** — move active routine from feeding page, integrate scorecard display with `FoodScoreCard` + `ScoreGrid` + `FoodScorecardForm`
4. **Extract Insights components** — pull `IngredientAnalysisSection`, `IngredientRow`, `ProductIngredientList` out of food-scorecard page into standalone components
5. **Create Insights page** — compose extracted components, wire to existing `/api/dogs/[id]/food-scorecard/` data
6. **Update nav** (`nav-links.tsx`) — rename Routine (Utensils icon) to Food, rename Scorecard (Star icon) to Insights, update routes
7. **Add redirects** — `/dogs/[id]/feeding` → `/dogs/[id]/food`, `/dogs/[id]/food-scorecard` → `/dogs/[id]/insights`
8. **Clean up** — remove old page files, dead imports

---

## Existing API Routes

These stay as-is unless noted:
- `GET /api/dogs/[id]/feeding/` — plan history (FeedingPlanGroup[])
- `POST /api/dogs/[id]/feeding/backfill/` — backfill feeding period
- `GET /api/dogs/[id]/feeding/today/` — today's feeding status
- `GET /api/dogs/[id]/routine/` — active plan + medications
- `GET /api/dogs/[id]/food-scorecard/` — all scorecard data (correlation + ingredients + plan groups)
- `PUT /api/feeding/groups/[planGroupId]/scorecard/` — save scorecard for group
- `GET/PUT/DELETE /api/feeding/groups/[planGroupId]/` — plan group CRUD
- `POST/GET /api/dogs/[id]/poop/` — poop logs (needed for log feed)
- `POST/GET /api/dogs/[id]/itchiness/` — itch logs (needed for log feed)
- `POST/GET /api/dogs/[id]/treats/` — treat logs (needed for log feed)
- `GET /api/dogs/[id]/checkin/today/` — check-in status (needed for log feed)

---

## Files Affected

### New
- `src/app/(app)/dogs/[id]/food/page.tsx`
- `src/app/(app)/dogs/[id]/insights/page.tsx`
- `src/components/log-feed.tsx`
- `src/app/api/dogs/[id]/logs/recent/route.ts` — merged log feed endpoint
- `src/components/ingredient-analysis.tsx` — extracted from food-scorecard page
- `src/components/product-ingredient-list.tsx` — extracted from food-scorecard page

### Already Created (untracked, needs commit)
- `src/components/score-grid.tsx` — score display grid, already built

### Modified
- `src/app/(app)/page.tsx` — strip to quick-log + feed
- `src/app/(app)/dashboard-client.tsx` — strip to quick-log + feed
- `src/app/(app)/nav-links.tsx` — update routes and labels

### Reused As-Is
- `src/components/active-plan-card.tsx` — active routine display
- `src/components/routine-editor.tsx` — routine editing dialog (607 lines)
- `src/components/food-score-card.tsx` — product card wrapper
- `src/components/food-scorecard-form.tsx` — scorecard entry form modal
- `src/components/log-action-sheet.tsx` — centralized log modal dispatcher
- `src/components/daily-checkin.tsx` — check-in content (565 lines)
- `src/components/treat-logger.tsx` — treat logging content (279 lines)
- `src/components/quick-poop-logger.tsx` — poop logging
- `src/components/itchiness-logger.tsx` — itch logging (373 lines)

### Removed (after migration)
- `src/app/(app)/dogs/[id]/feeding/page.tsx` — replaced by `/dogs/[id]/food`
- `src/app/(app)/dogs/[id]/food-scorecard/page.tsx` — replaced by `/dogs/[id]/insights` + Food page

### Redirects (using Next.js `redirect()`)
- `src/app/(app)/dogs/[id]/feeding/page.tsx` → `/dogs/[id]/food`
- `src/app/(app)/dogs/[id]/food-scorecard/page.tsx` → `/dogs/[id]/insights`
