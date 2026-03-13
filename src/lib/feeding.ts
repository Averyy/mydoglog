/**
 * Pure functions for feeding plan resolution.
 * No database access — all logic is testable with plain data.
 */

import type { FeedingPlanGroup, FeedingPlanItem } from "@/lib/types"

/** Minimal row shape accepted by buildFeedingGroupMap. */
export interface FeedingGroupRow {
  id: string
  planGroupId: string
  planName: string | null
  startDate: string
  endDate: string | null
  isBackfill: boolean
  approximateDuration: string | null
  productId: string
  quantity: string | null
  quantityUnit: string | null
  mealSlot: string | null
  transitionDays: number | null
  previousPlanGroupId: string | null
  productName: string
  brandName: string
  imageUrl: string | null
  productType: string | null
  productFormat: string | null
}

/**
 * Build a Map<planGroupId, FeedingPlanGroup> from feeding period rows.
 *
 * Handles:
 * - Group initialization with first-seen row
 * - startDate/endDate merging (earliest start, latest end, null if any ongoing)
 * - Transition filtering (only ongoing items for groups with transitionDays)
 * - productId+mealSlot dedup
 * - transitionFromFoodName resolution across groups
 */
export function buildFeedingGroupMap(
  rows: FeedingGroupRow[],
): Map<string, FeedingPlanGroup> {
  const groupMap = new Map<string, FeedingPlanGroup>()

  for (const row of rows) {
    let group = groupMap.get(row.planGroupId)
    if (!group) {
      group = {
        planGroupId: row.planGroupId,
        planName: row.planName,
        startDate: row.startDate,
        endDate: row.endDate,
        isBackfill: row.isBackfill,
        approximateDuration: row.approximateDuration,
        items: [],
        treats: [],
        scorecard: null,
        logStats: null,
        transitionDays: row.transitionDays,
        previousPlanGroupId: row.previousPlanGroupId,
      }
      groupMap.set(row.planGroupId, group)
    }

    // Use earliest startDate, latest endDate for the group
    if (row.startDate < group.startDate) group.startDate = row.startDate
    if (!row.endDate || !group.endDate) {
      group.endDate = null
    } else if (row.endDate > group.endDate) {
      group.endDate = row.endDate
    }

    // For groups with transitions, only include ongoing (endDate IS NULL) items
    if (group.transitionDays && group.transitionDays > 0 && row.endDate !== null) {
      continue
    }

    const item: FeedingPlanItem = {
      id: row.id,
      productId: row.productId,
      productName: row.productName,
      brandName: row.brandName,
      imageUrl: row.imageUrl,
      type: row.productType,
      format: row.productFormat,
      quantity: row.quantity,
      quantityUnit: row.quantityUnit,
      mealSlot: row.mealSlot,
    }

    // Dedup: skip if same productId+mealSlot already added
    if (!group.items.some((existing) => existing.productId === item.productId && existing.mealSlot === item.mealSlot)) {
      group.items.push(item)
    }
  }

  // Resolve transitionFromFoodName for groups with previousPlanGroupId
  for (const group of groupMap.values()) {
    if (group.previousPlanGroupId) {
      const prevGroup = groupMap.get(group.previousPlanGroupId)
      if (prevGroup && prevGroup.items.length > 0) {
        const mainFoods = prevGroup.items.filter((i) => i.type === "food")
        group.transitionFromFoodName = mainFoods.length > 0
          ? mainFoods.map((i) => i.productName).join(" + ")
          : prevGroup.items[0].productName
      }
    }
  }

  return groupMap
}

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
