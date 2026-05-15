import { AEROBIOLOGY_PROVIDER } from "./constants"

/**
 * Deduplicate pollen rows, preferring Aerobiology over any other provider.
 * For dates where Aerobiology data exists, rows from other providers are dropped.
 * No-op when only Aerobiology is queried; meaningful once a second provider is added.
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
