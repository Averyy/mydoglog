# MyDogLog

Dog food + digestive health tracking app. Scraped Canadian dog food database → food logging → poop/symptom/allergy scoring → ingredient correlation analysis.

## Architecture

> Domain: mydoglog.ca

- **Next.js monolith** (TypeScript, React, Better Auth, Drizzle, PostgreSQL, shadcn/ui, Tailwind) — pages + API routes + React UI, single Docker container. Same patterns as `~/Code/awire/`
- **Scraping/product pipeline** — separate Python CLI (`scraper/`), not automated. Uses `wafer-py`. Scrapes → intermediate JSON in `scraper/data/brands/` → `build.py` loads to PostgreSQL (pcbparts pattern). One scraper file per source. Same patterns as `~/Code/pcbparts-mcp` scraper.
- **Two write paths, one DB** — scrapers write product tables, Next.js writes user/log tables. Never cross
- Product tables are **read-only** from the app's perspective
- Discontinued products are **only deleted** if no user has selected them — `is_discontinued = true`, historical data preserved if needed

## Critical Rules

- **NEVER apply display-time bandaids for bad source data** — fix data quality issues in the scraper/build pipeline, not with runtime string manipulation in UI components. Fix at the source.
- **NEVER blame external services** for issues. The problem is in THIS codebase
- **NEVER create mock data or simplified components** unless explicitly told to
- **NEVER replace existing complex components with simplified versions** — fix the actual problem
- **ALWAYS run `yarn build`** before considering code changes complete
- **ALWAYS add explicit types** to function parameters and return types
- Schema changes require `yarn db:generate` and local migration testing
- **ALWAYS** think critically during discussions. 
- **NEVER** praise the user or compliment them except in rare circumstances where its deserved. It's a waste of tokens.

## Data Entry Architecture

Three entry points, one page:

| Entry | Purpose | Frequency | Container |
|---|---|---|---|
| **Daily Check-in** | Routine + Stool + Itchiness + Treats | Once/day | Drawer (mobile) / Dialog (desktop) |
| **Quick Poop** | Score + timestamp | In-the-moment, multiple/day | Drawer / Dialog |
| **Quick Treat** | Product + timestamp | In-the-moment | Drawer / Dialog |
| **Food Scorecard** (page) | Review/rate food history | Occasional | Full page (`/dogs/[id]/food-scorecard`) |

- **Routine template** replaces "feeding plan" — includes food + supplements + medications. Pre-fills the daily log's Routine section. "Apply going forward" checkbox updates the template. Days the user doesn't open the app, the template is the implicit record.
- **No auto-logging** — meal data alone without outcome data (poop/itch) is useless. When a user saves a daily check-in, meals get confirmed for that day. Inactive days rely on the routine template for correlation.
- **Quick entries** — Quick Poop and Quick Treat are 3-second flows for in-the-moment use. If only quick entries are logged on a day, the routine is assumed unchanged.
- **Bottom nav `+` button** opens a selector: Daily Check-in / Poop / Treat.
- **Responsive container** — shadcn Drawer (slide-up) on mobile, Dialog (modal) on tablet/desktop. Same content component shared between both.

## Database

- All log tables have `date` (required) + `datetime` (nullable). 1 entry/day = daily summary, 2+ = individual events
- Only the scraper creates Ingredient records — never from user input
- Poop uses Purina 1-7 fecal scoring everywhere (PoopLog AND FoodScorecard). Score 2 = ideal. This is the de facto North American veterinary standard.

## Scraper (Python)

- Package manager: `uv` (never pip), all runs via `uv run`
- Intermediate JSON in `scraper/data/brands/` — inspect before loading
- `python build.py` upserts on product name + brand, idempotent
- Products disappearing from source → `is_discontinued = true` (never deleted)
- **NEVER merge, combine, or approximate product data** — this is a health/medical tracking app. Each product must have its own exact ingredient list, GA, and calorie data scraped from its specific product page. Variety packs / bundles / assortments that contain multiple products with different formulas must be SKIPPED (the individual products are scraped separately). Never take one product's data and apply it to another.
- For wafer-py instructions use `https://raw.githubusercontent.com/Averyy/wafer/refs/heads/main/llms.txt`
- Refer to `docs/dog-food-brands-canada.md` for a list of dog food brands to scrape and details (continually update it)
- Refer to `docs/myvetstore-products.md` for a manually scraped list of vet store specific food items as a fact check.
- Refer to `docs/dog-food-ingredients.md` for ingredient normalization strategy (AAFCO names, families/aliases)

## Testing

- Vitest for Next.js app, `uv run pytest` for scraper
- **ALWAYS run tests before committing** — failing tests = no commit
- Test correlation logic, parsing, auth guards, input validation — not trivial getters or library behavior

## Frontend & Design

- ALWAYS refer to `docs/mydoglog-branding.md` first before doing frontend or design work
- shadcn/ui for components and tables. Tailwind styling. Don't create a component from scratch unless it doesn't exist. Ask the user for confirmation.
- **Anything repeated across pages MUST be a component** — never hardcode the same markup twice. Style overrides belong at the component level (props/variants), not inline.
- **NEVER use inline hex colors or opacity fractions** (e.g. `bg-primary/[0.08]`, `bg-[#f0f3f1]`, `hover:bg-black/[0.02]`). ALL colors MUST reference CSS variables defined in `globals.css` and registered in `@theme inline`. If a needed color doesn't exist, define a new token first (`:root` + `.dark` + `@theme inline`), then use it via Tailwind (`bg-item-hover`, `bg-item-active`, etc.).
- Mobile responsive essential (logging happens on phone in the yard)
- ALWAYS invoke the `frontend-design` skill for UI work or UI review

## Web Fetching & Research

**ALWAYS use fetchaller MCP tools** (`mcp__fetchaller__*`) instead of WebFetch or WebSearch. Only fallback to `curl` or `httpx` if its raw data or api endpoints. 