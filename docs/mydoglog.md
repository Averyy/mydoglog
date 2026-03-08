# MyDogLog

> Domain: mydoglog.ca

## Overview

A web app for Canadian dog owners to track what their dog eats and how their dog poops, with the goal of identifying which ingredients agree or disagree with sensitive stomachs. Backed by a scraped database of 1,260+ Canadian dog food products (ingredients, guaranteed analysis, photos, brand info) so users pick from a list rather than entering data manually. Not a medical tool, not an elimination diet protocol — just structured logging with ingredient-level correlation reporting.

## The Problem

Dogs with sensitive stomachs go through endless food switches. Owners try different kibbles, wet foods, and treats over weeks and months but track nothing systematically. By the time they notice a pattern (or don't), they can't remember what was fed when. Vets ask "what have you tried?" and owners shrug.

The current approach: buy food, feed it for a while, eyeball the poop, switch if it seems bad, repeat. No data, no correlation, no memory.

### Why This Is Harder Than It Looks

The real challenge isn't logging — it's that food sensitivities are a multi-variable, delayed-reaction problem that humans are terrible at reasoning about intuitively:

**Delayed reactions make mental tracking useless.** GI reactions take 1-7 days to appear. Skin/itch reactions take weeks to months. By the time symptoms change, the owner has forgotten what changed and when. A food that "seemed fine" for 3 days might cause problems on day 5, and by then the owner has already blamed something else.

**Environmental allergies masquerade as food allergies.** 80-95% of canine atopic dermatitis is environmental, not food-driven. A dog's itching may worsen on chicken in March and improve on hydrolyzed food over winter — but that's seasonal allergens, not chicken. Without tracking both symptoms AND environmental context (pollen, temperature, season changes) on the same timeline, owners and even vets misattribute environmental reactions to food. See `peaches.md` for a lived example: months of food trials that appeared to confirm food allergy, but the pattern only made sense once environmental timing was visible.

**Medications confound everything.** A dog on Zenrelia (JAK inhibitor) for allergies may develop worsening stool — is it the food or the drug's #1 side effect? Without tracking medication periods alongside food and symptoms on the same timeline, it's impossible to distinguish. Peaches' gradual stool decline on a hydrolyzed diet coincided with spring allergen season AND months on Zenrelia — three variables, one symptom.

**Ingredient-level analysis requires data no human can hold in their head.** A dog has eaten 5 foods over 6 months. Each food has 30-60 ingredients. Some ingredients overlap between foods, some don't. The dog did well on foods 1 and 3 but poorly on foods 2 and 4. Which of the 200+ unique ingredients across those foods correlate with the bad periods? This is a database query, not an intuition exercise.

**Treats and supplements break elimination diets.** The #1 reason elimination diet trials fail is unauthorized treats, flavored medications, and supplements containing undeclared proteins. Owners forget to mention the daily Greenie, the chicken-flavored heartworm chew, or the peanut butter pill pocket. Without logging every input, correlation is impossible.

## Target Audience

Canadian dog owners with dogs that have sensitive stomachs or suspected food sensitivities. Specifically owners who are past the "emergency diarrhea" phase and into the "trying to optimize from good to great" phase — the dog is generally OK but poop quality varies and they want to figure out what works best.

Primary user: me and Peaches (see `peaches.md`). Optimizing for our own use case first.

## What It Does

### Canadian Dog Food Database

The foundation. 1,260+ products across 16 brands (see `ref-dog-food-canada.md`), scraped from manufacturer and retailer websites. For each product: name, brand, type, channel (retail/vet), ingredients (parsed and normalized to AAFCO families), guaranteed analysis, calorie content, images, size variants. Users pick from a searchable list rather than entering data manually.

### Structured Daily Logging

Three entry points, one daily record:

1. **Daily Check-in** — unified form: routine (food + supplements + meds, pre-filled from template), stool score (Purina 1-7), itchiness (1-5), treats. Once a day, confirms what the dog ate and how they did.
2. **Quick Poop** — 3-second in-the-moment flow: pick score + save. For logging individual events throughout the day.
3. **Quick Treat** — 3-second flow: pick product + save.

The **routine template** (food + supplements + medications) pre-fills the daily log. On days the user doesn't open the app, the template is the implicit record. Quick entries assume the routine is unchanged.

### Pages

| Page | Route | Purpose |
|------|-------|---------|
| **Home** | `/` | Quick-log grid (check-in, stool, itch, treat) + chronological log feed |
| **Food** | `/dogs/[id]/food` | Active routine management + food history with inline scorecards |
| **Insights** | `/dogs/[id]/insights` | Ingredient correlation analysis (GI + skin tracks) |
| **Settings** | `/settings` | Dog management, account settings |

**Home** shows the quick-log 2x2 grid and a chronological feed of recent manual entries (poop, itch, treat, check-in). No summary stats, no routine preview — just logging and recent history.

**Food** merges routine management and food history into one page. Active plan card at the top (food + supplements + medications + edit routine button). Below: chronological list of past plan groups with inline scorecard display. Active plans derive scores from daily logs. Backfilled periods require mandatory scorecard entry (poop quality range + itch severity range).

**Insights** shows ingredient-level correlation results with signal mode toggle (stool/itch/both). Expandable ingredient rows with product cross-reference and cross-reactivity info.

### Two-Track Correlation Engine

Ingredient-level correlation across all feeding periods, computed separately for skin/itch and GI/poop because they have different triggers, mechanisms, and timelines (see `ref-ingredient-analytics.md`):

- **Skin/itch track:** protein-focused, cross-reactivity-aware, 8-week minimum evaluation, pollen-discounted
- **GI/poop track:** broader trigger pool (proteins + fats + additives + fiber + legumes), 2-4 week evaluation, ingredient-splitting detection, additive position-weight overrides

Results categorized as problem / tolerated / inconclusive per ingredient, with confidence based on data volume and consistency.

### Dashboard Timeline (Phase 4)

The analytical view that ties everything together — a time-series graph (poop scores, itch scores, temperature, pollen) over Gantt-style bars (food periods, medication periods, supplement periods). Read them together vertically to correlate score changes with food/med/environment/season transitions. This is the view that would have made Peaches' environmental allergy pattern obvious months earlier.

### LLM Export

Structured data dump of a dog's full history (feeding periods with ingredients, all log types, medications) for pasting into Claude or any LLM. Bridges the gap until an MCP server exists.

## Non-Goals

- Not a vet consultation tool
- Not an elimination diet protocol guide
- Not a general pet health tracker (no vaccines, appointment scheduling)
- Not a social platform or community
- No AI recommendations on what to feed — just data and correlation
- Not trying to be a product/business initially — personal utility first

## Architecture

See `CLAUDE.md` for development rules and patterns.

- **Next.js monolith** (TypeScript, React, Better Auth, Drizzle, PostgreSQL, shadcn/ui, Tailwind) — pages + API routes + React UI, single Docker container
- **Scraping pipeline** — separate Python CLI (`scraper/`), runs locally, writes product tables to the same PostgreSQL. See `scraper/README.md`
- **Two write paths, one DB** — scrapers write product tables (read-only from the app), Next.js writes user/log tables. Never cross.

## Data Model (Conceptual)

**Product side (scraper-managed, read-only from app):**
- Brands → Products → ProductIngredients → Ingredients (with families, source groups, form types, cross-reactivity groups)

**User side (app-managed):**
- Users → Dogs → all logging tables
- **FeedingPeriods** grouped by `plan_group_id` (a routine = a set of concurrent products)
- **FoodScorecards** attach to plan groups — only used for backfills (mandatory poop+itch ranges). Active plans derive scores from daily logs.
- **PoopLogs, ItchinessLogs, TreatLogs, VomitLogs, SymptomLogs, Medications, AccidentalExposures** — all have `date` (required) + `datetime` (nullable). 1 entry/day = daily summary, 2+ = individual events.
- **PollenLogs** — 1 per city per day, auto-collected

### Poop Scoring

Purina Fecal Scoring Chart (1-7), the de facto North American veterinary standard. Used by most vet school teaching hospitals and the majority of published veterinary nutrition research. Score 2 = ideal.

1. Hard pellets (constipation)
2. Firm, segmented, easy pickup (ideal)
3. Log-shaped, moist, leaves residue
4. Soft, loses form on pickup
5. Very moist piles, some shape
6. Texture visible but no shape
7. Watery liquid (diarrhea)

## Phases

See `todo-phases.md` for the living checklist. Phases 0-3.6 (data prep, foundation, core loop, analysis, scorecard simplification, page reorg) are complete. Phase 4 focuses on pollen/weather/seasons, medication tracking, the dashboard timeline, and LLM export. Phase 5 adds pack-based sharing (multi-user access + public read-only links).

## Reference Docs

| Doc | Purpose |
|-----|---------|
| `CLAUDE.md` | Development rules, architecture, critical constraints |
| `todo-phases.md` | Living implementation checklist |
| `ref-dog-food-canada.md` | Brand scraper status and technical reference |
| `ref-ingredient-analytics.md` | Research-backed correlation methodology (two-track model, trigger categories, timelines, confounders) |
| `todo-medications.md` | Medication catalog spec (52 meds across 5 categories) |
| `todo-sharing.md` | Pack sharing spec (multi-user access + public links) |
| `todo-scrapetype.md` | Product type/format split spec |
| `todo-importexport.md` | Dev-only dog data export/import spec |
| `todo-pagereorg.md` | Page reorganization spec (completed, kept as reference) |
| `peaches.md` | Primary user's dog profile, food history, current issues, vet notes |
| `mydoglog-branding.md` | Design system, color palette, typography, component patterns |
| `ref-mar2026-myvetstore-pricing.md` | Ground truth for vet product scraper validation |
