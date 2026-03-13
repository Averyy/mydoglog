/** Shift a YYYY-MM-DD date string by N days. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Count calendar days between two YYYY-MM-DD strings. Uses noon UTC to avoid DST issues. */
export function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T12:00:00Z")
  const db = new Date(b + "T12:00:00Z")
  return Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24))
}

/** Enumerate all YYYY-MM-DD dates from `start` to `end` inclusive. */
export function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = []
  let current = start
  while (current <= end) {
    dates.push(current)
    current = shiftDate(current, 1)
  }
  return dates
}
