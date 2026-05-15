/**
 * Pollen-sparr configuration. No hardcoded provider/location/source identifiers —
 * stations are discovered dynamically via /api/nearest using POLLEN_LAT/POLLEN_LNG.
 */

export const POLLEN_SPARR_BASE =
  process.env.POLLEN_SPARR_BASE ?? "https://pollen.mydoglog.ca"

// Default: St. Catharines, ON. Override per-deploy via env.
export const POLLEN_LAT = Number(process.env.POLLEN_LAT ?? 43.16)
export const POLLEN_LNG = Number(process.env.POLLEN_LNG ?? -79.25)

// Earliest historical data available in pollen-sparr.
export const POLLEN_BACKFILL_START = "2026-02-23"

// Sanity cap on readings fetched per cron run.
export const POLLEN_MAX_READINGS = 1000

const SLUG_NON_ALNUM = /[^a-z0-9]+/g
const SLUG_TRIM = /^-+|-+$/g
const TRAILING_PARENS = /\s*\([^)]+\)\s*$/

/** Build a stable location slug from upstream name + province. */
export function makeLocationSlug(name: string, province: string): string {
  const cleaned = name.replace(TRAILING_PARENS, "").trim().toLowerCase()
  const slug = cleaned.replace(SLUG_NON_ALNUM, "-").replace(SLUG_TRIM, "")
  return `${slug}-${province.toLowerCase()}`
}
