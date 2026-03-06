/**
 * Pure functions for feeding plan resolution.
 * No database access — all logic is testable with plain data.
 */

export interface PlanPeriod {
  planGroupId: string
  startDate: string // YYYY-MM-DD
  endDate: string | null // YYYY-MM-DD or null = ongoing
  createdAt: string // ISO timestamp for tie-breaking
}

/**
 * Resolve which plan is active for a given date.
 *
 * Priority order:
 * 1. Single-day plan (startDate === endDate === date) — most specific
 * 2. Date-range plan (startDate <= date <= endDate) — bounded
 * 3. Ongoing plan (startDate <= date, no endDate) — open-ended
 *
 * Within each tier, the most recently created plan wins ties.
 */
export function resolveActivePlan(
  periods: PlanPeriod[],
  date: string,
): string | null {
  const candidates = periods.filter((p) => {
    if (p.startDate > date) return false
    if (p.endDate && p.endDate < date) return false
    return true
  })

  if (candidates.length === 0) return null

  // Score each candidate by specificity tier
  const scored = candidates.map((p) => {
    let tier: number
    if (p.startDate === date && p.endDate === date) {
      tier = 3 // single-day — highest priority
    } else if (p.endDate) {
      tier = 2 // date-range
    } else {
      tier = 1 // ongoing
    }
    return { ...p, tier }
  })

  // Sort: highest tier first, then most recent createdAt
  scored.sort((a, b) => {
    if (a.tier !== b.tier) return b.tier - a.tier
    return b.createdAt.localeCompare(a.createdAt)
  })

  return scored[0].planGroupId
}

/**
 * Group periods by planGroupId and return the group's effective date range.
 * Takes the earliest startDate and latest endDate (null if any period is ongoing).
 */
export function groupPlanPeriods(
  periods: PlanPeriod[],
): Map<string, { startDate: string; endDate: string | null; createdAt: string }> {
  const groups = new Map<
    string,
    { startDate: string; endDate: string | null; createdAt: string }
  >()

  for (const p of periods) {
    const existing = groups.get(p.planGroupId)
    if (!existing) {
      groups.set(p.planGroupId, {
        startDate: p.startDate,
        endDate: p.endDate,
        createdAt: p.createdAt,
      })
    } else {
      if (p.startDate < existing.startDate) existing.startDate = p.startDate
      if (!p.endDate || !existing.endDate) {
        existing.endDate = null
      } else if (p.endDate > existing.endDate) {
        existing.endDate = p.endDate
      }
      if (p.createdAt > existing.createdAt) existing.createdAt = p.createdAt
    }
  }

  return groups
}

const DURATION_PATTERNS: Array<{ pattern: RegExp; multiplier: number }> = [
  { pattern: /(\d+)\s*days?/i, multiplier: 1 },
  { pattern: /(\d+)\s*weeks?/i, multiplier: 7 },
  { pattern: /(\d+)\s*months?/i, multiplier: 30 },
  { pattern: /(\d+)\s*years?/i, multiplier: 365 },
]

const APPROXIMATE_PATTERNS: Array<{ pattern: RegExp; multiplier: number }> = [
  { pattern: /about\s+(\d+)\s*weeks?/i, multiplier: 7 },
  { pattern: /about\s+(\d+)\s*months?/i, multiplier: 30 },
  { pattern: /about\s+(\d+)\s*days?/i, multiplier: 1 },
  { pattern: /around\s+(\d+)\s*weeks?/i, multiplier: 7 },
  { pattern: /around\s+(\d+)\s*months?/i, multiplier: 30 },
  { pattern: /around\s+(\d+)\s*days?/i, multiplier: 1 },
  { pattern: /a\s+few\s+weeks?/i, multiplier: 21 },
  { pattern: /a\s+few\s+months?/i, multiplier: 90 },
  { pattern: /a\s+couple\s+(?:of\s+)?weeks?/i, multiplier: 14 },
  { pattern: /a\s+couple\s+(?:of\s+)?months?/i, multiplier: 60 },
]

/**
 * Compute a human-readable duration string from an inclusive date range.
 * E.g. "3 days", "2 weeks", "~3 months", "1 year"
 */
export function durationFromRange(startDate: string, endDate: string): string {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1

  if (days <= 0) return "0 days"
  if (days === 1) return "1 day"
  if (days < 14) return `${days} days`
  if (days < 60) {
    const weeks = Math.round(days / 7)
    return `~${weeks} week${weeks === 1 ? "" : "s"}`
  }
  if (days < 365) {
    const months = Math.round(days / 30)
    return `~${months} month${months === 1 ? "" : "s"}`
  }
  const years = Math.round(days / 365)
  return `~${years} year${years === 1 ? "" : "s"}`
}

export function parseDuration(input: string): { days: number } | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Try approximate patterns first (they're more specific with "about/around" prefix)
  for (const { pattern, multiplier } of APPROXIMATE_PATTERNS) {
    const match = trimmed.match(pattern)
    if (match) {
      // For "a few" / "a couple" patterns, multiplier is already total days
      if (!match[1]) return { days: multiplier }
      return { days: parseInt(match[1], 10) * multiplier }
    }
  }

  // Try exact patterns
  for (const { pattern, multiplier } of DURATION_PATTERNS) {
    const match = trimmed.match(pattern)
    if (match) {
      return { days: parseInt(match[1], 10) * multiplier }
    }
  }

  // Try bare number (assume days)
  const bareNumber = trimmed.match(/^(\d+)$/)
  if (bareNumber) {
    return { days: parseInt(bareNumber[1], 10) }
  }

  return null
}
