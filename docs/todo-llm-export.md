# TODO: LLM Export

> "Export for LLM" button on the dog settings page. Generates a structured markdown document with all the data we have about a dog, designed for pasting into Claude or another LLM to get advice on diet, allergies, and health.

## Goal

One-click copy of a comprehensive, well-organized text dump that gives an LLM full context about the dog. The user pastes it into a chat and can ask questions, get advice, brainstorm food trials, etc. We provide the facts — the user provides the questions.

### Design Principle

**Facts, not analysis.** We provide structured data — the LLM does the reasoning. No editorializing, no "this suggests X," no causal claims. Just: what happened, when, and what was happening at the same time. Use tables over narrative wherever possible (research shows ~40% better LLM reasoning performance over tabular data vs prose). Include intermediate computed stats (averages, counts, overlaps) as facts alongside raw data — but never interpret them.

## Output Format

Plain text markdown, copied to clipboard. No file download.

**Target audience is an LLM, not a human.** No prose introductions, no section explanations, no "here's what this means" annotations. Just headers, tables, and structured lists. Every token should be data or a label for data. Tables for time-series and multi-field data. Bulleted lists for variable-length reference data (ingredient lists, side effects).

### Sections

#### 0. Preamble
A short context block at the very top of the export (before scoring systems), something like:

> This is a structured data export from MyDogLog, a dog food and digestive health tracking app. It contains a dog's complete feeding history with ingredient lists, daily stool and itchiness logs, medications, environmental pollen/mold data, and ingredient-level correlation analysis.
>
> Dogs with food sensitivities or allergies are a multi-variable problem: food ingredients, environmental allergens (pollen, mold, dust mites), medications (which have their own GI/skin side effects), treats, and supplements all interact. Symptoms can be delayed (GI: up to 1-7 days, skin/itch: up to weeks or months), and food allergies and environmental allergies can present with similar symptoms — making them difficult to distinguish without data. This data exists to help untangle those variables.
>
> The owner is likely looking for help with: which foods or ingredients work best or worst for their dog's digestion and skin, whether itching/GI symptoms are food-related or environmental, whether medications are contributing to symptoms, and what to try next.
>
> All data below is factual — logged by the owner or computed from logs. No conclusions have been drawn. Backfill data (marked throughout) is lower confidence than manual daily logs.

Keep it brief. No instructions on how to respond — just what the data is and why someone would share it.

#### 1. Profile
- Name, breed, age (computed from birthDate), weight
- Location context if `environmentEnabled` (city, region — for pollen/allergy relevance)
- Export date (so the LLM knows how current this is)

#### 2. Current Diet
- Active feeding plan name (if set), start date
- Each product: brand, full name, type (food/supplement), quantity per meal, unit, meal slot(s)
- Daily calorie estimate if available
- Full ordered ingredient list per product (from `productIngredients`, position-ordered)
- Guaranteed analysis per product (protein %, fat %, fiber %, etc.)

#### 3. Supplements, Toppers & Treats
- Active plan items where product type is supplement/topper: name, quantity, duration
- Recent treats from treat logs: product name, frequency (e.g., "~3x/day over last 30 days")
- Ingredient lists for each (same as above)
- Quantity context: note that toppers/supplements are 25-30g/meal (vs primary food at 200g+/meal)

#### 4. Current Medications
- Active medications: name, dosage, interval, start date
- Drug class, description, known side effects (from medication catalog)
- Duration on current medication

#### 5. Food History (oldest → newest)
Table format, one row per feeding period:

```
| # | Food                          | Qty        | Dates              | Days | Avg Poop | Avg Itch | Logged/Backfill | Avg Pollen | High Pollen Days | Active Meds          |
|---|-------------------------------|------------|---------------------|------|----------|----------|-----------------|------------|------------------|----------------------|
| 1 | Pro Plan Puppy Chicken & Rice | 1.75 can   | Oct 2023 – Jun 2024 | 240  | 3.0      | 0.5      | 0/240           | —          | —                | none                 |
| 6 | HA Hydrolyzed Chicken Canned  | 1.5 can    | Sep 2025 – Mar 2026 | 184  | 3.2      | 0.8      | 0/184           | 1.4        | 12%              | Zenrelia 4.25mg      |
```

- Logged/Backfill: "0/240" means 0 days of manual logs, 240 days of backfill estimates
- Avg Poop/Itch for backfill periods: midpoint of scorecard range (e.g., scorecard {3,4} → 3.5)

Below the table, for each period:
- Full ingredient list per product (ordered by position)
- Guaranteed analysis per product
- Transition info if applicable ("5-day transition from period #4")
- Treats given during this period (from treat log date overlap, with counts)

#### 6. Medication History
Table format:

```
| Medication    | Dosage | Interval | Dates              | Days | Category | Food Period(s) |
|---------------|--------|----------|--------------------|------|----------|----------------|
| Zenrelia      | 8.5mg  | daily    | Sep 8 – Oct 2025   | ~45  | allergy  | #6             |
| Zenrelia      | 4.25mg | daily    | Oct 2025 – Mar 9   | ~140 | allergy  | #6             |
```

Below the table, for each medication:
- Known side effects (from medication catalog)

#### 7. Daily Log Table (last 60 days)
A dense date-indexed table the LLM can scan for patterns. One row per day:

```
| Date       | Poop | Itch | Pollen | Food              | Meds           | Notes    |
|------------|------|------|--------|-------------------|----------------|----------|
| 2026-03-06 | 6    | 2    | 3      | HA Hydrolyzed     | Zenrelia 4.25mg| mucus    |
| 2026-03-05 | 4    | 1.5  | 2      | HA Hydrolyzed     | Zenrelia 4.25mg|          |
```

- Poop: average of all poop logs that day (or scorecard fallback). Individual entries shown as "4,5,3" if multiple.
- Itch: average of itch logs that day. Body areas included if logged.
- Pollen: effective pollen level (3-day rolling max of max(pollen, spore)). Null if no data.
- Food: short name of active food(s)
- Meds: active medication(s) with dosage
- Notes: from poop/itch log notes field, food transition markers ("T:day3")
- Rows marked `[transition]` during food switch buffer days
- 60 days balances data volume against context window size

#### 8. Ingredient Correlation Data
Two tables: **GI Track** and **Skin/Itch Track** (computed separately by the correlation engine).

Header stats: scoreable days, logged days, backfilled days.

```
| Ingredient        | Weighted Score | Raw Avg | Days | Good | Bad | Confidence | Position  | Products | Cross-Reactivity | Seasonally Confounded |
|-------------------|----------------|---------|------|------|-----|------------|-----------|----------|------------------|-----------------------|
| chicken           | 3.8            | 3.2     | 180  | 95   | 22  | high       | primary   | 3        | poultry          | yes                   |
| salmon            | 5.9            | 6.1     | 7    | 0    | 7   | low        | primary   | 1        | fish             | no                    |
```

- GI track includes form breakdown rows when forms differ (e.g., "corn" / "corn (fat)" / "corn (oil)" as separate rows)
- Seasonally confounded column only on itch track (>60% of bad days overlapped high pollen)

#### 9. Symptom Averages by Pollen Level (if environmentEnabled)

```
| Pollen Level | Days | Avg Poop | Avg Itch |
|--------------|------|----------|----------|
| 0-1 (low)    | 120  | 3.1      | 0.4      |
| 2 (moderate) | 30   | 3.5      | 1.2      |
| 3-4 (high)   | 18   | 4.0      | 2.1      |
```

Additional stats:
- Days with pollen data / total days in tracking window
- Pollen data source: provider name, nearest station, distance

#### 10. Links for Further Research
Static references (always included):
- [Common food allergen sources in dogs and cats](https://link.springer.com/article/10.1186/s12917-016-0633-8) — Mueller, Olivry & Prélaud 2016. Prevalence of specific allergens in confirmed food allergy cases.
- [Adverse food reactions in dogs and atopic dermatitis](https://academy.royalcanin.com/en/veterinary/adverse-skin-reactions-to-food) — Royal Canin Academy. Prevalence of food-induced vs environmental atopic dermatitis.
- [Atopic dermatitis and intestinal epithelial damage in dogs](https://pmc.ncbi.nlm.nih.gov/articles/PMC11034634/) — Ekici & Ok 2024. Relationship between environmental allergies and GI symptoms.
- [Cross-reactivity among food allergens for dogs](https://pubmed.ncbi.nlm.nih.gov/36043337/) — Olivry, O'Malley & Chruszcz 2022. Cross-reactivity risk between food protein sources.
- [AAHA Management of Allergic Skin Diseases in Dogs and Cats](https://www.aaha.org/wp-content/uploads/globalassets/02-guidelines/2023-aaha-management-of-allergic-skin-diseases-in-dogs-and-cats-guidelines/resources/2023-aaha-management-of-allergic-skin-diseases-guidelines.pdf) — 2023 clinical guidelines for diagnosis and treatment.

Dynamic references (per dog):
- **Medication side effect sources**: pulled from `medication_products.side_effects_sources` for each active/past medication. These are FDA FOI documents, DailyMed labels, and PubMed studies specific to each drug.

#### 11. Cross-Reactivity Groups
Dogs allergic to one protein may react to related proteins in the same biological group. Pull full table from `ingredientCrossReactivity` (currently 8 rows).

#### 12. Computed Reference Stats
Factual aggregates:
- Ingredients present in ALL foods tried (constant across all periods)
- Ingredients unique to each food period (appeared in only one)
- Avg poop log entries per day (from days with ≥1 entry)
- Dates where itch score changed >1 point sustained 3+ days, with concurrent food period noted
- Dates within 7 days of a medication start/stop/dose change, with symptom scores

#### 13. Scoring Systems & Data Coverage

This section goes FIRST in the actual export output (before Profile), so the LLM has context for all numbers that follow.

### Data Sources
- **Logs**: Manually entered by owner in real-time. High confidence.
- **Backfill**: Rough approximations entered retroactively when owner recalled past feeding periods. Scorecard ranges (e.g., poop "3-4") rather than daily values. Low confidence — use for general patterns only, not precise analysis.

### Poop (Purina Fecal Score 1-7, goal: 2)
Descriptions from `fecal-score-guide.tsx` SCORES array — copy verbatim at build time:
- 1: Hard pellets — "Very hard and dry; requires much effort to expel from body; no residue left on ground when picked up. Often expelled as individual pellets."
- 2: Ideal — "Firm, but not hard; should be pliable; segmented appearance; little or no residue left on ground when picked up." **(goal)**
- 3: Soft — "Log-like; little or no segmentation visible; moist surface; leaves residue, but holds form when picked up."
- 4: Soggy — "Very moist (soggy); distinct log shape visible; leaves residue and loses form when picked up."
- 5: Soft piles — "Very moist but has distinct shape; present in piles rather than as distinct logs; leaves residue and loses form when picked up."
- 6: No shape — "Has texture, but no defined shape; occurs as piles or as spots; leaves residue when picked up."
- 7: Liquid — "Watery, no texture, flat; occurs as puddles."

### Itch (0-5, goal: 0)
Descriptions from `itchiness-logger.tsx` ITCH_SCORES array — copy verbatim at build time:
- 0: None — "Normal grooming only, no signs of itchiness" **(goal)**
- 1: Very mild — "Occasional episodes, slightly more than normal"
- 2: Mild — "Slightly increased, stops when distracted"
- 3: Moderate — "Regular episodes, stops when eating or playing"
- 4: Severe — "Prolonged, itches even when eating, playing, or sleeping"
- 5: Extreme — "Nearly continuous, must be physically restrained"

### Pollen (0-4)
- 0: None/offseason. 1: Low. 2: Moderate. 3: High. 4: Very high.
- Effective pollen level = 3-day rolling max of max(pollenLevel, sporeLevel) from the correlation engine.
- Tracking period: first log date → last log date
- Days with manual logs / backfilled days / no data (with explanation: "Logs = owner-entered daily. Backfill = retrospective estimates, lower confidence.")
- Correlation confidence distribution: N ingredients at high/medium/low/insufficient
- Transition buffer: N days excluded from correlation (5-day default after food switches)
- Pollen coverage: N of M days have readings

## Implementation

### API Route
`GET /api/dogs/[id]/export/llm`

Server-side assembly. Queries all relevant tables, formats as markdown string, returns `{ text: string }`.

**Data fetched:**
1. Dog profile
2. Active feeding plan + items (reuse food route logic)
3. Past feeding plans + scorecards + logStats (reuse scorecard route logic)
4. Product details: ingredients (ordered), guaranteed analysis, calories
5. Treat logs (aggregated by product, with date ranges and counts)
6. Medications (active + past, with catalog data)
7. Poop logs (full history for daily table + food period stats)
8. Itch logs (full history)
9. Correlation engine output (full run — both GI-merged and allergen tracks)
10. Pollen data (full history, if environmentEnabled)
11. Day snapshots from correlation engine (for daily log table + environmental analysis)

### Computed Data (not direct DB queries)
These require post-processing from raw data:
- **Food-medication overlap**: cross-reference feeding period dates with medication dates to populate the food history table's "Active Meds" column
- **Pollen stats per food period**: aggregate pollen data within each feeding period's date range (mean level, % high days)
- **Pollen-bucket averages**: group daily scores by pollen level (0-1, 2, 3-4) and compute means for section 9
- **Constant/unique ingredients**: set intersection and per-period unique ingredients across all food products
- **Symptom change dates**: scan for itch score changes >1 point sustained 3+ days; flag dates within 7 days of medication start/stop/dose change
- **Stool frequency**: avg count of poop log entries per day (from days with ≥1 entry)

### UI
- Button on the dog's settings card: "Export for LLM"
- Clicking it: fetches the API, copies result to clipboard, shows success toast
- No modal, no preview — just copy. The text is too long to preview usefully.

### Performance
The correlation engine is the heaviest query. Consider:
- Caching correlation results if already computed recently
- Or: skip correlation section if it would take too long, add a note "Run correlation analysis on the Insights page for ingredient-level data"
- For v1: just run it. It's a user-initiated action, not a page load.

## Sections We Don't Generate
The user adds these in their own chat:
- Vet visit notes and outcomes
- Hypotheses and reasoning
- Research citations
- Action plans and next steps
- Subjective observations ("he seems more energetic")

## Definition of Done
- [ ] `GET /api/dogs/[id]/export/llm` returns well-structured markdown
- [ ] All sections populated with real data
- [ ] Ingredient lists included per product (ordered by position)
- [ ] Nutrition data included per product
- [ ] Food history table includes pollen + medication columns per period
- [ ] Daily log table covers last 60 days with all columns
- [ ] Pollen-symptom bucket table populated (if environmentEnabled)
- [ ] Scoring systems and data coverage section present
- [ ] "Export for LLM" button on settings page copies to clipboard
- [ ] Toast confirms copy success
- [ ] Output is readable and useful when pasted into Claude
- [ ] `yarn build` passes

## Steps

### Step 1: Export API Route
Create `src/app/api/dogs/[id]/export/llm/route.ts`. Single GET handler that:
1. Authenticates + verifies dog ownership
2. Fetches all data (profile, plans, products, ingredients, logs, meds, correlation, pollen)
3. Runs correlation engine (reuse `fetchCorrelationInput` + `computeCorrelation`)
4. Computes cross-reference data (food-med overlap, pollen bucket stats, etc.)
5. Formats each section as markdown
6. Returns `{ text: string }`

### Step 2: Markdown Formatter
Create `src/lib/export-llm.ts` — pure function(s) that take the assembled data and return formatted markdown. Keep this separate from the route for testability.

Key formatting functions (one per section):
- `formatProfile()`, `formatCurrentDiet()`, `formatSupplements()`, `formatMedications()`
- `formatFoodHistory()`, `formatMedicationHistory()`
- `formatDailyLogTable()`
- `formatCorrelationData()` (GI + itch tracks)
- `formatPollenSymptomTable()` (pollen-bucket averages)
- `formatReferenceStats()`, `formatDataCoverage()`

### Step 3: Settings Page Button
Add "Export for LLM" button to each dog's card in `settings-client.tsx`. On click: fetch API, copy to clipboard, show toast.

### Step 4: Test & Polish
- Test with real data (Peaches)
- Compare output to `docs/peaches.md` — is anything important missing?
- Verify daily log table is complete and consistent
- Check food-medication-pollen cross-references are factually correct
- Paste output into Claude and ask it to analyze — does it have enough data?
- `yarn build`
