# MyDogLog — Implementation Phases

Living checklist. Update as work progresses.

---

## Completed

- **Phases 0–3.7:** Data prep (1,260+ products, 16 brands, AAFCO mappings), Next.js/Drizzle/PostgreSQL foundation, daily logging flows, routine templates, food scorecards, correlation engine (two-track skin/GI), page reorganization (Home/Food/Insights), dog URL slugs
- **Phase 4:** Pollen/mold collection + correlation discounting, medication tracking (67-drug catalog), insights timeline charts with gantt bars, LLM export, medication on/off correlation, GitHub Actions pollen cron
- **Phase 4.5:** Gradual food transitions (0-7 days), transition schedule, routine editor integration, correlation buffer handling, gantt striped bands

---

## Remaining (lowest effort first)

### 1. Vet Visit Logging
See `TODO-vet-visits.md`. Replaces daily check-in (redundant) and weight tracking. New `vet_visit_logs` table, multi-select reason chips, visit history on Dog page. Weight captured at each visit. Quick-log grid becomes: Stool → Itch → Treat → Vet Visit.

### 2. MCP Server
Claude queries existing API routes directly. No new UI, no new data — just an MCP wrapper over what already exists.

### 3. Custom Food Entry
See `TODO-custom-food-entry.md`. New table, ingredient parsing with AAFCO family matching, product search integration, CRUD UI. Medium effort — ingredient parsing is the tricky part.

### 4. Public Share Link
See `TODO-public-share.md`. Read-only public link per dog. Catch-all `/share/[token]/[...path]` route renders same page components with `isPublicView` context hiding edit UI. API auth blocks writes. One migration, one context, one route. Full multi-user pack access deferred to `TODO-sharing.md`.

### 5. Vet Export
Formatted reports for vet visits. Depends on having enough data/features in place. Moderate effort — mostly formatting/layout.

### 6. AI Poop Photo Analysis
See `TODO-ai-poop-analysis.md`. Lowest priority, highest effort. Photo capture, dataset collection, model training (3,500+ labeled images), ONNX inference integration.

### 7. General Vet/Health Timeline + Document Uploads
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
