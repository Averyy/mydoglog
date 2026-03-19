# MyDogLog

> [mydoglog.ca](https://mydoglog.ca) — Know what works.

Track what your dog eats and how they poop. Each food has 30-60 ingredients and GI reactions take days to show up — you can't figure this out in your head. MyDogLog correlates at the ingredient level across every food your dog has tried, surfacing which specific ingredients correlate with good or bad stool and skin outcomes.

Scraped database of **1,830+ Canadian dog food products** (30 brands) so you pick from a list instead of typing ingredients by hand.

## Features

- **Structured daily logging** — Daily check-in (routine + stool score + itchiness + treats), quick poop (3-second score entry), and quick treat flows
- **Routine templates** — Pre-fill daily logs with the dog's current food + supplements. Inactive days use the template as the implicit record
- **Canadian dog food database** — 1,830+ products from 30 brands (Royal Canin, Purina, Hill's, Acana, Orijen, Blue Buffalo, and more), scraped from manufacturer and retailer sites
- **Ingredient-level correlation** — Two-track engine (skin/itch and GI/poop) analyzes ingredients across all feeding periods, with cross-reactivity awareness and pollen discounting
- **Medication tracking** — 67-drug catalog across 5 categories (allergy, parasite, GI, pain, steroid) with side effect data and dosing intervals
- **Pollen & mold tracking** — Daily environmental data collection with automatic correlation discounting for seasonal confounders
- **Food transitions** — Gradual 0-7 day transition schedules with correlation buffer handling
- **LLM export** — Structured data dump of a dog's full history for pasting into Claude or any LLM
- **Purina 1-7 fecal scoring** — The de facto North American veterinary standard (score 2 = ideal)

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (TypeScript, React 19) |
| Auth | Better Auth |
| Database | PostgreSQL 16 (Drizzle ORM) |
| UI | shadcn/ui, Tailwind CSS 4, Recharts |
| Scraper | Python (uv), wafer-py |
| Deployment | Docker, GitHub Actions, VPS (Caddy reverse proxy) |
| Testing | Vitest (app), pytest (scraper) |

## Architecture

Two write paths, one database:

- **Next.js app** — reads product tables, writes user/log tables (auth, dogs, feeding periods, poop logs, itchiness logs, treat logs, medications, scorecards, pollen)
- **Python scraper CLI** (`scraper/`) — writes product tables (brands, products, ingredients, cross-reactivity). Read-only from the app. Never cross.

```
src/           → Next.js app (pages, API routes, components, correlation engine)
scraper/       → Python scraper CLI (per-brand scrapers, build pipeline, DB seeder)
drizzle/       → SQL migrations
scripts/       → Docker startup, deployment helpers
docs/          → Product context, brand reference, ingredient research, branding guide
public/        → Product images, favicons
```

## Development

```bash
yarn db:start         # Start dev PostgreSQL (Docker, port 5433)
yarn install && yarn db:migrate
yarn dev              # Dev server on port 3847
```

Scraper (Python, requires [uv](https://docs.astral.sh/uv/)):

```bash
cd scraper
uv run python scrapers/{brand}.py   # Scrape a brand
uv run python build.py              # Upsert all products + process images
```

## License

[AGPL-3.0](LICENSE)
