# Weather & Environmental Tracking

## Overview

Daily collection of weather data and pollen levels per dog location. Weather comes from Open-Meteo API (free, no key). Pollen comes from scraping The Weather Network's Aerobiology Research Laboratories data (the only measured pollen source in Canada, 30 stations, 80% accuracy). Both feed into the dashboard timeline and correlation engine.

## Why

Peaches' Feb 18 2026 flare (stool 3→4→6, itch increase) correlated exactly with the first major thaw in St. Catharines — no food or med changes. Environmental allergens (mold from snowmelt, early tree pollen) are the likely trigger. Without weather/pollen on the same timeline as symptoms, this pattern is invisible.

## Dog Location — Schema Changes

### Current state
- `dogs.location` — free text field (e.g. "St. Catharines")
- `dogs.postalCode` — free text field
- Both used loosely: pollen cron queries by `dogs.location` as Ambee place name
- `dog-form.tsx` has fields for both

### New state
Replace `location` and `postalCode` with a single boolean:

```
dogs.environmentEnabled — boolean, default false
```

Drop `dogs.location` and `dogs.postalCode` after migration.

When `environmentEnabled = true`, the cron collects:
- **Weather** from Open-Meteo at St. Catharines coordinates (43.16, -79.24)
- **Pollen** from TWN Niagara page (`https://www.theweathernetwork.com/en/city/ca/ontario/niagara/pollen`)

Both hardcoded for now. No location picker, no stations table. When multi-location is needed, promote to a configurable system then.

### Aerobiology stations (30 total, for future reference)

Alberta: Calgary, Edmonton. BC: Victoria, Vancouver, Kelowna. Manitoba: Winnipeg, Brandon. Saskatchewan: Prince Albert, Regina, Saskatoon. Ontario: Thunder Bay, Sudbury, Barrie, Brampton, Toronto, Hamilton, Kingston, Ottawa, London, Windsor. Quebec: Montreal, Quebec City, Sherbrooke. NB: Fredericton, Moncton, Saint John. NS: Halifax. NL: St. John's. PEI: Charlottetown.

### Dog form UI changes

- Remove "Location" and "Postal code" fields
- Add a single checkbox: **"Weather and pollen"** with subtext **"St. Catharines, ON"**
- Settings page: show "Weather and pollen: On/Off" instead of location text

## `daily_weather` table

One row per station per day. Collected by cron from Open-Meteo.

```
daily_weather:
  id: text PK
  location: text (e.g. "st-catharines-on") — Open-Meteo at 43.16, -79.24
  date: date
  tempHighC: numeric
  tempLowC: numeric
  precipMm: numeric
  humidityAvgPct: numeric nullable
  createdAt: timestamp
```

Unique constraint on `(location, date)`. Upsert-safe (re-running for same date overwrites).

## `daily_pollen` table

Replaces existing `pollen_logs` table. One row per station per day. Scraped from The Weather Network (Aerobiology Research Laboratories data, 30 physical monitoring stations, 80% accuracy).

### TWN pollen coverage

TWN serves pollen data for many Canadian cities, not just the 30 Aerobiology monitoring stations. TWN interpolates from the nearest Aerobiology station but adjusts allergen rankings by region. For example, on March 8 2026:
- **Hamilton:** Moderate — Cedar/Thuja, Maple, **Aspen/Poplar**
- **Niagara:** Moderate — Maple, **Elm**, Cedar/Thuja

Same overall level, but different species ranking. Niagara is closer to St. Catharines than Hamilton and reflects local tree populations better. TWN has pages for virtually any Canadian city/town (e.g. `ca/ontario/niagara`, `ca/ontario/st-catharines`) — though St. Catharines itself shows "No Data" while Niagara shows data.

**Implication:** The `twn_pollen_slug` on weather stations should use the most specific available TWN page, not necessarily the Aerobiology monitoring station city. For Hamilton station, use `ca/ontario/hamilton`. But we could also add a Niagara/St. Catharines station with `ca/ontario/niagara` as the pollen slug since TWN serves interpolated data for it.

### Pollen level scale (from TWN/Aerobiology)

| Index | Label | Grains/m³ | Description |
|-------|-------|-----------|-------------|
| -1 | No Data | — | Pollen data is not available for this location |
| 0 | None | 0 | — |
| 1 | Low | 1-20 | The pollen forecast is based on actual number of particles per cubic metre of air |
| 2 | Moderate | 21-80 | " |
| 3 | High | 81-200 | " |
| 4 | Very High | >200 | " |

TWN does not expose exact grain counts — only the categorical level. The ranges above define what each level means. Sufficient for correlation (high vs low pollen days against symptom scores).

### Schema

```
daily_pollen:
  id: text PK
  location: text (e.g. "niagara-on") — scraped from https://www.theweathernetwork.com/en/city/ca/ontario/niagara/pollen
  date: date
  levelIndex: integer (-1 to 4, see scale above)
  levelText: text (none/low/moderate/high/very_high/no_data)
  grainRange: text nullable (e.g. "21-80 grains/m³" — from legend, not exact measurement)
  topAllergens: jsonb (array of species names, e.g. ["Boxelder, Maple", "Elm", "Cedar, Cypress, Juniper, Thuja"])
  createdAt: timestamp
```

Unique constraint on `(location, date)`. Upsert-safe.

### Migration: drop `pollen_logs`

Existing `pollen_logs` table (Ambee-based) has no production data worth keeping. Drop it and the cron route that feeds it (`src/app/api/cron/pollen/route.ts`).

## Derived Signals — Freeze-Thaw Events

Computed from `daily_weather` data, not stored separately. Pure functions in a utility module.

### Freeze-thaw day
A day where `tempLowC < 0` AND `tempHighC > 0`. These days pump mold spores — ground thaws during day, refreezes at night.

### Thaw onset
First date in a sustained stretch (7+ days) where `tempHighC > 0` after a winter period where highs were consistently below 0. This is the snowmelt trigger — the event that correlates with Peaches' Feb 18 flare.

### Rain-on-thaw
Precipitation on a freeze-thaw day or during thaw onset window. Accelerates mold/allergen release.

### Implementation
- `src/lib/weather/freeze-thaw.ts` — pure functions, well-tested
- Input: array of `{ date, tempHighC, tempLowC, precipMm }`
- Output: array of `{ date, isFreezThawDay, isThawOnset, isRainOnThaw }`
- Unit tests with synthetic data covering: normal winter, thaw event, false spring (brief warm spell that reverts), gradual spring transition

## Season Labels

Coarse human-readable labels derived from temperature transitions. Used as confounder tags on the correlation timeline, not as analytical signals.

### Algorithm
State machine over 7-day rolling average of daily highs:
- **Winter → Spring:** rolling avg crosses above 5C, sustained 10+ days
- **Spring → Summer:** rolling avg crosses above 20C, sustained
- **Summer → Fall:** rolling avg drops below 18C, sustained
- **Fall → Winter:** rolling avg drops below 3C, sustained

### Implementation
- `src/lib/weather/seasons.ts` — pure function
- Input: array of daily weather records for a station
- Output: array of `{ startDate, endDate, season }` periods
- Thresholds are constants, not per-station yet. Can add per-station config later if needed (St. Catharines vs Calgary differ).
- Computed at query time, not stored. Cache if performance matters.

## Cron Endpoint

Single cron route: `POST /api/cron/weather`

### Flow
1. Verify `CRON_SECRET` header
2. Check if any dog has `environmentEnabled = true` — if none, skip
3. **Weather:** Fetch from Open-Meteo for St. Catharines (43.16, -79.24). Upsert into `daily_weather`.
4. **Pollen:** Scrape `https://www.theweathernetwork.com/en/city/ca/ontario/niagara/pollen`. Parse level + top allergens. Upsert into `daily_pollen`.
5. Return `{ weather: { processed, skipped }, pollen: { processed, skipped } }`

### Open-Meteo API call
```
GET https://api.open-meteo.com/v1/forecast
  ?latitude=43.16&longitude=-79.24
  &daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean
  &timezone=America/Toronto
  &past_days=1
```

`past_days=1` ensures yesterday's actuals are captured (forecasts get replaced with observations after the fact).

### TWN pollen scrape
```
GET https://www.theweathernetwork.com/en/city/ca/ontario/niagara/pollen
```

Parse: level index (-1 to 4), level text, grain range, top allergens list. Page is Next.js SSR with data in RSC flight payload. If the page shows "No Data" (winter/off-season), store `levelIndex: -1` with empty allergens.

### Schedule
Run daily at ~8:00 AM ET. Weather data updates overnight, pollen forecasts update in the morning.

### Backfill
On first enable, backfill historical weather from Open-Meteo Historical API (supports date ranges, has data from 1940+). No pollen backfill possible — TWN only shows current/forecast, not historical.

```
GET https://archive-api.open-meteo.com/v1/archive
  ?latitude=43.16&longitude=-79.24
  &start_date={firstFeedingPeriodDate}&end_date={yesterday}
  &daily=temperature_2m_max,temperature_2m_min,precipitation_sum
  &timezone=America/Toronto
```

## Cleanup

- Delete `src/app/api/cron/pollen/route.ts` (Ambee-based, being replaced)
- Drop `pollen_logs` table
- Remove `AMBEE_API_KEY` from env
- Remove `dogs.location` and `dogs.postalCode` columns
- Update `dog-form.tsx` — remove location/postal fields, add "Weather and pollen" checkbox
- Update `settings-client.tsx` — show environment on/off instead of location text
- Update `src/app/api/dogs/route.ts` and `src/app/api/dogs/[id]/route.ts` — handle `environmentEnabled`
- Update `src/lib/correlation/query.ts` — query `daily_weather`/`daily_pollen` by hardcoded location instead of `dogs.location`

## Build Order

1. Add `environmentEnabled` to dogs, drop `location` + `postalCode`, drop `pollen_logs` table (one migration)
2. Dog form UI — remove location/postal, add "Weather and pollen" checkbox with "St. Catharines, ON" subtext
3. `daily_weather` table + Open-Meteo cron
4. `daily_pollen` table + TWN Niagara scraper
5. Historical weather backfill
6. Freeze-thaw detection utility + tests
7. Season computation utility + tests
8. Delete old Ambee pollen cron route

Steps 3-4 are the same cron endpoint. Steps 6-7 are pure functions with no DB dependency.

## Future

- Multi-location support (weather stations table, location picker per dog)
- Google Pollen API as secondary source (1km resolution, species-level UPI 0-5, but modeled not measured, no mold, no historical)
- Per-location season thresholds (latitude-aware)
- Dashboard timeline integration (Phase 4) — temp + pollen as background overlays, freeze-thaw as annotations, season bands
- Correlation engine extension — season-aware itch discounting, freeze-thaw event flagging
