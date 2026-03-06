# MyDogLog — Implementation Phases

Living checklist. Update as work progresses.

---

## Phase 0: Data Prep ✅

- [x] Scraping — 1,260 products across 16 brands (see `dog-food-brands-canada.md`)
- [x] `manual_products.json` — 6 whole foods (chicken, rice, carrots, broccoli, banana, blueberries)
- [x] `ingredient_families.json` — AAFCO family/alias mappings (see `dog-food-ingredients.md`)

## Phase 1: Foundation + Data Loading ✅

- [x] Next.js scaffold (TypeScript, app router)
- [x] Drizzle schema + migrations (all tables — products, users, dogs, logs)
- [x] `build.py` — load brand JSONs + manual_products.json → PostgreSQL (ingredient parsing, normalization, upsert)
- [x] `validate.py` — diff loaded products against myvetstore ground truth (`docs/myvetstore-products.md`)
- [x] Better Auth (email/password, sessions in PostgreSQL)
- [x] Dog CRUD (API + UI)
- [x] Product search/browse API (read-only, filters by type/channel/brand)
- [x] Photo upload infrastructure

## Phase 2: Core Loop ✅

- [x] Responsive logging container (Drawer on mobile, Dialog on desktop — shared content component)
- [x] Product search/picker component (typeahead, used by routine editor + treat logger + food scorecard)
- [x] Routine template management (food + supplements + medications)
- [x] Daily Check-in form (Routine + Stool + Itchiness + Treats sections, pre-filled from routine template)
- [x] Quick Poop flow (3-second: score + save, auto-timestamp)
- [x] Quick Treat flow (3-second: product + save, auto-timestamp)
- [x] Bottom nav `+` button → entry selector (Daily Check-in / Poop / Treat)
- [x] Food Scorecard page (scored / needs scoring sections, backfill modal, log stats per period)
- [x] Dashboard (active routine summary, entry points, dog switcher)
- [ ] Pollen collection (cron endpoint, Ambee API — deferred, no urgency)

## Phase 3: Analysis

See implementation plans:
- **Part 1 — Data Collection + Analysis Engine:** `docs/plan-correlation-part1.md`
  - Correlation types, pure engine functions, DB query layer, tests
  - Zero UI changes — purely the computation layer
- **Part 2 — Displaying Correlation Data:** `docs/plan-correlation-part2.md`
  - Correlation API endpoint + results page (problem/tolerated/inconclusive)
  - Food scorecard improvements (ingredient tags, transition buffer, confidence badges)
  - Nav integration (Insights tab)
  - Minimal UI to verify engine output before investing in richer visualizations

## Phase 4: Extended Logging + Visualization

APIs for vomit/symptom/medication/exposure logging already exist. Remaining:

- [ ] Medication tracking UI — structured catalog (52 meds, see `todo-medications.md`), medication picker in routine editor, free-text fallback for unlisted meds
- [ ] Extend poop log with mucus/blood toggles (optional, high clinical signal — mucus = large bowel inflammation, blood = location indicator)
- [ ] Dashboard timeline — unified view combining:
  - **Time-series graph** (top): poop scores as dots (semantic colors), itch scores, temperature + pollen as background overlays
  - **Gantt-style bars** (bottom): food periods, medication periods, supplement periods as horizontal bars showing what was active when
  - Read together vertically — correlate score changes with food/med/environment transitions
- [ ] LLM export (structured text dump for Claude, "Export for LLM" button on correlations page)
- [ ] Extend correlation engine: medication on/off comparison (medication is the #1 confounding variable)

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
