# MyDogLog

> Domain: mydoglog.ca

## Overview

A web app for Canadian dog owners to track what their dog eats and how their dog poops, with the goal of identifying which ingredients agree or disagree with sensitive stomachs. Backed by a scraped database of Canadian dog food products (ingredients, photos, brand info) so users pick from a list rather than entering data manually. Not a medical tool, not an elimination diet protocol -- just structured logging with ingredient-level correlation reporting.

## Problem Statement

Dogs with sensitive stomachs go through endless food switches. Owners try different kibbles, wet foods, and treats over weeks and months but track nothing systematically. By the time they notice a pattern (or don't), they can't remember what was fed when. Vets ask "what have you tried?" and owners shrug.

The current approach: buy food, feed it for a while, eyeball the poop, switch if it seems bad, repeat. No data, no correlation, no memory.

The delayed-reaction nature of food sensitivities (days to weeks) makes manual tracking nearly useless.

## Target Audience

Canadian dog owners with dogs that have sensitive stomachs or suspected food sensitivities. Specifically owners who are past the "emergency diarrhea" phase and into the "trying to optimize from good to great" phase -- the dog is generally OK but poop quality varies and they want to figure out what works best.

Primary user: me. Will optimize for my own use case first, then consider sharing.

## Core Features

### Canadian Dog Food Database (Scraped)

The foundation. A database of dog food, treats, supplements, and toppers available in Canada, built by scraping manufacturer and retailer websites. For each product:

- **Product name** (brand + product line + variant)
- **Brand** and **manufacturer URL** (link to product's home page on brand site)
- **Product type**: dry food, wet food, treat, topper, supplement, probiotic, freeze-dried, whole food
- **Channel**: retail vs veterinary/prescription
- **Product photo(s)** (stored as links to source CDN initially)
- **Full ingredient list** (verified, comma-separated, in order by weight as required by law)
- **Guaranteed analysis** (crude protein, fat, fiber, moisture) where available

See `dog-food-brands-canada.md` for the full brand list, scraping targets, and technical details.

**Scraping approach**: wafer-py (anti-detection HTTP client) + BeautifulSoup/lxml for HTML parsing. Brand sites first (better organized), retailer sites to fill gaps. REST APIs where available (Royal Canin, Purina). RSC payload extraction for Next.js sites (PetSmart). Shopify JSON API for Shopify stores (Open Farm, Rayne).

### Food Logging & Daily Check-in

**Routine template** replaces the concept of a "meal plan." A routine is the set of food + supplements + medications the dog receives daily. It's a template, not a log — it pre-fills the daily check-in and serves as the implicit record for days the user doesn't open the app.

**Three entry points:**

1. **Daily Check-in** — unified form with expandable sections:
   - **Routine** (food + supplements + meds): pre-filled from the active routine template. Edit inline for one-off changes, or check "Apply going forward" to update the template itself.
   - **Stool**: Purina 1-7 score, optional time/notes/photo.
   - **Itchiness**: 1-5 scale, body areas, optional notes/photo.
   - **Treats**: ad-hoc items fed outside the routine.
   - Frequency: once a day. Saving confirms the routine for that day and captures outcome data.

2. **Quick Poop** — 3-second in-the-moment flow: pick score + save. Timestamp auto-captured. For logging individual poop events throughout the day (different consistencies, time-of-day correlation).

3. **Quick Treat** — 3-second flow: pick product + save. Timestamp auto-captured.

**Key behaviors:**
- **No auto-logging**: meal data alone without outcome data (poop/itch) is useless for correlation. On days the user doesn't open the app, the routine template is the implicit record. On days they save a daily check-in, the routine is explicitly confirmed.
- **Quick entries assume routine unchanged**: if only Quick Poop / Quick Treat entries exist for a day, the routine template covers meals.
- **Scorecard prompt**: when updating the routine template with new food (replacing previous food), the app prompts for a scorecard on the outgoing food. Skippable but encouraged.
- **No custom food entry**: every item maps to a product_id in the DB. Commercial foods come from scraping; common whole foods (plain chicken, rice, pumpkin, etc.) are seeded.

**Food Scorecard page** — a dedicated page (not a modal) for reviewing and rating food history. Three sections: Scored (rated foods with verdict badges), Needs Scoring (foods the user has fed but not yet rated), Untracked (products in the DB the user hasn't fed). Pull-based — the user reviews at their own pace instead of being prompted at specific moments. Replaces the old "backfill" concept.

**Responsive container**: all logging UI (Daily Check-in, Quick Poop, Quick Treat) uses shadcn Drawer (slide-up) on mobile, Dialog (modal) on tablet/desktop. Same content component shared between both.

### Food Scorecard (Per-Food Summary)

An overall rating attached to a plan group (the combination of foods in a routine). Filled in when you change the routine or via the Food Scorecard page. This is the summary judgment, separate from daily logs.

- **Poop quality overall**: Purina 1-7 fecal score (same scale as PoopLog, score 2 = ideal)
- **Gas**: none / mild / bad / terrible
- **Vomiting/regurgitation**: none / occasional / frequent
- **Taste/palatability**: loved it / ate it / reluctant / refused
- **Itchiness impact**: better / no change / worse
- **Overall verdict**: thumbs up / mixed / thumbs down
- **Primary reason** (when mixed or thumbs down): bad poop / vomiting-regurgitation / gas / itchiness / refused to eat / too expensive / other
- **Notes**: free text ("loved the taste but instant diarrhea", "took 2 weeks to settle, then great")

For foods with detailed daily logs, the scorecard is optional (the data speaks for itself). For backfilled foods without daily logs, the scorecard IS the data. Either way, the scorecard + ingredients go into the correlation engine.

### Logging Granularity (Automatic)

There is one logging flow: log events. The system automatically infers granularity from how many entries exist on a day. No mode switching, no separate "daily summary" form.

**How it works:**
- **1 entry on a day** (no specific time) → treated as the day's summary data point for that metric
- **2+ entries on a day** → treated as individual events, system uses all of them
- **Time is always optional** on all log types. Defaults to now but can be cleared. Absence of time = "sometime today" which is fine for correlation.

**Correlation priority (per metric, per day):**
1. Event logs exist for this day? → use them (single entry = daily-level data, multiple = individual events)
2. No event logs? Food scorecard has a relevant rating? → spread across uncovered days in that feeding period

**Examples:**
- Monday: logged 3 poops with times → 3 individual data points
- Tuesday: logged 1 poop, no time → that's Tuesday's poop data
- Wednesday: logged nothing → food scorecard fills in if available
- Backfilled food with no daily logs at all → food scorecard is the only data

This means the same poop log form handles both "I'm logging this specific poop right now" and "he went 3 times today." When count > 1, the UI expands individual score selectors per poop and saves each as a separate PoopLog row.

### Poop Logging

- **Purina Fecal Scoring Chart (1-7 scale)**: the de facto standard in North American veterinary practice. Used by most vet school teaching hospitals (Missouri, Georgia, Saskatchewan, Minnesota) and the majority of published veterinary nutrition research. AAHA does not endorse a specific system but recommends consistent use of one — Purina's is the most widely adopted. Score 2 = ideal. Competing scales: Waltham (1-5 with half-points, common in Europe), Royal Canin (1-5, inconsistent across versions). All agree score 2 = ideal. With cartoon/vector illustrations of each score for quick tapping (less gross than photos)
  - 1: Hard pellets (constipation)
  - 2: Firm, segmented, easy pickup (ideal)
  - 3: Log-shaped, moist, leaves residue
  - 4: Soft, loses form on pickup
  - 5: Very moist piles, some shape
  - 6: Texture visible but no shape
  - 7: Watery liquid (diarrhea)
- **Count**: how many poops this entry represents (default 1). When count > 1, the UI expands to show individual Purina score selectors per poop (e.g., count=3 shows 3 score pickers). This captures per-poop variation ("2 were score 3, 1 was score 5") instead of forcing one approximate score for all.
- **Time**: optional. Defaults to now. Clear it for a "sometime today" entry.
- **Urgency flag**: for emergency events (woke up at 3am, couldn't hold it, accidents in sleep)
- **Notes**: free text for anything else
- **Optional**: color
- **Optional photo**: camera button to snap a photo of the poop. Useful for vet visits ("here's what it looked like on the bad days"). Opens camera directly on mobile via `<input capture>`.
- **Target: under 30 seconds per entry**

### Itchiness Logging

- **Daily score (1-5)**: none, mild, moderate, significant, severe
- **Body area**: ears, paws, belly, face, general (multi-select)
- **Optional photo**: snap a photo of the affected area (red skin, hot spot, paw staining). Builds a visual timeline for vet visits.
- **Notes**: free text

### Symptom Log (Catch-All)

A general-purpose log for everything beyond poop, itchiness, and vomiting. One flexible form:
- **Symptom type** (pick one):
  - Gas/flatulence (mild/moderate/severe)
  - Ear issue (discharge, smell, head shaking, pawing)
  - Scooting / anal gland issue
  - Hot spot (location on body)
  - Grass eating (urgency/desperation level)
  - Lethargy / low energy
  - Appetite change (refusal or unusual hunger)
  - Coat issue (dull, oily, excessive shedding, yeast smell)
  - Other (free text)
- **Severity**: mild / moderate / severe
- **Optional photo**
- **Datetime**: defaults to now
- **Notes**: free text

Ear issues and gas are the highest-signal items here. "Ears and rears" (ear infections + anal gland problems) is a known veterinary pattern for food allergies specifically.

### Accidental Exposure Log

For when the dog eats something off-protocol during a food trial or gets unauthorized treats. This is the #1 reason elimination diet trials fail.
- **What happened**: free text (e.g., "ate a piece of chicken off the floor", "neighbor gave him a Milk-Bone", "got into the cat food")
- **Ingredients**: pick from the DB ingredient list (searchable typeahead) or type free text for unknowns. This is the only place users enter ingredient info manually.
- **Datetime**: when it happened
- **Notes**: free text

Shows as a red marker on the timeline. Allows filtering correlation data to exclude post-exposure periods.

### Pollen Count (Auto-Captured)

Daily pollen count automatically recorded based on the user's location. Helps distinguish "is this a food reaction or is it allergy season?" -- the single hardest diagnostic question for food vs environmental allergies.

- **Location**: set once in user/dog settings (city or postal code)
- **Data**: daily pollen index pulled from **Ambee Pollen API** (100 free calls/day, no credit card required, Canadian coverage, tree/grass/weed breakdown with 14+ sub-species, 500m resolution). Fallback: Google Pollen API (5,000 free/month but requires GCloud billing account with credit card). Note: Environment Canada does NOT provide pollen data; Open-Meteo pollen is Europe-only; AccuWeather killed free tier in 2025
- **Timeline overlay**: pollen level shown as a background color or secondary axis on the timeline chart
- **Correlation context**: when itchiness spikes, the pollen overlay helps determine if it's seasonal or food-driven. "Itchiness went up, but pollen was also at peak" vs "itchiness went up and pollen was low -- probably food."

No user interaction needed. Just set location once and the app captures pollen daily.

**Pollen architecture:** 1 API call per unique city per day (not per user). Store in `pollen_logs`. No historical backfill available — start collecting from day one. Ontario pollen season: April–September (tree peak Apr–May, grass peak Jun–Jul, ragweed Aug–Sep).

### Vomiting / Regurgitation Logging

- **Type**: vomiting vs regurgitation vs bile/stomach acid
  - Vomiting: stomach contents, heaving/retching involved, partially digested
  - Regurgitation: undigested food from esophagus, passive, happens shortly after eating
  - Bile/acid: yellow/foamy morning vomit on empty stomach (common in goldendoodles and other breeds)
- **Time since last meal**: how long after eating (quick picker: <30min, 1-2hr, 3-6hr, 6+hr, empty stomach/morning). Key diagnostic signal -- regurgitation is usually minutes after eating, bile vomit is on an empty stomach.
- **Datetime**: when it happened
- **Notes**: free text

### Medication Tracking

- **Name**: free text (e.g., "Apoquel", "Metronidazole", "Cerenia")
- **Dosage**: free text (e.g., "16mg twice daily", "1/2 tablet AM")
- **Start date / End date** (null = still taking)
- **Reason**: optional tag (itchiness/digestive/other) for easier correlation
- **Notes**: free text

Shows on the timeline as another layer alongside food periods. Allows correlating medication periods with itchiness and poop improvements. Important for vet conversations -- "he was on Apoquel from Jan 5-20, itchiness dropped from 4 to 1 during that period."

### Reporting / Insights

- **Timeline view**: food changes + medications overlaid with poop scores, itchiness, symptoms, vomiting, and accidental exposures over time. Accidental exposures shown as red markers.
- **Transition buffer**: exclude the first N days after a food change from correlation calculations (adjustable on the reports page, default 5 days). Transition poop is expected noise.
- **Ingredient correlation**: for each ingredient, find all feeding periods containing it, collect poop scores (event logs first, food scorecards as fallback for days with no logs, minus transition buffer), compute avg score and bad-day count. "Chicken appeared in 3 foods, average poop score during those periods was 2.8"
- **Highlight problem ingredients**: ingredients that appear disproportionately in bad-poop periods. "Corn was present in 4/5 foods with avg score >= 5"
- **Itchiness + symptom correlation**: ingredient-level analysis mapped to itchiness scores and symptom frequency (ear issues, gas, scooting during food period X vs Y)
- **Medication correlation**: itchiness/poop/symptom scores during medication periods vs off-medication periods
- **Accidental exposure filtering**: option to exclude N days after accidental exposures from correlation calculations (same concept as transition buffer)

### LLM Integration

**Phase 1 (now):** REST API endpoints + an "Export for LLM" button in the UI that dumps a dog's feeding history, poop logs, and itchiness data as structured text/JSON you can paste into Claude or any LLM for analysis.

**Phase 2 (later):** MCP server so Claude can query the data directly without copy-pasting.

Example queries (either via paste or MCP):
- "What did he eat in the last 2 weeks?"
- "Show me poop scores during the chicken period"
- "Which ingredients correlate with scores above 4?"
- "Compare the Royal Canin GI period vs the Hill's i/d period"

---

## Non-Goals

- Not a vet consultation tool
- Not an elimination diet protocol guide
- Not a general pet health tracker (no vaccines, appointment scheduling, etc.)
- Not a social platform or community
- No AI recommendations on what to feed -- just data and correlation
- Not trying to be a product/business initially -- personal utility first

## Tech Stack

- **Framework**: Next.js (TypeScript) -- monolith, same stack as awire. Pages, API routes, React UI, all in one deploy.
- **Auth**: Better Auth -- cookie-based sessions in PostgreSQL, email/password. Same library and pattern as awire. Share logins for multi-user initially. DogShare deferred.
- **ORM**: Drizzle -- same as awire. Schema, migrations, queries.
- **Database**: PostgreSQL
- **UI**: shadcn/ui (Radix primitives + Tailwind styling, same Radix base as awire)
- **Scraping**: Separate Python CLI (not deployed). wafer-py + BeautifulSoup for all sites (REST APIs, HTML parsing, RSC payload extraction). Runs locally, writes to production PostgreSQL.
- **MCP Server** (Phase 2): Python process that queries the Next.js API routes over HTTP. The API routes ARE the shared interface for web, MCP, and future iOS.
- **Deployment**: Single Docker container (Next.js), PostgreSQL alongside. One deploy.
- **Mobile**: Responsive web (not PWA). Logging happens on phone in the yard.
- **Future iOS**: Next.js API routes are the shared backend. iOS app (SwiftUI) hits the same endpoints.

## Data Model

### Users & Dogs
- **User**: managed by Better Auth (email, name, emailVerified, createdAt, updatedAt). Custom fields added via Drizzle schema extension.
- **Dog**: owner (user), name, breed, birth_date, weight_kg (nullable), location (city/postal code for pollen data), notes, created_at

### Food Database (Scraped)
- **Brand**: name, website_url, country, logo_url
- **Product**: brand, name, description (short product description), type (dry_food/wet_food/treat/topper/supplement/probiotic/freeze_dried/whole_food), channel (retail/vet/seed), lifestage (puppy/adult/senior/all), health_tags[], raw_ingredient_string, guaranteed_analysis_json (flat keys: `{"crude_protein_min": 26, "crude_fat_min": 14, "crude_fiber_max": 3.4, "moisture_max": 10}`), calorie_content (nullable, e.g. "3744 kcal/kg, 359 kcal/cup"), image_urls[], manufacturer_url, variants_json (array of `{"weight": 2.72, "unit": "kg", "upc": "..."}` per size variant), scraped_from, scraped_at, **is_discontinued** (bool, default false), **discontinued_at** (nullable datetime)
- **Ingredient**: normalized_name, aliases[], category (protein/carb/fat/fiber/vitamin/mineral/additive), family (species-level grouping, e.g., "chicken", "rice", "corn"), source_group (e.g., "poultry", "red_meat", "fish", "grain"), form_type (raw/meal/by-product/fat/oil/hydrolyzed/flour/bran), is_hydrolyzed (bool — specifically flagged because hydrolyzed protein diets are a standard veterinary approach to diagnosing food allergies; proteins broken into small peptides to avoid immune response)
- **ProductIngredient**: product, ingredient, position (order by weight)
- **IngredientCrossReactivity**: group of ingredient families that may cross-react (e.g., chicken+turkey+duck as "poultry", beef+lamb+venison as "ruminant")

### Logging
- **FeedingPeriod**: dog, product, start_date, end_date (null=ongoing), **quantity** (nullable decimal), **quantity_unit** (can/cup/g/scoop/piece/tbsp/tsp/ml, nullable), **plan_group_id** (uuid, groups rows from same plan setup), **plan_name** (nullable), is_backfill, approximate_duration (nullable, free text like "3 weeks" or "2 months"), notes. One row per product in the plan — multiple products = multiple rows with the same plan_group_id. Day-level tracking (no per-meal breakdown in MVP; meal_slot column reserved for future use, nullable).
- **TreatLog**: dog, product, date, datetime (nullable), quantity (nullable decimal), quantity_unit (can/cup/g/scoop/piece/tbsp/tsp/ml, nullable), notes. Ad-hoc treats logged outside the routine — point-in-time events, not sustained feeding. Feeds into correlation alongside feeding periods.
- **FoodScorecard**: **plan_group_id** (FK, one scorecard per plan group — rates the entire combination of foods, not individual products), poop_quality (1-7, Purina fecal score, 2=ideal), gas (none/mild/bad/terrible), vomiting (none/occasional/frequent), palatability (loved/ate/reluctant/refused), itchiness_impact (better/no_change/worse), verdict (up/mixed/down), primary_reason (nullable, for mixed/down: bad_poop/vomiting/gas/itchiness/refused_to_eat/too_expensive/other), notes. For backfills, the plan_group_id is unique to that single feeding_period row, so it still works 1:1.
- **Medication**: dog, name, dosage, start_date, end_date (null = still taking), reason (itchiness/digestive/other), notes
- **PoopLog**: dog, date, datetime (nullable -- null means "sometime today"), firmness_score (1-7), color (nullable), urgency (bool), photo_url (nullable), notes. When logging multiple poops at once, the UI expands per-poop score selectors and saves each as a separate PoopLog row (same date, no datetime).
- **VomitLog**: dog, date, datetime (nullable), type (vomiting/regurgitation/bile), time_since_meal (enum), notes
- **ItchinessLog**: dog, date, datetime (nullable), score (1-5), body_areas[], photo_url (nullable), notes
- **SymptomLog**: dog, date, datetime (nullable), type (gas/ear_issue/scooting/hot_spot/grass_eating/lethargy/appetite_change/coat_issue/other), severity (mild/moderate/severe), photo_url (nullable), notes
- **AccidentalExposure**: dog, datetime, description, ingredient_ids[] (from DB) + free_text_ingredients (for unknowns), notes
- **PollenLog**: dog (via location), date, pollen_index, pollen_types (tree/grass/weed levels if available), source_api

### Notes on Data Model
- **Automatic granularity**: All log types have both `date` (required) and `datetime` (nullable). The system infers granularity from the data: 1 entry on a day = daily-level data point, 2+ entries = individual events. No separate daily summary table needed.
- **Correlation priority**: event logs for a day > food scorecard. Per metric, per day.
- PoopLog `count` field: default 1 (one specific poop). When count > 1, the UI shows individual score selectors per poop — stored as separate PoopLog rows (one per poop, same date, no datetime). This gives accurate per-poop data even for batch logging.
- Meal detail (quantity, unit) lives directly on FeedingPeriod rows. A `plan_group_id` links rows created together as one routine. Day-level tracking in MVP — no per-meal breakdown. `meal_slot` column exists but is nullable and unused initially (reserved for future meal-level logging). FoodScorecard attaches to plan_group_id (rates the whole routine, not individual products).
- **Scorecard prompt on routine change**: when updating the routine template with new food (replacing previous food), the app prompts for a scorecard on the outgoing food. User can skip. Unrated foods are also accessible from the Food Scorecard page for retroactive rating.
- **Routine = plan group**: a set of feeding_period rows sharing a plan_group_id. No separate table — feeding_periods IS the routine. The routine template concept (food + supplements + medications) is implemented as the currently-active plan group.
- **Overlap resolution**: single-day plans (start_date = end_date) override date-range plans override ongoing plans (end_date = null). Most recently created wins ties. Query for "today's plan" resolves to one plan_group_id.
- **Auto-ending**: creating a new ongoing plan auto-ends the previous one (sets end_date = yesterday on all its rows).
- **Treat logs** feed into correlation alongside feeding periods: "what was consumed on date X" = active plan group items + treat_logs for that date.
- **Quantities are optional but encouraged**: casual users can skip them. Quantities enable future calorie estimation but aren't needed for ingredient correlation.
- **AccidentalExposure vs TreatLog**: treat_logs are intentional, from the DB. Accidental exposures are off-protocol events (red timeline markers, correlation exclusion zones).
- **Manual products**: `data/manual_products.json` holds both commercial products without scrapers (real brands, channel=retail) and whole foods (brand="Whole Food", channel=seed, type=whole_food). Same BrandEnvelope schema as scraped data — `build.py` loads it identically. If a scraper is later built for a manually-added brand, the scraped version upserts over the manual entry.
- photo_url on PoopLog/ItchinessLog/SymptomLog stores a path to uploaded image. Photo upload deferred from initial launch but infrastructure built in (endpoint + storage). Camera buttons added to forms immediately after launch.
- Pricing deferred. Can add later from PetSmart (retail) and myvetstore (vet) if needed.
- Multi-dog: all logging tables reference a dog. Dog has an owner (Better Auth user ID). Share logins for multi-user initially; DogShare (invite/roles) deferred.
- One Product per formula regardless of bag/can size. Size variants stored as variants_json (weight, unit, UPC per variant). Scraper deduplicates size variants.
- VomitLog distinguishes vomiting (stomach, heaving) from regurgitation (esophageal, passive) from bile (empty stomach, morning).
- SymptomLog is the catch-all for secondary symptoms. Type enum is extensible.
- AccidentalExposure: ingredient_ids reference existing Ingredient records (user picks from typeahead). free_text_ingredients is raw text for unknowns. Free-text entries do NOT create new Ingredient records -- only the scraping pipeline creates those. Keeps the ingredient table clean.
- AccidentalExposure shows as a red marker on the timeline and can exclude N days from correlation calculations.
- Weight is a simple field on Dog (current weight only, no history tracking).
- Type and texture merged into one `type` field. Stew/loaf/mousse distinctions live in the product name, not a separate field.
- **Discontinued products are never deleted.** When a product disappears from the scrape source, the scraper sets `is_discontinued = true` and `discontinued_at` to the current timestamp. All historical data (feeding periods, scorecards, ingredient correlations) remains intact. Discontinued products show a "Discontinued" badge in the UI and are hidden from the food browser by default (toggle to show them). Active feeding periods on discontinued products are not affected -- the user can keep logging until they stop feeding it. This ensures no user data ever disappears because a manufacturer reformulated or dropped a product.

---

## Storage Architecture

### Two Data Concerns, One Database

**PostgreSQL** holds everything. Two distinct write paths:

1. **Product data** (read-only for the app) -- populated by the Python scraping pipeline (run locally)
2. **User + auth data** (read-write) -- managed by Next.js API routes + Better Auth

```
PostgreSQL
├── user                ← Better Auth (managed)
├── session             ← Better Auth (managed)
├── account             ← Better Auth (managed)
├── verification        ← Better Auth (managed)
│
├── brands              ← scraping pipeline (Python CLI, run locally)
├── products            ← scraping pipeline
├── ingredients         ← scraping pipeline
├── product_ingredients ← scraping pipeline
├── ingredient_cross_reactivity ← scraping pipeline (seed data)
│
├── dogs                ← Next.js API routes
├── feeding_periods     ← Next.js API routes
├── treat_logs          ← Next.js API routes
├── food_scorecards     ← Next.js API routes
├── poop_logs           ← Next.js API routes
├── vomit_logs          ← Next.js API routes
├── itchiness_logs      ← Next.js API routes
├── symptom_logs        ← Next.js API routes
├── accidental_exposures← Next.js API routes
├── medications         ← Next.js API routes
├── pollen_logs         ← Next.js (VPS crontab → protected API endpoint)
```

Scrapers never touch user/auth tables. Next.js never writes to product tables. Better Auth manages its own tables.

### Scraping Pipeline (Separate Python Project)

**Not part of the Next.js deploy.** A separate Python CLI project (sibling directory or subdirectory) that runs locally on the developer's machine. Follows the pcbparts pattern: modular scraper registry, intermediate JSON, build script loads to PostgreSQL.

```
scraper/                         ← Python project (not deployed)
├── pyproject.toml               # wafer-py, beautifulsoup4 deps
├── scrape.py                    # CLI entry point: `uv run python scrape.py purina`
├── scrapers/
│   ├── __init__.py              # registry: {"purina": scrape_purina, ...}
│   ├── common.py                # shared types (Product, Variant, GuaranteedAnalysis), write_brand_json, GA parsing helpers
│   ├── royalcanin.py            # REST API
│   ├── purina.py                # Gatsby page-data JSON
│   ├── hills.py                 # HTML (AEM)
│   ├── authority.py             # PetSmart RSC + JSON-LD
│   ├── openfarm.py              # Shopify JSON + HTML
│   ├── rayne.py                 # Shopify JSON + static GA lookup
│   └── ...                      # 16 scrapers total (see __init__.py)
├── data/
│   ├── brands/
│   │   ├── purina.json          # scraped output (one per brand)
│   │   ├── hills.json
│   │   └── ...                  # 16 brand JSONs
│   └── manual_products.json     # whole foods + manual commercial products
├── tests/                       # pytest tests
```

**Per-brand JSON schema:**
```json
{
  "brand": "Purina",
  "website_url": "https://purina.ca",
  "scraped_at": "2026-02-28T...",
  "products": [
    {
      "name": "Pro Plan Veterinary Diets EN Gastroenteric Dry Dog Food",
      "description": "Highly digestible nutrition for dogs with GI conditions",
      "type": "dry_food",
      "channel": "vet",
      "lifestage": "adult",
      "health_tags": ["digestive_health"],
      "ingredients_raw": "Rice, dried egg product, ...",
      "guaranteed_analysis": {
        "crude_protein_min": 26,
        "crude_fat_min": 14,
        "crude_fiber_max": 3.4,
        "moisture_max": 10
      },
      "calorie_content": "3744 kcal/kg, 359 kcal/cup",
      "image_urls": ["https://purina.ca/..."],
      "manufacturer_url": "https://purina.ca/...",
      "variants": [
        {"weight": 2.72, "unit": "kg", "upc": "038100191373"},
        {"weight": 8.16, "unit": "kg", "upc": "038100191380"}
      ]
    }
  ]
}
```

**CLI** (from `scraper/` directory):
```
uv run python scrape.py purina     # scrape one brand → JSON
uv run python scrape.py all        # scrape all → JSON
uv run python build.py             # load JSON → PostgreSQL (not yet implemented)
uv run python validate.py          # diff against myvetstore ground truth (not yet implemented)
```

**build.py responsibilities:**
- Parse raw ingredient strings into individual ingredients (bracket-aware splitting)
- Normalize each ingredient against `ingredient_families.json` lookup (maps to family, source_group, form_type, is_hydrolyzed)
- Flag unknown ingredients for manual classification
- Load `data/manual_products.json` (manually added commercial products + whole foods, same BrandEnvelope schema)
- Upsert products, brands, ingredients, product_ingredients into PostgreSQL
- Idempotent — safe to re-run

**Why intermediate JSON (not direct-to-DB):**
- Inspect and validate scraped data before loading
- Re-run build without re-scraping (scraping is slow, building is fast)
- Diff between runs to see what changed
- Version control the JSON in git
- Validate against myvetstore ground truth before loading

**Manual Products (`data/manual_products.json`):**

A single file for any products added by hand — commercial items that don't have scrapers yet, and common whole foods. Uses the same `BrandEnvelope` schema as scraped brand JSONs, so `build.py` loads it identically. Two kinds of entries:

1. **Commercial products** (channel = "retail"/"vet"): real branded items where no scraper exists yet. E.g., Nummy Tum Tum Pure Organic Pumpkin. Include real brand name, URL, ingredients, GA where available. If a scraper is later built for that brand, the scraped version upserts over the manual entry. Currently empty — all commercial products have scrapers.
2. **Whole foods** (channel = "seed", type = "whole_food"): common supplemental foods with single-ingredient lists. Brand = "Whole Food". Bare essentials only — boiled chicken breast, white rice, carrots, broccoli, banana, blueberries.

Adding new items = edit the JSON and re-run `build.py`. In the UI, whole foods show with a "Whole Food" badge; manual commercial products show their real brand name like any scraped product.

---

## Web App Architecture

### System Diagram

```
┌──────────────────────────────────────┐
│           Next.js Monolith           │
│  ┌────────────┐  ┌────────────────┐  │
│  │  React UI  │  │  API Routes    │  │
│  │  (pages)   │  │  /api/*        │  │
│  └────────────┘  └───────┬────────┘  │
│                          │           │
│  ┌────────────┐  ┌───────▼────────┐  │
│  │ Better Auth│  │  Drizzle ORM   │  │
│  │ (sessions) │  │  (queries)     │  │
│  └──────┬─────┘  └───────┬────────┘  │
│         └────────┬───────┘           │
│                  ▼                   │
│         ┌──────────────┐             │
│         │  PostgreSQL  │             │
│         └──────────────┘             │
└──────────────────────────────────────┘
                   ▲
    ┌──────────────┴──────────────┐
    │                             │
┌───▼──────────────┐  ┌──────────▼───────┐
│  Scraping CLI    │  │  MCP Server      │
│  (Python)        │  │  (Python, later) │
│  runs locally    │  │  calls API routes│
└──────────────────┘  └──────────────────┘

Future:
┌──────────────────┐
│  iOS / SwiftUI   │──→ calls same API routes
└──────────────────┘
```

Next.js serves both the React UI (pages) and JSON API routes. One process, one port, one Docker container. Better Auth handles sessions via PostgreSQL. Drizzle manages all schema and queries.

The scraping pipeline is a separate Python CLI project that runs locally on the developer's machine. It writes directly to the same PostgreSQL database (product tables only). Not deployed, not part of the Docker image. Run it when you want to refresh the food database.

The MCP server (Phase 2) is a separate Python process that calls the Next.js API routes over HTTP. The API routes are the shared interface -- same endpoints for web UI, MCP, and future iOS.

### Screens

**1. Dashboard (Home)**
The landing page after login. Shows:
- Active dog name + switcher (if multi-dog)
- Active routine summary (compact: "½ can HA + 25g pumpkin + Apoquel"), tappable to expand
- No routine → "Set up your dog's routine" prompt
- Last 7 days mini-chart: poop scores as dots, itchiness as a line
- Any urgency events or accidental exposures flagged in red
- Bottom nav `+` button opens entry selector: Daily Check-in / Poop / Treat

**2. Daily Check-in (Drawer/Dialog)**
The primary logging flow. Opened from bottom nav `+` or dashboard. Unified form with collapsible sections:

- **Routine section**: pre-filled from the active routine template (food + supplements + medications). Each item shows product photo + name + quantity. Editable inline — add/remove/change items for today. "Apply going forward" checkbox updates the routine template. Type badges distinguish food / supplement / medication.
- **Stool section**: 7 large tap targets (Purina 1-7, score 2 highlighted as ideal, semantic color per score). Optional time, urgency toggle, color, notes, photo. For a daily summary entry.
- **Itchiness section**: 5 tap targets (1-5: None/Mild/Moderate/Significant/Severe). Body area icon grid (ears, paws, belly, face, general — multi-select). Optional photo, notes.
- **Treats section**: quick-add from recent treats (last 5) or search DB. Optional quantity + unit.
- Save button at bottom. After save: brief confirmation, returns to dashboard.

**3. Quick Poop (Drawer/Dialog)**
In-the-moment, 3-second flow. Opened from bottom nav `+` selector:
- 7 large tap targets (Purina 1-7, score 2 highlighted). Semantic color per score.
- Timestamp auto-captured (adjustable).
- Urgency toggle.
- Optional: photo, notes (collapsed).
- Save → returns to previous screen.
- Use case: logging individual poops throughout the day for time-of-day correlation.

**4. Quick Treat (Drawer/Dialog)**
In-the-moment, 3-second flow:
- Recent treats (last 5) for 1-tap re-logging, or search DB for new treats.
- Optional quantity + unit.
- Timestamp auto-captured.
- Save → returns to previous screen.

**5. Food Scorecard Page** (`/dogs/[id]/food-scorecard`)
Dedicated page for reviewing and rating food history. Three sections:
- **Scored**: foods the user has rated. Shows product, date range, verdict badge (thumbs up/mixed/down), scorecard summary. Tap to view/edit full scorecard.
- **Needs Scoring**: foods the user has fed but not yet rated. "Rate" CTA opens scorecard form.
- **Untracked**: products in the DB the user hasn't fed yet. For reference/browsing.
- Scorecard form: poop quality (1-7), gas (none/mild/bad/terrible), vomiting (none/occasional/frequent), palatability (loved/ate/reluctant/refused), itchiness impact (better/no_change/worse), verdict (up/mixed/down), primary reason (when mixed/down), notes.

**6. Routine Template Editor (Drawer/Dialog)**
For setting up or modifying the routine template directly (outside the daily check-in):
- Product list: add items by searching product DB (food, supplements, whole foods). Set optional quantity + unit per item.
- Medication list: name, dosage, reason tag.
- Save → updates the routine template going forward.
- When replacing food items, prompts for scorecard on outgoing food. Skippable.

**7. Symptom Log**
- Symptom type picker: gas, ear issue, scooting, hot spot, grass eating, lethargy, appetite change, coat issue, other
- Severity: mild / moderate / severe
- Photo button: optional
- Notes: optional text
- Datetime: defaults to now
- Save

**8. Accidental Exposure**
- "What happened?" text field
- Known ingredients: optional
- Datetime: defaults to now
- Save (shows as red marker on timeline)

**7. Food Database Browser**
- Search bar with instant results
- Filter chips: type (dry food, wet food, treat, topper, supplement, freeze-dried, whole food), channel (vet, retail), brand dropdown
- Product cards: photo, name, brand, channel badge, type badge
- Product detail page: full name, all photos, brand + manufacturer link, channel, type, lifestage, health tags, full ingredient list (formatted, scrollable), guaranteed analysis (if available). Useful for browsing alternatives and recommending foods based on ingredient overlap/avoidance.

**8. Timeline / Reports**
The analytical view. Date range selector (1 week, 1 month, 3 months, 6 months, all time).
- **Timeline chart**: horizontal time axis. Food periods as colored horizontal bars (stacked for concurrent foods). Medication periods as a separate row. Poop scores as dots on a 1-7 y-axis. Itchiness scores as a secondary line/dots. Vomiting/regurgitation events and accidental exposures as markers. Symptom events as icons.
- **Transition buffer control**: "Exclude first __ days after food changes" (slider, default 5). Right on the reports page, not buried in settings. Same buffer applies after accidental exposures -- they're treated like a food change for correlation purposes.
- **Ingredient correlation table**: for the selected date range, lists ingredients ranked by their association with poop scores (excluding transition + exposure days). Columns: ingredient name, # foods containing it, avg poop score during those periods, # bad days (score >= 5), # good days (score <= 3).
- **Problem ingredients highlight**: red-flagged ingredients that appear disproportionately in bad-poop periods.
- **Itchiness + symptom correlation**: ingredient-level analysis mapped to itchiness scores and symptom frequency.
- **Medication correlation**: itchiness/poop/symptom scores during medication periods vs off-medication.
- **Export for LLM button**: dumps all data (feeding history with ingredients, medications, poop logs, itchiness, symptoms, vomiting, accidental exposures) as structured text for pasting into Claude.

**9. Dog Settings**
- Add/edit/delete dogs (name, breed, birth date, weight, location, notes)
- Switch active dog

**10. Account**
- Email, password change
- Export data (CSV/JSON)
- Delete account

### API Design (Next.js API Routes)

All endpoints under `/api/`. Auth via Better Auth cookie sessions (same pattern as awire). All routes except auth and product browsing require authenticated session.

**Auth:** Handled by Better Auth (`/api/auth/*` -- managed automatically). Email/password sign up, sign in, sign out, password reset.

**Dogs:**
- `GET /dogs` -- list user's dogs
- `POST /dogs` -- create dog
- `PATCH /dogs/{id}` -- update dog (including weight_kg)
- `DELETE /dogs/{id}` -- delete dog

**Food Database (read-only for users, populated by scraper):**
- `GET /products` -- search/filter products (query, type, channel, brand, page)
- `GET /products/{id}` -- full product detail with ingredients
- `GET /brands` -- list all brands

**Feeding (Plan Groups):**
- `GET /dogs/{dog_id}/feeding` -- returns plan groups (active + past) with items
- `GET /dogs/{dog_id}/feeding/today` -- today's active plan (resolved from overlap rules)
- `POST /dogs/{dog_id}/feeding` -- create plan group (mode inferred from dates, items[])
- `PATCH /feeding/groups/{plan_group_id}` -- update plan (edit items, change end_date)
- `DELETE /feeding/groups/{plan_group_id}` -- delete plan group + its feeding_period rows
- `POST /dogs/{dog_id}/feeding/backfill` -- add historical food (product_id, approximate_duration, scorecard). Legacy — Food Scorecard page is the primary way to rate past foods now.
- `GET /feeding/groups/{plan_group_id}/scorecard` -- get food scorecard for a plan group
- `PUT /feeding/groups/{plan_group_id}/scorecard` -- set/update food scorecard (poop_quality, gas, vomiting, palatability, itchiness_impact, verdict, notes)

**Treats:**
- `GET /dogs/{dog_id}/treats` -- list treat logs (date range filter)
- `POST /dogs/{dog_id}/treats` -- log treat (product_id, quantity?, quantity_unit?, date, notes?)
- `PATCH /treats/{id}` -- edit
- `DELETE /treats/{id}` -- delete

**Poop Logging:**
- `GET /dogs/{dog_id}/poop` -- list poop logs (date range filter)
- `POST /dogs/{dog_id}/poop` -- log a poop (firmness_score, datetime, urgency, color, notes, photo)
- `PATCH /poop/{id}` -- edit a log
- `DELETE /poop/{id}` -- delete a log
- `POST /poop/{id}/photo` -- upload photo (multipart)

**Vomiting:**
- `GET /dogs/{dog_id}/vomiting` -- list vomit logs (date range)
- `POST /dogs/{dog_id}/vomiting` -- log vomiting/regurgitation (type, time_since_meal, datetime, notes)
- `PATCH /vomiting/{id}` -- edit
- `DELETE /vomiting/{id}` -- delete

**Itchiness Logging:**
- `GET /dogs/{dog_id}/itchiness` -- list itchiness logs (date range)
- `POST /dogs/{dog_id}/itchiness` -- log itchiness (score, body_areas, photo, notes)
- `PATCH /itchiness/{id}` -- edit
- `DELETE /itchiness/{id}` -- delete

**Symptom Log:**
- `GET /dogs/{dog_id}/symptoms` -- list symptom logs (date range, optional type filter)
- `POST /dogs/{dog_id}/symptoms` -- log symptom (type, severity, photo, notes)
- `PATCH /symptoms/{id}` -- edit
- `DELETE /symptoms/{id}` -- delete

**Accidental Exposure:**
- `GET /dogs/{dog_id}/exposures` -- list exposures (date range)
- `POST /dogs/{dog_id}/exposures` -- log exposure (description, known_ingredients, datetime)
- `PATCH /exposures/{id}` -- edit
- `DELETE /exposures/{id}` -- delete

**Medications:**
- `GET /dogs/{dog_id}/medications` -- list medications (active and past)
- `POST /dogs/{dog_id}/medications` -- add medication (name, dosage, start_date, reason, notes)
- `PATCH /medications/{id}` -- update (set end_date, adjust dosage, etc.)
- `DELETE /medications/{id}` -- delete

**Reports / Analysis:**
- `GET /dogs/{dog_id}/timeline` -- timeline data for charting (all log types, food periods, medications, date range)
- `GET /dogs/{dog_id}/correlations` -- ingredient correlation analysis (date range, transition_buffer_days, exposure_buffer_days)
- `GET /dogs/{dog_id}/export` -- structured dump of ALL data for LLM consumption (feeding history with ingredients, all log types, medications, exposures)

**Photos:**
- `POST /photos/upload` -- upload photo (multipart), returns photo_url. Used by poop, itchiness, and symptom log forms.

### MCP Server (Phase 2 -- Later)

A Python MCP server that gives Claude direct access to the dog's data. Calls the Next.js API routes over HTTP (authenticated via API key or service token). Tools: get_dogs, get_active_foods, get_feeding_history, get_poop_logs, get_itchiness_logs, get_ingredient_correlations, get_product_details, search_products, compare_food_periods.

Not needed initially. The API routes + export button covers LLM analysis for now.

### Photo Storage (Deferred -- Build Infrastructure First)

Photo uploads (poop, itchiness, symptoms) are deferred from initial launch but coming immediately after. The data model includes photo_url fields on all relevant log types, and the upload endpoint is spec'd. Build the `/photos/upload` endpoint and storage infrastructure as part of the initial codebase so adding the camera button to each form is a one-line frontend change.

Storage: local filesystem (`/data/photos/{dog_id}/{date}/{uuid}.jpg`), served via Next.js API route or static handler. Auto-resize on upload (max 1200px wide, sharp library). Can migrate to S3/R2 later.

### Scraping Pipeline Integration

The scraper is a separate Python project, not part of the Next.js deploy. Run locally when you need to add or refresh product data (infrequently). It writes to the same PostgreSQL database the Next.js app reads from.

The build script connects directly to PostgreSQL (production or local) and upserts products. Each run is idempotent -- upserts on product name + brand, updates ingredients/images if changed. Products that disappear from the source are marked `is_discontinued = true` (never deleted). Products that reappear get `is_discontinued = false` reset.

The Drizzle schema in the Next.js project defines the product tables (brands, products, ingredients, product_ingredients) as read-only from the app's perspective. The Python build script uses raw SQL (psycopg2) matching the same schema.

### Deployment

Single Docker Compose setup:
- **app**: Next.js (one container -- serves UI + API)
- **db**: PostgreSQL

For personal use: runs on the VPS alongside other services, or locally on the Mac. No CDN, no edge caching, no scaling concerns. MCP server runs locally only (not containerized).

**Scheduled tasks:** VPS system crontab calls protected API endpoints (shared secret via env var, not publicly exposed). Pollen collection: `0 6 * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/pollen` — runs once daily at 6am, fetches Ambee data for each unique user city, stores in pollen_logs.

## Open Questions

- [ ] Cartoon/vector poop scale illustrations: commission or find open source?

## Future Considerations

These are out of scope for the initial build. The priority is food/poop logging and ingredient correlation -- everything below comes after that works well.

- **General vet/health timeline**: vaccinations, vet visits, health issues, surgical history. A unified timeline alongside the food/symptom data
- **Document uploads**: PDFs for proof of vaccination, vet records, lab results. Attached to timeline events
- **Weight history**: track weight over time (currently just a single field on Dog)
- **DogShare**: invite caretakers by email with editor/viewer roles (currently shared logins)
- **iOS app**: SwiftUI client hitting the same API routes
- **MCP server**: Claude queries the data directly instead of copy-paste export
- **Vet export**: formatted reports for vet visits once data quality is proven
- **Custom food builder**: on the food directory page for edge cases (raw diets, home-cooked, niche brands not yet scraped)
- **URL-based product import**: user pastes a Chewy.com or PetSmart.ca product URL, backend scrapes it on-the-fly using existing `parse_chewy_nutrition`/PetSmart RSC extraction and auto-generates a product record (name, ingredients, GA, calories, image). Covers "my dog eats a brand you don't have" without manual data entry or waiting for a full brand scraper
- **Barcode scanning**: scan UPC barcode on a dog food bag with phone camera to instantly find the product in the DB. Scrapers already capture UPC/GTIN13 where available (e.g., PetSmart JSON-LD `gtin13` field — Authority has 76 UPC codes across 41/45 products). Needs: UPC column on products table, camera API integration (native or web), and fallback to text search when barcode isn't in DB
- **Reformulation tracking**: snapshot ingredient list on FeedingPeriod creation so historical correlations survive product reformulations. Low priority — reformulations are rare and the scraper would need to re-run to pick them up anyway
- **Transition mode**: guided food transition wizard. User enters old plan, new plan, and transition duration (X days). App auto-generates date-range plans with graduated ratios (75/25 → 50/50 → 25/75 → 100% new). Builds on existing plan model — no schema changes needed, just a UX layer that creates the intermediate plans automatically.
- **Meal-level logging**: add per-meal breakdown using the reserved `meal_slot` column on FeedingPeriod (breakfast/lunch/dinner/snack). Enables tracking different foods at different meals, per-meal quantities, and "same for all meals" shortcut. Day-level tracking is sufficient for MVP since correlation only needs "which products were active on date X."
- **Medication database**: structured medication DB (like the food DB) for common veterinary meds. Enables dosage validation, interaction warnings, and medication-level correlation. Free-text works for MVP.

