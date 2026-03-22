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
| `reasons` | jsonb (string[]) | Multi-select visit reasons |
| `notes` | text | Nullable — freeform summary |
| `created_at` | timestamp | Default now |

## Visit Reasons

Multi-select toggle chips (same UX pattern as itch body areas):

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

## Weight Tracking (derived)

- Weight chart on Insights page can pull from `vet_visit_logs.weight_kg` later
- No separate `weight_logs` table needed unless home weigh-ins become a thing
- Keep existing `weight` column on `dogs` table updated from latest vet visit weight

## Migration

1. Add `vet_visit_logs` table (`drizzle/0017_vet_visits.sql`)
2. Remove daily check-in component + API route
3. Update `LogMode` type, quick-log grid, log-action-sheet
4. Add vet visit logger component
5. Add vet visit history to Dog settings page
