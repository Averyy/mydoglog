# TODO: LLM Export

> "Export for LLM" button on the dog settings page. Generates a structured markdown document with all the data we have about a dog, designed for pasting into Claude or another LLM to get advice on diet, allergies, and health.

## Goal

One-click copy of a comprehensive, well-organized text dump that gives an LLM full context about the dog. The user pastes it into a chat and can ask questions, get advice, brainstorm food trials, etc. We provide the facts — the user provides the questions.

## Output Format

Plain text markdown, copied to clipboard. No file download. Structured like `docs/peaches.md` but auto-generated from DB data.

### Sections

#### 1. Profile
- Name, breed, age (computed from birthDate), weight
- Location context if `environmentEnabled` (for pollen/allergy relevance)

#### 2. Current Diet
- Active feeding plan: each product with brand, full name, quantity, unit, meal slot
- Duration on current plan (start date → "present")
- Daily calorie estimate if available
- Full ordered ingredient list per product (from `productIngredients`, position-ordered)
- Guaranteed analysis per product (protein %, fat %, fiber %, etc.)

#### 3. Supplements, Toppers & Treats
- Active plan items where product type is supplement/topper: name, quantity, duration
- Recent treats from treat logs: product name, frequency (e.g., "~3x/day over last 30 days")
- Ingredient lists for each (same as above)

#### 4. Current Medications
- Active medications: name, dosage, interval, start date
- Drug class, description, known side effects (from medication catalog)
- Duration on current medication

#### 5. Food History (oldest → newest)
For each past feeding plan:
- Product name(s) with brand
- Date range and duration
- Average stool score + average itch score (from logStats or scorecard)
- Transition info if applicable ("3-day transition from X")
- Full ingredient list per product
- Treats given during this period (from treat log overlap)

#### 6. Medication History
- Past medications: name, dosage, interval, date range
- Relevant side effects

#### 7. Recent Health Data (last 30 days)
- Daily stool scores with timestamps (individual entries, not just averages)
- Daily itch scores with timestamps
- Notable patterns: averages, trends, worst days
- Symptom logs if any (gas, scooting, etc.)

#### 8. Ingredient Correlation Analysis
- Scoreable days count, logged vs backfilled breakdown
- Top problem ingredients (worst stool + itch scores, with day counts and confidence)
- Top safe ingredients (best scores)
- Common skin allergen reference line (beef 34%, dairy 17%, etc.)
- Cross-reactivity warnings
- Seasonally confounded flags

#### 9. Environmental Context (if enabled)
- Recent pollen/mold levels (last 14 days)
- General seasonal pattern note

#### 10. Key Patterns (auto-derived)
- Best food by stool score (with score + duration)
- Worst food by stool score
- Longest-running food
- Whether itching correlates with season changes or food changes
- Any ingredients that appear in all foods (constants like guar gum, rice, etc.)

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
7. Poop logs (last 30 days, individual entries)
8. Itch logs (last 30 days, individual entries)
9. Symptom logs (last 30 days)
10. Correlation engine output (full run)
11. Pollen data (last 14 days, if environmentEnabled)

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
- [ ] "Export for LLM" button on settings page copies to clipboard
- [ ] Toast confirms copy success
- [ ] Output is readable and useful when pasted into Claude
- [ ] `yarn build` passes

## Steps

### Step 1: Export API Route
Create `src/app/api/dogs/[id]/export/llm/route.ts`. Single GET handler that:
1. Authenticates + verifies dog ownership
2. Fetches all data (profile, plans, products, ingredients, logs, meds, correlation, pollen)
3. Formats each section as markdown
4. Returns `{ text: string }`

### Step 2: Markdown Formatter
Create `src/lib/export-llm.ts` — pure function(s) that take the assembled data and return formatted markdown. Keep this separate from the route for testability.

### Step 3: Settings Page Button
Add "Export for LLM" button to each dog's card in `settings-client.tsx`. On click: fetch API, copy to clipboard, show toast.

### Step 4: Test & Polish
- Test with real data (Peaches)
- Compare output to `docs/peaches.md` — is anything important missing?
- Adjust formatting for LLM readability (not too verbose, not too terse)
- `yarn build`
