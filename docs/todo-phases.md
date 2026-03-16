# MyDogLog — Implementation Phases

Living checklist. Update as work progresses.

---

## Completed

- **Phases 0–3.7:** Data prep (1,260+ products, 16 brands, AAFCO mappings), Next.js/Drizzle/PostgreSQL foundation, daily logging flows, routine templates, food scorecards, correlation engine (two-track skin/GI), page reorganization (Home/Food/Insights), dog URL slugs
- **Phase 4:** Pollen/mold collection + correlation discounting, medication tracking (67-drug catalog), insights timeline charts with gantt bars, LLM export, medication on/off correlation, GitHub Actions pollen cron
- **Phase 4.5:** Gradual food transitions (0-7 days), transition schedule, routine editor integration, correlation buffer handling, gantt striped bands

---

## Remaining (lowest effort first)

### 1. Gap Backfill Banner
Fully specced in `TODO-gap-backfill.md`. Persistent banner on Home surfacing unlogged days, single backfill flow reusing existing scorecard pickers. Two new API routes, one new component, one correlation engine fix.

### 2. Weight Tracking
See `TODO-weight-tracking.md`. New `weight_logs` table, two API routes, weight chart on Insights (reuses existing chart infra), optional field on check-in.

### 3. MCP Server
Claude queries existing API routes directly. No new UI, no new data — just an MCP wrapper over what already exists.

### 4. Custom Food Entry
See `TODO-custom-food-entry.md`. New table, ingredient parsing with AAFCO family matching, product search integration, CRUD UI. Medium effort — ingredient parsing is the tricky part.

### 5. Sharing & Pack Access
See `TODO-sharing.md`. Schema migration (`pack_members` table, drop `ownerId`), auth helper swap across all routes, invite system, pack management UI, public share route. Touches every API route.

### 6. Vet Export
Formatted reports for vet visits. Depends on having enough data/features in place. Moderate effort — mostly formatting/layout.

### 7. AI Poop Photo Analysis
See `TODO-ai-poop-analysis.md`. Lowest priority, highest effort. Photo capture, dataset collection, model training (3,500+ labeled images), ONNX inference integration.

### 8. General Vet/Health Timeline + Document Uploads
Vaccinations, vet visits, surgical history, PDF uploads. New schema, new UI, lowest priority.

---

## New Brand Scrapers (parallel track)

See `todo-new-sources.md`. Can happen anytime independent of app features.

**Up next:** Zignature, President's Choice, Nutram
**Later:** Oven-Baked Tradition, Horizon, Petkind, Holistic Select

---

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
- ~~Custom food builder~~ — replaced by custom food entry (simpler scope: data entry not recipe building)
- ~~Weather tracking~~ — pollen/mold tracking already captures the relevant environmental signal
