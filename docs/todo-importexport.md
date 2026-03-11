# Database Sync (Dev ↔ Prod)

## Purpose

Keep dev and prod databases in sync via pg_dump/pg_restore shell scripts. Not a user-facing feature.

## Scripts

Two scripts in `scripts/`:

- **`db-push.sh`** — dump local user-data tables, restore to prod (one-time initial seed)
- **`db-pull.sh`** — dump prod user-data tables, restore to local (ongoing sync)

## Tables to sync

User-data tables only (product tables are loaded by build.py independently):

- `dogs`
- `feeding_periods`
- `food_scorecards`
- `poop_logs`
- `itchiness_logs`
- `treat_logs`
- `medications`
- `daily_checkins`
- `symptom_logs`
- `vomit_logs`
- `accidental_exposures`
- `daily_weather` (when weather feature lands)
- `daily_pollen` (when weather feature lands)

Auth tables (`user`, `session`, `account`, `verification`) are NOT synced — each environment has its own auth.

## Approach

- `pg_dump --data-only --clean` with explicit table list
- `--clean` truncates before insert (full replacement, not merge)
- Connection strings from env vars (`DATABASE_URL` for local, `PROD_DATABASE_URL` for prod)

## When

Build these scripts when launching prod.
