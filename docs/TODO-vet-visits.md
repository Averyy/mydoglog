# TODO: Vet Visit Logging

**Priority:** Replaces daily check-in and weight tracking TODO. Lightweight vet visit log with weight capture.

## Overview

Replace the daily check-in (redundant — stool/itch/treats already have standalone loggers) with a vet visit logger. Weight tracking comes for free since vets weigh the dog every visit. Vet visit history lives on the Dog settings page, not in the daily log feed.

## Quick-Log Grid

New 2x2 grid order: **Stool → Itch → Treat → Vet Visit** (replaces check-in slot).

- `LogMode` gets `"vet"` added, `"checkin"` removed
- Remove `DailyCheckInContent` component and `/api/dogs/[id]/checkin/today` route

## Schema

New `vet_visit_logs` table:

| Column | Type | Notes |
|---|---|---|
| `id` | text (nanoid) | PK |
| `dog_id` | text | FK → dogs |
| `date` | date | Visit date |
| `weight_kg` | numeric | Nullable — weight taken at visit |
| `reasons` | jsonb (string[]) | Multi-select visit reasons, can be empty `[]` |
| `notes` | text | Nullable — freeform summary |
| `created_at` | timestamp | Default now |

## Visit Reasons

Multi-select toggle chips (same UX pattern as itch body areas). **Reasons are optional** — a visit can be just a weight entry with no reasons selected (e.g. quick weigh-in during a pill pickup).

- Annual checkup
- Vaccines
- Dental
- Bloodwork
- Skin / Allergy
- GI issues
- Ear infection
- Eye issue
- Injury
- Surgery
- Follow-up
- Rx pickup
- Other

## API Routes

- `POST /api/dogs/[id]/vet-visits` — create a vet visit log
- `GET /api/dogs/[id]/vet-visits` — list all vet visits for a dog (newest first)

## UI

### Logger (modal via quick-log grid)
- Date picker (defaults to today)
- Weight input (kg, optional)
- Reason chips (multi-select toggles)
- Notes textarea
- Save button

### Dog Page (settings) — Visit History
- List of vet visits under the dog's settings/profile page
- Each entry shows: date, weight (if recorded), reason chips, notes preview
- Tap to expand full notes
- Edit/delete support

## Weight Tracking (derived from vet visits)

- **Auto-update `dogs.weight`**: on vet visit save, if `weight_kg` is provided, update `dogs.weight` to the new value
- **Weight history chart on Insights page**: line chart pulling all `vet_visit_logs` rows where `weight_kg IS NOT NULL`, sorted by date. Same date range controls as existing timeline.
- **Weight trend indicator on dog profile**: gaining / stable / losing based on last 2+ data points
- **Units**: store as kg, convert from lbs in UI if user preference (display toggle, not a setting initially — just show both: "12.3 kg (27.1 lbs)")
- **No separate `weight_logs` table** — vet visits are the sole weight data source unless home weigh-ins become a feature later
- **Correlation integration (future)**: weight change rate as a visual overlay on the food timeline, not a correlation engine input initially

## Migration

1. Add `vet_visit_logs` table (`drizzle/0017_vet_visits.sql`)
2. Remove daily check-in component + API route
3. Update `LogMode` type, quick-log grid, log-action-sheet
4. Add vet visit logger component
5. Add vet visit history to Dog settings page
