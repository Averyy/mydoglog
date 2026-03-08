# Idea: Homepage Activity Calendar

Inline calendar on the dashboard showing logging activity per day.

## What each day shows

- **Checkmark** — daily check-in logged (poop/itch/treat via the check-in flow)
- **Backfill indicator** — feeding period with `isBackfill = true` covers that date
- **Manual log** — individual poop/itch/treat/vomit/symptom entries logged outside the check-in
- **Implicit routine** — days with an active feeding period but no logs (routine template assumed)

## Data

New API endpoint: `GET /api/dogs/[id]/calendar?month=2026-03`

Returns a lightweight map of dates → entry type flags (no full log data). Queries across all log tables + feeding periods for the requested month.

```ts
// Example response
{
  "2026-03-01": { checkin: true, backfill: false, manualLog: false },
  "2026-03-02": { checkin: false, backfill: true, manualLog: false },
  "2026-03-05": { checkin: false, backfill: false, manualLog: true },
  // ...days with no activity omitted
}
```

## UI

- Use existing `react-day-picker` calendar (`src/components/ui/calendar.tsx`) with custom day rendering
- Colored dots, checkmarks, or small icons per entry type
- Placement: between quick-log grid and "Recent" log feed on dashboard

## Open questions

1. **Scope** — current month only, or navigable across months?
2. **Tap behavior** — tap a day to filter log feed below, or open a day-detail view?
3. **Visual language** — dots (GitHub contribution-graph style), checkmarks/icons, or color-coded backgrounds?
4. **Placement** — between quick-log buttons and "Recent" feed, or elsewhere?
