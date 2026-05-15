/**
 * Pick one active (provider, location) station from a set of pollen rows.
 * Strategy: whichever station has the row with the latest `date` is the
 * currently-active station — the cron only writes fresh dates for the station
 * pollen-sparr resolved as nearest. Rows from any previously-active station
 * are dropped to avoid mixing readings from different scales.
 *
 * No-op when only one (provider, location) exists in the input.
 */
export function deduplicatePollenRows<
  T extends { date: string; provider: string; location: string },
>(rows: T[]): T[] {
  if (rows.length === 0) return []
  let active = rows[0]
  for (const r of rows) {
    if (r.date > active.date) active = r
  }
  return rows.filter(
    (r) => r.provider === active.provider && r.location === active.location,
  )
}
