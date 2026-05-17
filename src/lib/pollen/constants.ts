/**
 * Pollen-sparr configuration. No hardcoded provider/location/source identifiers —
 * stations are discovered dynamically via /api/nearest using POLLEN_LAT/POLLEN_LNG.
 *
 * On the VPS, set POLLEN_SPARR_BASE_URL=http://pollen-sparr:6500 so the call goes
 * container-to-container over the shared `web` Docker network (no Caddy, no TLS,
 * no public hop). Locally, point at the public host (https://api.pawpollen.com).
 *
 * POLLEN_SPARR_BASE_URL / POLLEN_SPARR_API_KEY are read fresh in the route via
 * `process.env` so env changes propagate without restart and tests can stub.
 */

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

/**
 * Build a stable location slug. `region` is the v2 alpha-2 admin1 code
 * (province for AB, state for NAB, etc.) — same shape the v1 `province`
 * field held for AB stations, so existing slugs remain stable.
 */
export function makeLocationSlug(name: string, region: string): string {
  const cleaned = name.replace(TRAILING_PARENS, "").trim().toLowerCase()
  const slug = cleaned.replace(SLUG_NON_ALNUM, "-").replace(SLUG_TRIM, "")
  return `${slug}-${region.toLowerCase()}`
}
