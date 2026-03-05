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

- [ ] Vomiting log UI (type picker, time since meal)
- [ ] Symptom log UI (type, severity, photo)
- [ ] Accidental exposure log UI (description, ingredient picker + free text)
- [ ] Medication tracking UI (name, dosage, date range, reason tag)
- [ ] Food database browser (product cards, detail pages, type/channel/brand filters)
- [ ] Timeline chart (food bars + poop/itch dots + pollen overlay + medication bars + exposure markers)
- [ ] LLM export (structured text dump for Claude, "Export for LLM" button on correlations page)
- [ ] Extend correlation engine: accidental exposure exclusion zones, symptom correlation, medication on/off comparison
- [ ] Full dashboard (7-day mini-chart with all data types, medication badges)

## Future Considerations

Out of scope for initial build. See `mydoglog.md` for details.

- General vet/health timeline (vaccinations, vet visits, surgical history)
- Document uploads (PDFs for vet records, lab results)
- Weight history (track over time, currently just a single field)
- DogShare (invite caretakers with roles)
- iOS app (SwiftUI, same API)
- MCP server (Claude queries API routes directly)
- Vet export (formatted reports for vet visits)
- Custom food builder (raw diets, home-cooked, niche brands)
- URL-based product import (paste Chewy/PetSmart URL, auto-scrape)
- Barcode scanning (UPC lookup from phone camera)
- Transition wizard (auto-generate graduated plans)
- Meal-level logging (per-meal breakdown via meal_slot column)
- Medication database (structured DB instead of free-text)
- Reformulation tracking (snapshot ingredients on plan creation)
