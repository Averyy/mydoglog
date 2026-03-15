# TODO: Weight Tracking

## Goal

Track dog weight over time with trend visualization. Currently just a single field on the dog profile — extend to a historical log with charting.

## Schema

- New `weight_logs` table: `id`, `dog_id`, `date`, `weight_kg`, `created_at`
- Keep existing `weight` column on `dogs` table as "current weight" (updated on latest log entry)

## UI

- Weight log entry on daily check-in (optional field, not shown every day — maybe weekly prompt or manual entry)
- Weight history chart on Insights page (line chart, same date range controls as existing timeline)
- Weight trend indicator on dog profile (gaining/stable/losing)

## Correlation Integration

- Weight change rate could be a useful signal alongside food changes
- Not a correlation engine input initially — just visual overlay on timeline

## API

- `POST /api/dogs/[id]/weight` — log a weight entry
- `GET /api/dogs/[id]/weight` — weight history for charting

## Notes

- Units: kg (convert from lbs in UI if needed, store as kg)
- One entry per day max (upsert on date)
