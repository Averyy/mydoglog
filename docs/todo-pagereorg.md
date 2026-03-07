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

### Quick-log buttons
- Daily Check-in, Log Stool, Log Itch, Log Treat (existing 2x2 grid)

### Log feed
- Chronological list of recent log entries, most recent first
- Shows: entry type, value/score, timestamp
- Entry types: poop (score + label), itch (score + label), treat (product name), daily check-in
- Initial load: last 7 days
- "Load more" adds another 7 days
- No summary stats, no routine preview, no scorecard link

### Removed from homepage
- Today's summary score boxes (stool/itch/treats) — the feed shows this inline
- Routine preview — moves to Food page
- Food Scorecard link — now a nav item (Insights)
- "Last recorded" fallback section — the feed handles this naturally

---

## Food (`/dogs/[id]/food`)

Merges current Routine (`/dogs/[id]/feeding`) and the scorecard ratings from Food Scorecard page.

### Active routine (top)
- Active plan card (food + supplements + medications) — existing `ActivePlanCard`
- Edit routine button — opens existing `RoutineEditor`
- Same scorecard-on-change flow when switching routines

### Food history (below)
- Chronological list of past plan groups (most recent first)
- Each entry shows: date range, duration, products, backfill badge
- Scorecard verdict + ratings displayed inline (not a separate page)
- Ability to add/edit scorecard for any past plan group inline

### Migration notes
- Route changes from `/dogs/[id]/feeding` to `/dogs/[id]/food`
- Redirect old route to new
- Pull scorecard display out of the current food-scorecard page into shared components
- Scorecard *entry form* stays as modal/drawer (existing pattern)

---

## Insights (`/dogs/[id]/insights`)

Takes the analysis content from current Food Scorecard page.

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
- Correlation components move as-is, no logic changes

---

## Implementation Order

1. **Create log feed API + component** — new endpoint returning recent logs across all types, new feed component
2. **Rebuild homepage** — strip to quick-log buttons + log feed, remove routine/scorecard/stats
3. **Create Food page** — move active routine from feeding page, integrate scorecard ratings inline from food-scorecard page
4. **Create Insights page** — move correlation/analysis content from food-scorecard page
5. **Update nav** — rename Routine to Food, rename Scorecard to Insights, update routes
6. **Add redirects** — `/dogs/[id]/feeding` -> `/dogs/[id]/food`, `/dogs/[id]/food-scorecard` -> `/dogs/[id]/insights`
7. **Clean up** — remove old page files, dead imports

---

## Files Affected

### New
- `src/app/(app)/dogs/[id]/food/page.tsx`
- `src/app/(app)/dogs/[id]/insights/page.tsx`
- `src/components/log-feed.tsx`
- `src/app/api/dogs/[id]/logs/recent/route.ts`

### Modified
- `src/app/(app)/page.tsx` — strip to quick-log + feed
- `src/app/(app)/dashboard-client.tsx` — strip to quick-log + feed
- `src/app/(app)/nav-links.tsx` — update routes and labels

### Removed (after migration)
- `src/app/(app)/dogs/[id]/feeding/page.tsx`
- `src/app/(app)/dogs/[id]/food-scorecard/page.tsx`

### Redirects
- `src/app/(app)/dogs/[id]/feeding/page.tsx` — redirect to `/dogs/[id]/food`
- `src/app/(app)/dogs/[id]/food-scorecard/page.tsx` — redirect to `/dogs/[id]/insights`
