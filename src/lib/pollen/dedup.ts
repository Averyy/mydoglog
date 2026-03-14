import { AEROBIOLOGY_PROVIDER } from "./constants"

/**
 * Deduplicate pollen rows preferring Aerobiology over TWN.
 * For dates where Aerobiology data exists, TWN rows are dropped.
 */
export function deduplicatePollenRows<T extends { date: string; provider: string }>(
  rows: T[],
): T[] {
  const aeroDates = new Set(
    rows.filter((r) => r.provider === AEROBIOLOGY_PROVIDER).map((r) => r.date),
  )
  return rows.filter(
    (r) => r.provider === AEROBIOLOGY_PROVIDER || !aeroDates.has(r.date),
  )
}
