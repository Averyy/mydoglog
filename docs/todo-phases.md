# MyDogLog — Implementation Phases

Living checklist. Update as work progresses.

---

## Phases 0–3.5 ✅ (Complete)

- **Phase 0 — Data Prep:** 1,260 products scraped across 16 brands, manual whole foods, AAFCO ingredient family mappings
- **Phase 1 — Foundation:** Next.js + Drizzle + PostgreSQL, build.py product loader, Better Auth, dog CRUD, product search API
- **Phase 2 — Core Loop:** Daily check-in / quick poop / quick treat flows, routine templates, food scorecard, dashboard, responsive drawer/dialog pattern
- **Phase 3 — Analysis:** Correlation engine (ingredient-level, two-track skin/GI), correlation results page, food scorecard improvements, Insights tab
- **Phase 3.5 — Scorecard simplification:** Removed redundant scorecard from routine change flow (daily logs already capture this). Made scorecard mandatory for backfills (no skip). Zero-log feeding periods are deleted on routine change instead of kept as empty data. Active plans derive scores from daily logs only.
- **Phase 3.6 — Page reorganization:** Three-page structure (Home/Food/Insights). Home = quick-log grid + log feed. Food = active routine + food history with inline scorecards. Insights = ingredient correlation analysis. Extracted components: `log-feed.tsx`, `ingredient-analysis-section.tsx`, `ingredient-row.tsx`, `product-ingredient-list.tsx`, `score-grid.tsx`. API routes reorganized under `/food/` and `/insights/`.
- **Phase 3.7 — Dog URL slugs:** Replaced UUID-based dog page URLs (`/dogs/[id]/food`) with human-readable top-level slugs (`/[slug]/food`). Slug column with per-owner unique index, name validation (letters+spaces, 3-20 chars), reserved name handling, `DogPageProvider` context, `requireDogBySlug` helper. API routes stay on UUID internally.

## Phase 4: Extended Logging + Visualization

- [x] Pollen + mold collection — pollen-sparr cron (`POST /api/cron/pollen`), `daily_pollen` table, dual-provider (aerobiology + TWN), batch upsert with actual-over-forecast preference, gap detection/backfill. Correlation engine applies pollen discount to bad itch days (0.4x high, 0.7x moderate), 3-day rolling max, seasonal confounding flag per ingredient. Weather (Open-Meteo temp/humidity) deferred — spore levels already capture freeze-thaw signal.
- [x] Medication tracking — dedicated `/dogs/[id]/meds` page, 67-drug catalog across 5 categories (allergy, parasite, GI, pain, steroid), searchable picker with free-text fallback, side effects, dosing intervals. Removed from routine editor/daily check-in (standalone page). See commit `a510312`.
- [x] Insights charts — time-series graph (poop scores, itch scores, pollen + mold background overlays) with selectable range (7d/30d/60d/90d/all), gantt-style bars for food/supplement/medication periods. Shared date-utils and timeline types extracted. Client-side range caching with AbortController.
- [x] LLM export — "Export for AI" button on settings page, structured markdown download with timeline/section controls. API route (`GET /api/dogs/[id]/export/llm`), pure markdown formatter (`src/lib/export-llm.ts`), export modal with timeline dropdown + section checkboxes. Includes: profile, current diet, supplements/treats, medications, food history with ingredient dedup, daily log table, two-track correlation data, pollen-symptom buckets, cross-reactivity groups, research links, computed reference stats (constant/unique ingredients, body area frequency, med-change events, stool frequency).
- [ ] Extend correlation engine: medication on/off comparison (medication is the #1 confounding variable for itch)
- [ ] Set up cron schedule on deploy — daily 14:00 UTC, `POST /api/cron/pollen` with `Authorization: Bearer $CRON_SECRET`. Until then, run manually.

## Phase 4.5: Food Transition ✅ (Complete)

- Gradual food transition (0-7 days) when switching main food, with per-day mixed quantity rows
- `transitionDays` + `previousPlanGroupId` columns on `feedingPeriods`, migration applied
- `computeTransitionSchedule` pure function with formula `newFraction = day / (N + 1)`
- Routine editor detects main food change → "Next →" → transition step with live quantity preview
- `getActivePlanForDog` date filtering fix, `targetItems` for editor pre-fill during active transition
- Food page: "Transitioning — Day X of N" badge, deduped history, "End transition" button + API
- Correlation engine uses `transitionDays` for buffer duration, suppresses double-buffer at transition end
- Gantt chart: single striped transition band with `--gantt-transition` token
- Shared `buildFeedingGroupMap()` helper extracted to `src/lib/feeding.ts` (food list GET + scorecard dedup)
- Recent products filter excludes single-day transition rows

## Phase 5: Sharing & Pack Access

See `todo-sharing.md` for full spec.

- [ ] `pack_members` table + backfill from `ownerId` + drop `ownerId`
- [ ] `shareToken` column on dogs
- [ ] `requireDogOwnership()` → `requirePackAccess()` across all routes
- [ ] Invite system (single-use codes, 1-week expiry)
- [ ] Pack management UI (list members, remove, invite link)
- [ ] Public share route (`/share/[token]`) — unauthenticated read-only view, 1hr cache

## Future Considerations

Out of scope for initial build. Roughly prioritized.

- MCP server (Claude queries API routes directly — low effort, high personal value)
- Weight history (track over time, currently just a single field)
- Vet export (formatted reports for vet visits — replaces manual `peaches.md` notes)
- General vet/health timeline (vaccinations, vet visits, surgical history)
- Document uploads (PDFs for vet records, lab results)

### Skipped permanently

- ~~iOS app~~ — responsive web works fine
- ~~Barcode scanning~~ — DB has 1,260+ products, search works
- ~~URL-based product import~~ — scrapers already exist
- ~~Transition wizard~~ — replaced by food transition feature (Phase 4.5)
- ~~Meal-level logging~~ — daily granularity is sufficient
- ~~Reformulation tracking~~ — rare event, not worth schema complexity
- ~~Medication database~~ — completed in Phase 4 as medication tracking
- ~~Vomiting log UI~~ — rare for current dog, note in daily check-in if needed
- ~~Symptom log UI~~ — mucus/blood covered by poop log extension above
- ~~Accidental exposure log UI~~ — rare events, daily check-in notes suffice
- ~~Custom food builder~~ — raw diets/home-cooked not needed, commercial products cover all use cases
- ~~Weather tracking~~ — pollen/mold tracking already captures the relevant environmental signal
