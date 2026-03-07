# MyDogLog

> Domain: mydoglog.ca

Dog food + digestive health tracking app. Next.js monolith (TypeScript, React, Better Auth, Drizzle, PostgreSQL, shadcn/ui, Tailwind) + separate Python scraper CLI. Same app patterns as `~/Code/awire/`, same scraper patterns as `~/Code/pcbparts-mcp`. See `docs/mydoglog.md` for product context.

## Critical Rules

- **NEVER apply display-time bandaids for bad source data** — fix in the scraper/build pipeline, not with runtime string manipulation in UI components
- **NEVER blame external services** for issues. The problem is in THIS codebase
- **NEVER create mock data or simplified components** unless explicitly told to
- **NEVER replace existing complex components with simplified versions** — fix the actual problem
- **ALWAYS run `yarn build`** before considering code changes complete
- **ALWAYS add explicit types** to function parameters and return types
- Schema changes require `yarn db:generate` and local migration testing
- **ALWAYS** think critically during discussions.
- **NEVER** praise the user or compliment them except in rare circumstances where its deserved. It's a waste of tokens.

## Dev Environment

- Dev port: 3847 (`yarn dev`)
- **Database:** PostgreSQL in Docker container `mydoglog-db-dev`, port 5433
  - `docker exec mydoglog-db-dev psql -U mydoglog -d mydoglog -c "SQL"`

## App Patterns

- **Two write paths, one DB** — scrapers write product tables (read-only from app), Next.js writes user/log tables. Never cross.
- **Discontinued products:** `is_discontinued = true` when they disappear from scrape source. Delete if no user references them; preserve if any feeding period or scorecard exists.
- All log tables have `date` (required) + `datetime` (nullable). 1 entry/day = daily summary, 2+ = individual events.
- Only the scraper creates Ingredient records — never from user input.
- Poop uses Purina 1-7 fecal scoring everywhere (PoopLog AND FoodScorecard). Score 2 = ideal.
- **Supplements/toppers are small quantities** (~25-30g/meal). Their scorecard scores are essentially weighted averages of the primary foods they're paired with, not independent signals. Interpret topper scores as "present during" not "caused by."
- **Probiotics are excluded from ingredient correlation** — their ingredients are therapeutic (bacterial strains), not nutritional triggers. At trace quantities their scores just mirror paired foods. Products with `type = "probiotic"` are skipped in the correlation engine.
- **Responsive containers** — shadcn Drawer (slide-up) on mobile, Dialog (modal) on desktop. Same content component shared between both.
- **Routine template** pre-fills daily log. Inactive days use the template as the implicit record for correlation.

## Scraper (Python)

- Package manager: `uv` (never pip), all runs via `uv run`
- Intermediate JSON in `scraper/data/brands/` → `build.py` upserts to PostgreSQL (idempotent, on product name + brand)
- Products disappearing from source → `is_discontinued = true`
- **NEVER merge, combine, or approximate product data** — each product must have its own exact ingredient list, GA, and calorie data. Variety packs / bundles must be SKIPPED.
- For wafer-py instructions use `https://raw.githubusercontent.com/Averyy/wafer/refs/heads/main/llms.txt`
- Refer to `docs/ref-dog-food-canada.md` for brand list and scraper details
- Refer to `docs/ref-mar2026-myvetstore-pricing.md` for vet store product ground truth
- Refer to `scraper/data/ingredient_families.json` for ingredient normalization (AAFCO names, families/aliases)

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