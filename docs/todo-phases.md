# MyDogLog — Implementation Phases

Living checklist. Update as work progresses.

---

## Phases 0–3 ✅ (Complete)

- **Phase 0 — Data Prep:** 1,260 products scraped across 16 brands, manual whole foods, AAFCO ingredient family mappings
- **Phase 1 — Foundation:** Next.js + Drizzle + PostgreSQL, build.py product loader, Better Auth, dog CRUD, product search API
- **Phase 2 — Core Loop:** Daily check-in / quick poop / quick treat flows, routine templates, food scorecard, dashboard, responsive drawer/dialog pattern
- **Phase 3 — Analysis:** Correlation engine (ingredient-level, two-track skin/GI), correlation results page, food scorecard improvements, Insights tab

## Phase 4: Extended Logging + Visualization

- [ ] Pollen + weather collection — cron endpoint, daily high/low temp + pollen index stored per location
- [ ] Season tracking — define seasons by temperature transitions + regional calendar (e.g. spring = sustained temps above X after winter lows, snowmelt window, fall = first sustained drop). Seasons are a confounder label on the timeline, not just calendar quarters. Key transitions: winter→spring (snowmelt, mold spike, pollen start), spring→summer, summer→fall, fall→winter. Consider latitude-aware thresholds (St. Catharines ≠ Calgary)
- [ ] Medication tracking UI — structured catalog (52 meds, see `todo-medications.md`), medication picker in routine editor, free-text fallback for unlisted meds
- [ ] Extend poop log with mucus/blood toggles (optional, high clinical signal — mucus = large bowel inflammation, blood = location indicator)
- [ ] Dashboard timeline — unified view combining:
  - **Time-series graph** (top): poop scores as dots (semantic colors), itch scores, temperature + pollen as background overlays, season bands as background shading
  - **Gantt-style bars** (bottom): food periods, medication periods, supplement periods as horizontal bars showing what was active when
  - Read together vertically — correlate score changes with food/med/environment/season transitions
- [ ] LLM export (structured text dump for Claude, "Export for LLM" button on correlations page)
- [ ] Extend correlation engine: medication on/off comparison, season-aware itch discounting (medication is the #1 confounding variable, season is #2 for itch)

### Skipped (not worth the complexity)

- ~~Vomiting log UI~~ — rare for current dog, note in daily check-in if needed
- ~~Symptom log UI~~ — mucus/blood covered by poop log extension above
- ~~Accidental exposure log UI~~ — rare events, daily check-in notes suffice
- ~~Food database browser~~ — product picker with search already exists, standalone browse page is vanity
- ~~Full dashboard~~ — merged into dashboard timeline above

## Future Considerations

Out of scope for initial build. Roughly prioritized.

- MCP server (Claude queries API routes directly — low effort, high personal value)
- Weight history (track over time, currently just a single field)
- Vet export (formatted reports for vet visits — replaces manual `peaches.md` notes)
- Custom food builder (raw diets, home-cooked, niche brands)
- General vet/health timeline (vaccinations, vet visits, surgical history)
- Document uploads (PDFs for vet records, lab results)

### Skipped permanently

- ~~DogShare~~ — multi-user RBAC for a personal app
- ~~iOS app~~ — responsive web works fine
- ~~Barcode scanning~~ — DB has 1,260+ products, search works
- ~~URL-based product import~~ — scrapers already exist
- ~~Transition wizard~~ — users follow vet guidance
- ~~Meal-level logging~~ — daily granularity is sufficient
- ~~Reformulation tracking~~ — rare event, not worth schema complexity
- ~~Medication database~~ — moved to Phase 4 as medication tracking
