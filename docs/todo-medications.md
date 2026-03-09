# Medications Feature

> Check git log to see what's been done. Continue from where you left off.

Research completed 2026-03-06 via 6 parallel agents + 4 audit agents. Scoped to medications that impact GI or allergies (the app's core tracking loop). Users can still log other medications via free-text.

## Definition of Done
- [ ] `medication_products` table exists with 52 seeded medications across 5 categories
- [ ] `medications` table has `medication_product_id` FK + `interval` column, no `reason` column
- [ ] All medication code removed from routine editor, daily check-in, active plan card, food page, and correlation engine
- [ ] Navigation updated: mobile "More" popover (Meds + Settings), desktop flat "Meds" link
- [ ] `/dogs/[id]/meds` page shows active meds (no end date) and past meds (has end date, reverse chronological)
- [ ] Add/edit medication form: searchable catalog picker + free-text fallback, dosage, interval dropdown (pre-filled from catalog defaults), start/end dates, notes
- [ ] Medication API routes updated for new schema (no `reason`, added `medication_product_id` + `interval`)
- [ ] `seed_medications.py` upserts catalog from `medications.json`, called by `build.py`
- [ ] `yarn build` succeeds with no errors
- [ ] All existing tests pass (correlation tests updated to remove medication references)
- [ ] Refer to `docs/mydoglog-branding.md` before any UI work

---

## Schema

### `medication_products` table (catalog, seed data)
| Field | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| name | text | Brand name |
| generic_name | text | Active ingredient(s) |
| manufacturer | text nullable | |
| category | medication_category enum | |
| drug_class | text nullable | e.g. "isoxazoline", "NSAID" |
| dosage_form | dosage_form enum | |
| default_intervals | dosing_interval[] | Array of dosing_interval enum values (typed) |
| description | text nullable | Standalone, no cross-references |
| created_at | timestamp | |

### `medication_category` enum
allergy, parasite, gi, pain, steroid

### `dosage_form` enum
tablet, chewable, capsule, liquid, injection, topical, spray, powder, gel, collar

### `dosing_interval` enum
four_times_daily, three_times_daily, twice_daily, daily, every_other_day, weekly, biweekly, monthly, every_6_weeks, every_8_weeks, every_3_months, every_6_months, every_8_months, annually, as_needed

### Modify `medications` table (user log)
- Add `medication_product_id` (optional FK -> medication_products.id)
- Add `interval` (dosing_interval enum, nullable)
- Remove `reason` column — category from `medication_products` replaces it for catalog meds; free-text meds use `notes` for context
- **Migration: nuke all existing medication records** — will be re-added manually via new Meds page

**`medications` table `name` column:** Kept for both catalog and free-text meds. Catalog meds copy name from `medication_products` at creation time (denormalized — no joins for display, catalog names won't change). Free-text meds: user types name directly. `medication_product_id` is null for free-text, populated for catalog.

Note: `digestive_impact` and `itchiness_impact` were proposed but never added to the schema — no columns to drop.

---

## Medication Catalog (52 total)

### Allergy (6)

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Zenrelia | ilunocitinib | Elanco | tablet | daily | JAK1/JAK2/TYK2 inhibitor for canine atopic dermatitis. #1 reported side effect is GI (diarrhea, vomiting). Immunosuppressive. |
| Apoquel | oclacitinib | Zoetis | tablet | twice_daily, daily | JAK1 inhibitor for canine atopic dermatitis. Typically twice daily for 14 days then once daily maintenance. |
| Cytopoint | lokivetmab | Zoetis | injection | monthly, every_6_weeks, every_8_weeks | Anti-IL-31 monoclonal antibody injection administered at vet clinic. Blocks itch signal only, not broader inflammation. GI safety comparable to placebo. |
| Atopica | cyclosporine | Elanco | capsule | daily | Immunosuppressant (calcineurin inhibitor) for canine atopic dermatitis. Slower onset (4-6 weeks). GI side effects (vomiting, diarrhea) are common. Give 1hr before or 2hr after meals. |
| Cortavance | hydrocortisone aceponate | Virbac | spray | daily | Topical corticosteroid spray for inflammatory and pruritic skin conditions. Short-course (7 consecutive days). Minimal systemic absorption. For localized flares/hot spots. |
| Genesis Spray | triamcinolone acetonide | Virbac | spray | daily | Topical corticosteroid spray for pruritus associated with allergic dermatitis. FDA-approved veterinary product. Different active ingredient than Cortavance. |

### Parasite Prevention (21)

#### Oral flea/tick

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Simparica Trio | sarolaner/moxidectin/pyrantel | Zoetis | chewable | monthly | Flea, tick, heartworm, roundworm, and hookworm prevention. |
| Simparica | sarolaner | Zoetis | chewable | monthly | Flea and tick prevention. |
| NexGard | afoxolaner | Boehringer Ingelheim | chewable | monthly | Flea and tick prevention. |
| NexGard PLUS | afoxolaner/moxidectin/pyrantel | Boehringer Ingelheim | chewable | monthly | Flea, tick, heartworm, roundworm, and hookworm prevention. FDA approved 2023. |
| NexGard Spectra | afoxolaner/milbemycin oxime | Boehringer Ingelheim | chewable | monthly | Flea, tick, heartworm, roundworm, hookworm, and whipworm prevention. |
| Bravecto | fluralaner | Merck | chewable | every_3_months | Flea and tick prevention with 12-week dosing interval. Also available as topical. |
| Credelio | lotilaner | Elanco | chewable | monthly | Flea and tick prevention. |
| Credelio Plus | lotilaner/milbemycin oxime | Elanco | chewable | monthly | Flea, tick, heartworm, and roundworm prevention. Also treats demodicosis. |
| Credelio Quattro | lotilaner/moxidectin/praziquantel/pyrantel | Elanco | chewable | monthly | Flea, tick, heartworm, roundworm, hookworm, and tapeworm prevention. The only isoxazoline combo that covers tapeworms. FDA approved October 2024. |

#### Topical flea/tick

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Revolution | selamectin | Zoetis | topical | monthly | Flea, heartworm, ear mite, and sarcoptic mange prevention. Also treats roundworms. |
| Advantage Multi | imidacloprid/moxidectin | Elanco | topical | monthly | Flea, heartworm, roundworm, hookworm, whipworm, and lungworm prevention. |
| K9 Advantix II | imidacloprid/permethrin/pyriproxyfen | Elanco | topical | monthly | Flea, tick, mosquito, biting fly, and lice treatment. Repels and kills on contact. TOXIC TO CATS. |
| Frontline Plus | fipronil/(S)-methoprene | Boehringer Ingelheim | topical | monthly | Flea and tick treatment. Older product, now somewhat superseded by isoxazolines. |

#### Collar

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Seresto | imidacloprid/flumethrin | Elanco | collar | every_8_months | Flea and tick prevention collar providing up to 8 months of protection. One of the most widely used flea/tick products by volume. Regulated by EPA (pesticide), not FDA. |

#### Heartworm-focused

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Heartgard Plus | ivermectin/pyrantel | Boehringer Ingelheim | chewable | monthly | Heartworm, roundworm, and hookworm prevention. |
| Interceptor Plus | milbemycin oxime/praziquantel | Elanco | chewable | monthly | Heartworm, roundworm, hookworm, whipworm, and tapeworm prevention. |
| ProHeart 6 | moxidectin (sustained-release) | Zoetis | injection | every_6_months | Injectable heartworm preventative providing 6 months of protection. Also treats hookworms. Administered by veterinarian. |
| ProHeart 12 | moxidectin (sustained-release) | Zoetis | injection | annually | Injectable heartworm preventative providing 12 months of protection. Also treats hookworms. FDA approved 2019. US only (not available in Canada). Administered by veterinarian. |

#### Injectable flea/tick

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Bravecto Quantum | fluralaner (extended-release) | Merck | injection | annually | First annual flea and tick injectable for dogs. Single subcutaneous dose provides 12 months of protection. Approved in Canada 2025. Administered by veterinarian. |

#### Dewormers

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Drontal Plus | praziquantel/pyrantel/febantel | Elanco | tablet | as_needed | Broad-spectrum dewormer for tapeworms (including Echinococcus), hookworms, roundworms, and whipworms. Treatment-focused, not a monthly preventative. |
| Panacur | fenbendazole | Merck | powder | daily | Broad-spectrum dewormer for roundworms, hookworms, whipworms, and Taenia tapeworms. Given over 3-5 consecutive days. Also used off-label for Giardia. |

### GI (15)

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Metronidazole | metronidazole | generic | tablet | twice_daily | Antibiotic and antiprotozoal for GI infections, Giardia, and inflammatory bowel disease. Also known as Flagyl. Very bitter taste; do not crush. |
| Cerenia | maropitant citrate | Zoetis | tablet | daily | Anti-nausea and anti-vomiting medication. The only veterinary-approved antiemetic for dogs. Also available as injection at vet clinic. |
| Metoclopramide | metoclopramide | generic | tablet | twice_daily, three_times_daily | Prokinetic and antiemetic that stimulates gastric motility and prevents esophageal reflux. One of the most commonly prescribed canine GI medications. Also known as Reglan. |
| Famotidine | famotidine | generic | tablet | daily, twice_daily | H2-receptor antagonist acid reducer for gastritis and acid reflux. Available over-the-counter (Pepcid). Best given on empty stomach before meals. |
| Omeprazole | omeprazole | generic | capsule | daily | Proton pump inhibitor for ulcers and severe acid reflux. Available over-the-counter (Prilosec). Do not crush capsules. |
| Sucralfate | sucralfate | generic | tablet | twice_daily, three_times_daily, four_times_daily | Coats and protects stomach and intestinal lining. Give on empty stomach, separated from other meds by 2 hours. Also known as Sulcrate/Carafate. Also available as liquid suspension. |
| Misoprostol | misoprostol | generic | tablet | twice_daily, three_times_daily, four_times_daily | Prostaglandin E1 analog gastroprotectant used to prevent NSAID-induced gastric ulceration. Commonly co-prescribed with long-term NSAID therapy. Also known as Cytotec. |
| Budesonide | budesonide | generic | capsule | daily | Locally-acting corticosteroid for inflammatory bowel disease. High first-pass hepatic metabolism means fewer systemic side effects. Do not open or crush capsules. |
| Azathioprine | azathioprine | generic | tablet | daily, every_other_day | Immunosuppressive for inflammatory bowel disease when steroids alone are insufficient. Standard second-line IBD therapy. Also known as Imuran. Requires regular blood monitoring. |
| Tylosin | tylosin tartrate | Elanco | powder | daily, twice_daily | Macrolide antibiotic for chronic diarrhea and antibiotic-responsive enteropathy. Extremely bitter; often placed in gelatin capsules for dosing. Also known as Tylan. Labeled for livestock; canine use is off-label. |
| Ondansetron | ondansetron | generic | tablet | twice_daily, three_times_daily | 5-HT3 serotonin receptor antagonist antiemetic for severe nausea and vomiting. Also known as Zofran. Use caution in MDR1-positive breeds (collies, sheepdogs). |
| Sulfasalazine | sulfasalazine | generic | tablet | twice_daily, three_times_daily | Anti-inflammatory for large bowel disease (colitis) and vasculitis. Also known as Salazopyrin. Requires tear testing (Schirmer test) due to risk of dry eye. Give with food. |
| Mesalamine | mesalamine | generic | tablet | twice_daily | 5-ASA anti-inflammatory for colitis. Same active component as sulfasalazine but without the sulfonamide carrier, eliminating the risk of dry eye (KCS). Also known as Asacol/Pentasa. |
| Loperamide | loperamide | generic | tablet | twice_daily, three_times_daily | Antidiarrheal that slows intestinal motility. Available over-the-counter (Imodium). CONTRAINDICATED in dogs with MDR1/ABCB1 gene mutation (collies, Aussies, shelties) — can cause severe neurological toxicity. |
| Pancrelipase | pancrelipase | various | powder | twice_daily | Pancreatic enzyme replacement (lipase, amylase, protease) for exocrine pancreatic insufficiency (EPI). Mixed directly into food with every meal. Also known as Viokase/Pancrezyme. |

### Pain / NSAID (9)

All NSAIDs have GI side effects (vomiting, diarrhea, ulceration) as their primary safety concern — directly impacts the app's poop tracking.

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Metacam | meloxicam | Boehringer Ingelheim | liquid | daily | Oxicam-class NSAID oral suspension for pain and inflammation from osteoarthritis and musculoskeletal disorders. Comes with calibrated dosing syringe. |
| Rimadyl | carprofen | Zoetis | chewable | daily, twice_daily | Propionic acid-class NSAID for pain and inflammation from osteoarthritis and post-surgical recovery. Available as chewable tablets and caplets. |
| Previcox | firocoxib | Boehringer Ingelheim | chewable | daily | Selective COX-2 inhibitor NSAID for osteoarthritis pain and postoperative pain from soft tissue and orthopedic surgery. |
| Deramaxx | deracoxib | Elanco | chewable | daily | COX-2 selective NSAID for osteoarthritis, orthopedic surgery, and dental surgery pain. Flexible dosing — lower for chronic OA, higher for short-term post-surgical. |
| Onsior | robenacoxib | Elanco | tablet | daily | Highly selective COX-2 inhibitor NSAID that concentrates at inflammation sites. For OA pain (unlimited duration) and post-op soft tissue surgery pain (max 3 days). |
| Galliprant | grapiprant | Elanco | tablet | daily | EP4 prostaglandin receptor antagonist for osteoarthritis pain and inflammation. Does not inhibit COX enzymes. Targeted mechanism may offer different safety profile than traditional NSAIDs. |
| Librela | bedinvetmab | Zoetis | injection | monthly | Anti-NGF monoclonal antibody injection for osteoarthritis pain. Administered at vet clinic. FDA approved May 2023. GI side effects (vomiting, diarrhea) reported in adverse event data. |
| Gabapentin | gabapentin | generic | capsule | twice_daily, three_times_daily, four_times_daily | Anticonvulsant used off-label for chronic and neuropathic pain. Often used as adjunct alongside NSAIDs for multimodal pain management. Also commonly used for anxiety. |
| Tramadol | tramadol | generic | tablet | twice_daily, three_times_daily, four_times_daily | Synthetic opioid for moderate to moderately severe pain. Used as part of multimodal pain management. Controlled substance. |

### Steroid (1)

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Prednisone | prednisone | generic | tablet | daily, twice_daily, every_other_day | Broad corticosteroid and immunosuppressant. Used across many conditions: allergies, IBD, immune-mediated disease. Taper required when discontinuing. Significant side effects with long-term use (increased thirst, appetite, urination). |

### Catalog Summary

| Category | Count | Why included |
|---|---|---|
| Allergy | 6 | Direct — controls itching, major GI side effects |
| Parasite | 21 | Routine monthly meds, some cause GI upset |
| GI | 15 | Direct — treats digestive issues |
| Pain/NSAID | 9 | GI side effects are #1 safety concern with NSAIDs |
| Steroid | 1 | Used for both allergies and GI (IBD) |

**Not in catalog (use free-text):** anxiety, cardiac, thyroid, seizure, antibiotic, urinary, and any other medications. The Meds page free-text fallback covers these. Free-text meds only require name + dosage + interval + dates (no category/drug class/dosage form) — keeps it low friction. Tradeoff: free-text meds won't trigger correlation caveats on scorecards.

**Catalog maintenance:** Hand-maintained JSON, not scraped. No single scrapeable veterinary drug database exists. New drug approvals in relevant categories happen ~2-3/year — manual `medications.json` updates are sufficient.

**New dosage_form value:** `collar` added for Seresto.

---

## Navigation Changes

**Mobile bottom nav** stays at 5 items: **Home, Food, [Log], Insights, More**

The current Settings nav item becomes **More** — a popover with two options:
- **Meds**
- **Settings**
- Future items (LLM export, sharing, etc.) can be added to the popover later

**Desktop top nav** has room for everything flat: Home, Food, Insights, Meds, Settings.

---

## Meds Page (`/dogs/[id]/meds`)

Dedicated page for medication management. Medications are **completely removed** from the routine editor and daily check-in.

### Layout
- **Active meds** at top — card list of medications with no `endDate` (ongoing)
- **Past meds** below — card list of medications with `endDate`, reverse chronological
- **Add medication** button

### Medication Card
Same visual pattern as food cards (no picture/stats). Shows:
- Medication name (from catalog or free-text)
- Dosage (e.g. "4.25mg")
- Interval (e.g. "Daily")
- Start date
- End date (past meds only)
- Tap to edit

### Add/Edit Medication
- **Medication picker**: searchable from catalog (52 meds) + free-text fallback for unlisted meds
- **Dosage**: free text (e.g. "4.25mg", "1 tablet")
- **Interval**: dropdown from `dosing_interval` enum (pre-filled from catalog `default_intervals` if picking from catalog)
- **Start date**: date picker (defaults to today)
- **End date**: optional date picker (null = ongoing)
- **Notes**: optional free text
- **Remove**: sets end date to today (or a picked date) — soft delete, preserves history
- No reason field — catalog meds derive context from `medication_products.category`, free-text meds use notes
- No impact assessment — users see the effect in their stool/itch data directly

### History View
Simple chronological list (like the home page log feed but only meds). Each past med card shows the date range it was active. No timeline visualization initially — just the card list sorted by end date descending.

---

## Correlation Engine — Report Only (No Score Adjustments)

Medications are the #1 confounding variable in food → poop/itch correlation, but actually adjusting scores is impractical: meds that *treat* GI issues vs meds that *cause* GI side effects require opposite adjustments, many dogs are on long-term meds so excluding those days loses most data, and there's no calibration data for weighting. Instead, **report medication context alongside scores** so users can interpret it themselves.

The structured `category` field tells us what each medication impacts:

| Category | Confounds |
|---|---|
| gi | poop scores |
| pain (NSAIDs) | poop scores (GI side effects) |
| allergy | itch scores |
| steroid | both poop and itch |
| parasite | poop scores (some cause GI upset) |

**Decision: No calculation changes.** Remove `onDigestiveMedication` / `onItchnessMedication` flags from the correlation engine entirely — they were premature infrastructure that nothing uses. Remove `excludeMedicationPeriods` option too. The engine stops fetching/processing medications. If Phase 5 scorecard caveats are built later, they'll query medications + catalog directly rather than pre-computing per-day flags.

### Reporting enhancements (display-only, future):
- [ ] On scorecard: show caveat badge when a medication started/stopped during the feeding period (e.g. "GI medication changed" on poop scores, "Allergy medication changed" on itch scores) — uses `medication_products.category` to pick the right caveat
- [ ] Surface medication timeline alongside poop/itch score charts so users can visually spot medication-driven changes

### Deferred (revisit if needed):
- Optionally exclude medication-change periods from correlation calculations
- Weight/discount scores during medication periods

---

## Approach

Four sequential phases. Phase 1 is schema + seed data (backend only). Phase 2 surgically removes medications from all existing UI/engine code. Phase 3 adds navigation. Phase 4 builds the new Meds page UI. Each phase should `yarn build` cleanly before moving to the next.

### Technologies & APIs
- Drizzle ORM (schema, enums, migrations)
- PostgreSQL (via Docker container `mydoglog-db-dev`, port 5433)
- psycopg2-binary (Python seed script, raw SQL upserts)
- shadcn/ui (Card, Button, Input, Select, Popover, Command for searchable picker)
- Line Awesome icons via `react-icons/lia` (LiaPillsSolid or similar)
- ResponsiveModal pattern (Drawer on mobile, Dialog on desktop)

### Key Areas

**Phase 1 files:**
- `scraper/data/medications.json` — **new** seed data file (52 medications)
- `scraper/seed_medications.py` — **new** seed script
- `scraper/build.py` — add call to `seed_medications.py`
- `src/lib/db/schema.ts` — new enums + `medicationProducts` table + modify `medications` table

**Phase 2 files (removals):**
- `src/components/routine-editor.tsx` — remove medication section
- `src/components/daily-checkin.tsx` — remove medication display
- `src/components/active-plan-card.tsx` — remove medications prop
- `src/components/medication-item.tsx` — remove reason badge
- `src/app/(app)/dogs/[id]/food/page.tsx` — remove medication fetch/state
- `src/app/api/dogs/[id]/food/routine/route.ts` — remove medications from response
- `src/lib/labels.ts` — remove `MEDICATION_REASON_LABELS`
- `src/lib/types.ts` — update `MedicationSummary`, remove `medications` from `RoutineData`
- `src/lib/routine.ts` — remove `getActiveMedicationsForDog()`
- `src/lib/correlation/types.ts` — remove medication flags/interfaces
- `src/lib/correlation/engine.ts` — remove medication logic
- `src/lib/correlation/query.ts` — remove medication query
- `src/lib/correlation/engine.test.ts` — remove medication tests
- `src/app/api/dogs/[id]/medications/route.ts` — update for new schema
- `src/app/api/medications/[id]/route.ts` — update for new schema

**Phase 3 files (navigation):**
- `src/app/(app)/nav-links.tsx` — Settings → More popover (mobile), add Meds (desktop)
- `src/app/(app)/dogs/[id]/meds/page.tsx` — **new** page route

**Phase 4 files (UI):**
- `src/components/medication-picker.tsx` — **new** searchable catalog + free-text
- `src/components/medication-form.tsx` — **new** add/edit form in ResponsiveModal
- `src/components/medication-card.tsx` — **new** display card
- `src/app/(app)/dogs/[id]/meds/page.tsx` — full page implementation
- `src/app/api/medication-products/route.ts` — **new** GET endpoint for catalog search

---

## Build Steps

### Phase 1: Schema + Seed Data

1. Create `scraper/data/medications.json` with all 52 medications from the catalog tables above. Structure each entry with: `name`, `generic_name`, `manufacturer`, `category`, `drug_class`, `dosage_form`, `default_intervals` (array), `description`.
   **Verify**: JSON is valid, has 52 entries, counts match (6 allergy, 21 parasite, 15 GI, 9 pain, 1 steroid).

2. Add three new enums to `schema.ts`: `medicationCategoryEnum` (allergy, parasite, gi, pain, steroid), `dosageFormEnum` (tablet, chewable, capsule, liquid, injection, topical, spray, powder, gel, collar), `dosingIntervalEnum` (15 values from spec).
   **Verify**: Enums defined, no TypeScript errors.

3. Add `medicationProducts` table to `schema.ts` with fields matching spec: `id` (text PK), `name`, `genericName`, `manufacturer` (nullable), `category` (enum), `drugClass` (nullable), `dosageForm` (enum), `defaultIntervals` (array of enum), `description` (nullable), `createdAt`.
   **Verify**: Table definition compiles.

4. Modify `medications` table in `schema.ts`: add `medicationProductId` (optional FK → medicationProducts.id), add `interval` (dosingIntervalEnum, nullable). Remove `reason` column and `medicationReasonEnum`.
   **Verify**: Schema compiles, no references to `reason` or `medicationReasonEnum` remain in schema.

5. Run `yarn db:generate` to create migration. Manually edit migration SQL to: (a) add the three new enums, (b) create `medication_products` table, (c) `DELETE FROM medications` to nuke existing records, (d) alter `medications` table (add columns, drop `reason` column + enum). Run migration locally.
   **Verify**: `docker exec mydoglog-db-dev psql -U mydoglog -d mydoglog -c "\d medication_products"` shows correct columns. `SELECT count(*) FROM medications` returns 0.

6. Create `scraper/seed_medications.py`: reads `medications.json`, connects to PostgreSQL (same connection pattern as `build.py` — localhost:5433, user mydoglog), upserts each medication into `medication_products` using `ON CONFLICT (name) DO UPDATE` (match on name since these are hand-maintained). Generate UUIDs with `uuid.uuid4()`.
   **Verify**: `uv run python seed_medications.py` succeeds. `SELECT count(*) FROM medication_products` returns 52.

7. Add call to `seed_medications.py` at the end of `build.py` (import and call the seed function, or subprocess call).
   **Verify**: `cd scraper && uv run python build.py` completes without error, medication_products still has 52 rows.

8. `yarn build` succeeds (will likely fail until Phase 2 removes `reason` references — that's expected, just note it).

### Phase 2: Remove Meds from Existing UI

1. **Schema cleanup**: Remove `medicationReasonEnum` from `schema.ts` (already done in Phase 1 step 4, but verify no lingering references).
   **Verify**: `grep -r "medicationReason" src/` returns nothing.

2. **Types**: In `types.ts`, update `MedicationSummary` — remove `reason`, add `medicationProductId: string | null` and `interval: string | null`. Remove `medications` field from `RoutineData`.
   **Verify**: TypeScript compiles for types.ts.

3. **Labels**: Remove `MEDICATION_REASON_LABELS` from `labels.ts`.
   **Verify**: No imports of `MEDICATION_REASON_LABELS` remain.

4. **Routine helpers**: In `routine.ts`, remove `getActiveMedicationsForDog()` function entirely.
   **Verify**: No imports of `getActiveMedicationsForDog` remain.

5. **Routine API**: In `food/routine/route.ts`, remove the medications fetch. Return only `{ plan }` (no `medications` key).
   **Verify**: Route compiles.

6. **Components — routine-editor.tsx**: Remove all medication state (`medications`, `editingMedication`, etc.), medication handlers (`saveMedications`, medication form fields), and medication render sections. Keep only food plan editing.
   **Verify**: Component compiles, no medication imports remain.

7. **Components — daily-checkin.tsx**: Remove medication display from routine accordion, remove `MedicationItem` import.
   **Verify**: Component compiles.

8. **Components — active-plan-card.tsx**: Remove `medications` prop and medication display section.
   **Verify**: Component compiles.

9. **Components — medication-item.tsx**: Remove reason badge display and `MEDICATION_REASON_LABELS` import. Keep pill icon and basic name/dosage display (will be reused in Phase 4).
   **Verify**: Component compiles.

10. **Food page**: In `food/page.tsx`, remove `activeMedications` state, remove medication fetch logic, stop passing meds to `ActivePlanCard`.
    **Verify**: Page compiles.

11. **Correlation engine — types.ts**: Remove `onItchinessMedication` and `onDigestiveMedication` from `DayOutcome`. Remove `excludeMedicationPeriods` from options. Remove `RawMedication` interface. Remove `medications` from `CorrelationInput`.
    **Verify**: Types compile.

12. **Correlation engine — engine.ts**: Remove medication flag computation, medication period exclusion logic, and medication flags from backfill outcome construction.
    **Verify**: Engine compiles.

13. **Correlation engine — query.ts**: Remove medication fetch query and `medications` import from schema.
    **Verify**: Query module compiles.

14. **Correlation engine — engine.test.ts**: Remove medication-specific tests, remove `medications: []` from test fixtures, remove medication flags from `emptyOutcome` and other test helpers.
    **Verify**: `yarn test` passes.

15. **API routes**: Update `api/dogs/[id]/medications/route.ts` and `api/medications/[id]/route.ts` — remove `reason` field handling, add `medicationProductId` and `interval` to POST/PATCH handlers.
    **Verify**: API routes compile.

16. `yarn build` succeeds. `yarn test` passes.
    **Verify**: Clean build output, all tests green.

### Phase 3: Navigation

1. Read `docs/mydoglog-branding.md` for design system reference before any UI work.

2. **Mobile nav**: In `nav-links.tsx`, change the Settings nav item to "More". Replace its direct link with a Popover containing two items: "Meds" (links to `/dogs/[id]/meds`) and "Settings" (links to `/settings`). Use appropriate Line Awesome icons (pill for Meds, gear for Settings).
   **Verify**: Mobile nav renders "More" with working popover, both links navigate correctly.

3. **Desktop nav**: Add "Meds" as a flat link in the desktop top nav bar (between Insights and Settings). Links to `/dogs/[id]/meds`.
   **Verify**: Desktop nav shows Home, Food, Insights, Meds, Settings.

4. **Create page route**: Create `src/app/(app)/dogs/[id]/meds/page.tsx` as a minimal placeholder (page title + empty state).
   **Verify**: Navigating to `/dogs/[id]/meds` renders without error. `yarn build` succeeds.

### Phase 4: Meds Page UI

1. Read `docs/mydoglog-branding.md` again for component patterns and color tokens.

2. **Catalog API**: Create `src/app/api/medication-products/route.ts` — GET endpoint that returns all 52 medications from `medication_products` table, optionally filtered by search query param. Used by the medication picker.
   **Verify**: `curl` returns 52 medications. Search param filters correctly.

3. **Medication picker component**: Create `src/components/medication-picker.tsx` — searchable list using shadcn Command component. Shows catalog medications grouped or filtered by search. At the bottom, a "Use custom name" option that switches to free-text input. When a catalog med is selected, pre-fill `interval` from `default_intervals[0]`. Return selected medication product (or free-text name) to parent.
   **Verify**: Component renders, search filters catalog, free-text fallback works, selection returns correct data.

4. **Medication form component**: Create `src/components/medication-form.tsx` — add/edit form inside ResponsiveModal (Drawer on mobile, Dialog on desktop). Fields: medication picker (step 3), dosage (text input), interval (Select dropdown from `dosingIntervalEnum` values — pre-filled from catalog if applicable), start date (date picker, defaults to today), end date (optional date picker), notes (optional textarea). On save: POST to `/api/dogs/[id]/medications` (new) or PATCH to `/api/medications/[id]` (edit). On "Stop medication": PATCH with endDate = today.
   **Verify**: Form opens in drawer (mobile) / dialog (desktop). Can create catalog med, create free-text med, edit existing med, stop a med.

5. **Medication card component**: Create `src/components/medication-card.tsx` — displays a single medication. Shows: name, dosage, interval label, start date, end date (if past). Tap opens edit form. Same visual density as food cards (no picture/stats). Use pill icon from Line Awesome.
   **Verify**: Card renders correctly for both active (no end date) and past (with end date) medications.

6. **Meds page**: Implement `src/app/(app)/dogs/[id]/meds/page.tsx` fully. Fetches medications via GET `/api/dogs/[id]/medications`. Splits into active (endDate is null) and past (endDate is not null). Active meds at top as card list. Past meds below, sorted by endDate descending. "Add medication" button opens the form. Page title: "Medications".
   **Verify**: Page loads, shows active/past sections, add button works, cards are tappable for edit.

7. **Interval display labels**: Add human-readable labels for `dosingIntervalEnum` values to `labels.ts` (e.g., `twice_daily` → "Twice daily", `every_3_months` → "Every 3 months", `as_needed` → "As needed").
   **Verify**: Interval labels display correctly on medication cards and in the interval dropdown.

8. **Final build**: `yarn build` succeeds. Manual test: navigate to Meds page, add a catalog medication (e.g., "Zenrelia"), add a free-text medication, edit one, stop one, verify it moves to past section.
   **Verify**: Full CRUD flow works end-to-end. Build is clean.

### Phase 5: Scorecard Caveats (display-only, future)
- [ ] Detect med start/stop during feeding period in scorecard API
- [ ] Show caveat badges on scorecard UI using `medication_products.category`

---

## Risks & Considerations
- **Migration order matters**: The migration must create enums and `medication_products` table BEFORE altering `medications` (FK dependency). The `DELETE FROM medications` must happen BEFORE dropping the `reason` column.
- **Drizzle enum arrays**: `defaultIntervals` on `medication_products` is an array of enum values. Drizzle supports this via `dosingIntervalEnum().array()` — verify this generates correct SQL.
- **Phase 2 is destructive to existing UI**: Many components change simultaneously. Do Phase 2 in one pass and verify `yarn build` at the end, not piecemeal (intermediate states will have broken imports).
- **The `medications` table `name` column stays**: Both catalog and free-text meds store the display name directly. For catalog meds, copy from `medication_products.name` at creation time.
- **Popover navigation on mobile**: The "More" popover needs to work well on touch — test that it opens/closes correctly and doesn't interfere with the bottom nav bar positioning.

## If Blocked
- If Drizzle enum array type doesn't work: use `text().array()` instead and validate values at the application layer
- If migration fails: check enum creation order — enums must exist before tables that reference them
- If `seed_medications.py` can't connect: verify Docker container is running (`docker ps | grep mydoglog-db-dev`) and port 5433 is exposed
- If the popover nav feels wrong on mobile: fall back to a simple slide-up sheet or secondary page instead
- If tests fail after 3 attempts: document what's failing and stop
- If `yarn build` fails on type errors after Phase 2: likely a missed reference to removed types — grep for the specific type name and clean up

---
**Completion Signal**: When ALL "Definition of Done" items are checked and verified, output: RALPH_COMPLETE
