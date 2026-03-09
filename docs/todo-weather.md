# Weather & Environmental Tracking

## Overview

Daily collection of weather data, pollen levels, and mold spore levels per dog location. Weather comes from Open-Meteo API (free, no key). Pollen and mold come from **pollen-sparr** (`pollen.mydoglog.ca`) — a standalone archive service that scrapes Aerobiology Research Laboratories (31 stations) and The Weather Network daily, storing all history. Both feed into the dashboard timeline and correlation engine.

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
- **Pollen + mold** from pollen-sparr (`pollen.mydoglog.ca`) — see "Pollen Archive Service" section

Both hardcoded for now. No location picker, no stations table. When multi-location is needed, promote to a configurable system then.

### Monitoring locations (32 total via pollen-sparr)

pollen-sparr's `/api/nearest` endpoint maps lat/lng to the nearest station. 31 Aerobiology stations + 1 TWN city. Full list available at `GET /api/locations`.

**For St. Catharines:** `GET /api/nearest?lat=43.16&lng=-79.24&provider=aerobiology` → Hamilton (external_id 218, ~55km)

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
  windSpeedMaxKmh: numeric nullable
  createdAt: timestamp
```

Unique constraint on `(location, date)`. Upsert-safe (re-running for same date overwrites).

## `daily_pollen` table

Replaces existing `pollen_logs` table. One row per station per day. Fetched from **pollen-sparr** (`pollen.mydoglog.ca`).

### Pollen Archive Service (pollen-sparr) — BUILT

A separate standalone service (`pollen-sparr`) scrapes all Aerobiology Research Laboratories stations daily and stores historical pollen + mold data. This creates a dataset that doesn't exist publicly anywhere — Aerobiology only exposes 14 days of history via their API, and their full historical data is a paid research product.

**Service:** `https://pollen.mydoglog.ca`
**Auth:** None. Rate limit 60 requests/minute per IP.
**Providers:** Two, stored separately (never overwrite each other):
- `aerobiology` — 31 stations. 14 days of lab-verified historical data ("actual") + 5-day forecast. Per-species breakdowns (82 species), category totals (trees, grasses, weeds, spores), out-of-season flag.
- `twn` — City-level forecasts (currently 1 city: Niagara, ON). Today + 2 days forecast only. Single overall pollen level + top 3 allergen names. No historical data, no spore/mold data.

**API endpoints for MyDogLog cron:**
- `GET /api/nearest?lat=43.16&lng=-79.24&provider=aerobiology` — find closest station (Hamilton) + today's reading
- `GET /api/locations/{id}/readings?from={date}&to={date}` — date range of readings for a location
- `GET /api/locations` — list all 32 monitoring locations
- `GET /api/readings?date={date}` — all locations' readings for a date
- `GET /health` — service health check

**Reading object shape from pollen-sparr:**
```json
{
  "location_id": 1,
  "date": "2026-03-09",
  "provider": "aerobiology",
  "source": "actual",
  "pollen_level": 3,
  "total_trees": 3,
  "total_grasses": 0,
  "total_weeds": 0,
  "total_spores": 2,
  "out_of_season": 0,
  "species": [
    {"name": "Maple, Boxelder", "scientific_name": "ACER", "type": "pollen", "level": 2},
    {"name": "Cladosporium", "scientific_name": "CLADOSPORIUM", "type": "spore", "level": 1}
  ]
}
```

Notes:
- `source`: "actual" (lab-verified), "forecast" (prediction), or "today" (TWN current-day)
- `out_of_season`: 0 (monitoring active) or 1 (station shut down for winter) — integer, not boolean
- TWN readings have null for `total_trees`, `total_grasses`, `total_weeds`, `total_spores`
- TWN `species` is a simple array of allergen name strings, not objects

**Station for St. Catharines:** Hamilton (aerobiology external_id 218, ~55km). Use `/api/nearest` to resolve.

### Pollen/mold level scale

Both providers use the same 0-4 integer scale:

| Level | Label | Grains/m³ |
|-------|-------|-----------|
| 0 | None | 0 |
| 1 | Low | 1-20 |
| 2 | Moderate | 21-80 |
| 3 | High | 81-200 |
| 4 | Very High | >200 |

Pollen season runs ~mid-March through mid-October in Ontario (trees Mar-May, grasses Jun-Jul, weeds Aug-Oct). Off-season data stored with `pollen_level: 0` and `out_of_season: 1`. This is normal, not an error.

### Schema

```
daily_pollen:
  id: text PK
  location: text (e.g. "hamilton-on") — Aerobiology station name
  date: date
  pollenLevel: integer (0-4, overall pollen level)
  sporeLevel: integer (0-4, overall mold/spore level from total_spores)
  totalTrees: integer (0-4)
  totalGrasses: integer (0-4)
  totalWeeds: integer (0-4)
  topAllergens: jsonb (array of {name, scientificName, type, level} — mapped from pollen-sparr `species` array)
  source: text ("actual" or "forecast") — prefer actuals, overwrite forecasts when actuals arrive
  outOfSeason: boolean (mapped from pollen-sparr integer 0/1)
  createdAt: timestamp
```

Unique constraint on `(location, date)`. Upsert-safe. When upserting, prefer `source: "actual"` over `source: "forecast"` — never overwrite an actual with a forecast.

`topAllergens` stores all species with level > 0 from pollen-sparr's `species` array, preserving both pollen and spore types. This gives per-species tracking (e.g., "Cladosporium was high on the same days Peaches' itch spiked").

### Backfill from pollen-sparr

On first enable, query pollen-sparr for all available Hamilton history:
`GET /api/locations/{hamilton_id}/readings?from={earliest_needed}&to={yesterday}`

The archive accumulates from the day pollen-sparr started running, so historical depth depends on how long the service has been active. Unlike the raw Aerobiology API's 14-day window, pollen-sparr stores everything it has ever scraped.

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
3. **Gap detection:** Query last recorded date in `daily_weather` for this location. If gaps exist, fetch missing days from Open-Meteo in the same call (date range). Self-healing — handles missed crons, deploy gaps, first-run.
4. Run weather + pollen in parallel via `Promise.allSettled` — if one fails, the other still saves:
   - **Weather:** Fetch from Open-Meteo for St. Catharines (43.16, -79.24). Upsert into `daily_weather`.
   - **Pollen + mold:** Query pollen-sparr (`GET /api/locations/{hamilton_id}/readings?from={lastDate}&to={today}`). Upsert into `daily_pollen`. pollen-sparr handles Aerobiology scraping, actual vs forecast resolution, and history accumulation independently. Prefer actuals over forecasts when upserting.
5. Return `{ weather: { status, processed }, pollen: { status, processed } }`

### Open-Meteo API call
```
GET https://api.open-meteo.com/v1/forecast
  ?latitude=43.16&longitude=-79.24
  &daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean,wind_speed_10m_max
  &timezone=America/Toronto
  &past_days=1
  &forecast_days=1
```

`past_days=1` returns yesterday's archived data, `forecast_days=1` returns today only. Wind speed included for pollen/mold dispersal context. Rate limits: 10,000 calls/day free (non-commercial) — a daily cron is nowhere near this.

### Pollen archive query (pollen-sparr)

1. Resolve Hamilton location ID (cache after first call): `GET /api/nearest?lat=43.16&lng=-79.24&provider=aerobiology`
2. Fetch since last recorded date: `GET /api/locations/{hamilton_id}/readings?from={lastDate}&to={today}`
3. Map pollen-sparr reading fields to `daily_pollen` schema (see mapping in schema section above). Prefer `source: "actual"` — never overwrite an actual with a forecast.

### Schedule
Run daily at 14:00 UTC (9 AM EST / 10 AM EDT). Aerobiology actuals and forecasts update by ~8 AM local, this gives a 1-hour buffer.

### Backfill
On first enable, backfill historical weather from Open-Meteo Historical API. Separate endpoint: `POST /api/cron/weather/backfill` with `{ startDate, endDate }`. A 365-day fetch returns in <2s, batch upsert is fast.

Pollen backfill: `GET /api/locations/{hamilton_id}/readings?from={firstFeedingPeriodDate}&to={yesterday}` from pollen-sparr. Depth depends on how long pollen-sparr has been running.

```
GET https://archive-api.open-meteo.com/v1/archive
  ?latitude=43.16&longitude=-79.24
  &start_date={firstFeedingPeriodDate}&end_date={yesterday}
  &daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean,wind_speed_10m_max
  &timezone=America/Toronto
```

Note: Historical API uses ECMWF IFS (9km, 2017+) or ERA5 (25km, 1940+). Use "Best Match" model for automatic source selection. Historical API does NOT have `uv_index_max` — parameter set differs slightly from forecast API.

## Correlation Engine Integration

Environmental data feeds into the existing two-track correlation engine as **confounders**, not scored entities. Pollen/mold are not "ingredients" — they adjust confidence in food-based itch scores.

### Pollen + mold discount for itch track

Bad itch days during high pollen or high mold spores are less reliable indicators of food problems. Use `max(pollenLevel, sporeLevel)` as the effective environmental allergen load (0-4 scale from pollen-sparr). Apply a weight discount to the itch accumulator only:

| Effective Level | Discount Factor | Applied To |
|-----------------|----------------|------------|
| High (3) or Very High (4) | 0.4 | Bad itch days only |
| Moderate (2) | 0.7 | Bad itch days only |
| Low (1) or None (0) | 1.0 (no discount) | — |

**Good itch days during high pollen keep full weight.** If pollen is high and itch is still low, that's a strong signal the food is fine — more informative, not less.

**Do NOT apply pollen discount to GI/poop track.** Pollen does not cause digestive symptoms (the Ekici study's GI link is through systemic AD inflammation, not direct pollen→gut).

### Pollen lag: 3-day rolling max

Use `max(pollenIndex[day], pollenIndex[day-1], pollenIndex[day-2])` as the effective pollen exposure for any given day. This captures the 1-3 day lag for skin reactions (Folster-Holst 2015) without overcomplicating things.

Do NOT implement the 1-month lag from Dong 2024 — that was population-level incidence data, not individual symptom severity.

### Seasonal confounding flag

Per ingredient, track `highPollenBadItchDays` and `lowPollenBadItchDays` in the accumulator. If >60% of bad itch days for an ingredient occurred during high pollen periods, flag as `itchSeasonallyConfounded: true`. The UI should show: *"Itch scores for [ingredient] may be influenced by seasonal allergens — consider re-evaluating during low-pollen months."*

### What NOT to build

- Do NOT produce "pollen" or "humidity" as ingredient-like correlation results
- Do NOT exclude high-pollen days entirely (loses too much spring/summer data, creates seasonal bias)
- Do NOT use regression or stratification (single dog's data is too thin)
- Do NOT correlate humidity/temperature directly with symptoms (show on timeline for visual pattern recognition, not as computed scores)

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
3. `daily_weather` + `daily_pollen` tables + cron endpoint (single route, `Promise.allSettled`)
4. Historical weather backfill endpoint
5. Freeze-thaw detection utility + tests
6. Season computation utility + tests
7. Pollen discount in correlation engine (itch track only, 3-day rolling max, seasonal confounding flag)
8. Delete old Ambee pollen cron route

Steps 5-6 are pure functions with no DB dependency. Step 7 depends on steps 3-4 having data.

## Future

- Multi-location support (weather stations table, location picker per dog — pollen-sparr already covers all 32 locations)
- Per-location season thresholds (latitude-aware)
- Dashboard timeline integration (Phase 4) — temp + pollen + mold as background overlays, freeze-thaw as annotations, season bands
- Correlation engine extension — season-aware itch discounting, freeze-thaw event flagging
- Per-species mold/pollen tracking (Cladosporium, Alternaria, etc.) — data already collected in `topAllergens`, just needs UI

## References

Studies informing what environmental variables to track and why.

### Why humidity is tracked
- **Widorn et al. 2024** — "A prospective study evaluating the correlation between local weather conditions, pollen counts and pruritus of dogs with atopic dermatitis." *Veterinary Dermatology*. DOI: 10.1111/vde.13268. 32 atopic dogs tracked 8 months. Only relative humidity correlated with pruritus (β=0.07, p<0.001). Temperature p=0.073 (not significant after correction). Pollen counts did not correlate — rooftop traps may not reflect ground-level exposure for dogs.
- **Kim et al. 2023** — "Indoor house dust mite concentration and CAD severity." *Frontiers in Veterinary Science*, 10:1078306. DOI: 10.3389/fvets.2023.1078306. Indoor humidity >40% significantly increased *D. farinae* allergen concentration (p=0.035). Homes near green areas had higher mite levels.

### Why temperature is tracked (context + lag effects)
- **Dong et al. 2024** — "CAD prevalence and climate across 14 Chinese cities." *Frontiers in Veterinary Science*. DOI: 10.3389/fvets.2024.1428805. 41,551 CAD cases across 2.4M vet visits. Both temperature and humidity positively correlated with CAD incidence (p<0.0001) with a **1-month lag**. Contradicts Widorn at population scale — temperature matters for incidence even if not for daily pruritus variation.
- **Krämer et al. 2005** — "Seasonality in symptom severity influenced by temperature or grass pollen." *J Investigative Dermatology*. DOI: 10.1111/j.0022-202X.2005.23813.x. 3,061 children with eczema: "winter type" (22% itch reduction per 15°C increase) vs "summer type" (16% higher itch on high pollen days). Two phenotypes cancel out in population regressions, explaining why Widorn found temperature non-significant.

### Why pollen is categorical (not grain counts) and uses a 3-day lag
- **Widorn 2024** (above) — Specific pollen counts from rooftop traps did not correlate with pruritus even in dogs with confirmed positive intradermal test reactions to those pollens. Ground-level exposure differs from air monitoring. Categorical levels (0-5 from Aerobiology) are sufficient.
- **Folster-Holst et al. 2015** — "SCORAD worsened during birch pollen season." SCORAD worsened with a multi-day delay after pollen peak, in both sensitized AND non-sensitized patients. Pollen penetrates impaired skin barrier directly (non-IgE mechanism). Justifies the 3-day rolling max for pollen discount.

### Why mold/freeze-thaw matters
- **Ekici & Ok 2024** — "Gastrointestinal findings in dogs with atopic dermatitis." *Vet Med Sci*, PMC11034634. Mould mites were #1 allergen (16/26 dogs). 77% of AD dogs had diarrhea with measurable intestinal damage (elevated TFF-3, IAP). First study linking AD → gut epithelial damage in dogs.
- **Adam et al. 2022** — "Common allergens in AD dogs across South Korean provinces." *Veterinary World*, 15(8):1996-2003. DOI: 10.14202/vetworld.2022.1996-2003. *Aspergillus fumigatus* detected in 95.6% of tested AD dogs. 65.6% of detections in autumn (post-summer humidity/mold growth).

### General reviews
- **Hensel et al. 2024 (ICADA)** — "Update on genetic, environmental factors and allergens in cAD." *Veterinary Dermatology*, 35(1):15-24. DOI: 10.1111/vde.13210. House dust mites remain dominant allergen globally. Rural upbringing protective. Official ICADA position.
- **Lee et al. 2024** — "Environmental Influences on Atopic Eczema." PMC11328973. Higher humidity increases TEWL in atopic skin. Cold/dry weather increases prevalence and flare risk.
