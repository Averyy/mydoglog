/**
 * Correlation engine — pure functions, no DB access.
 * All logic is testable with plain data.
 */

import { resolveActivePlan } from "@/lib/feeding"
import type {
  IngredientRecord,
  ActiveIngredient,
  DaySnapshot,
  DayOutcome,
  IngredientScore,
  CorrelationOptions,
  CorrelationResult,
  CorrelationInput,
  CrossReactivityGroup,
  Confidence,
  ProductIngredientRecord,
} from "./types"

// ---------------------------------------------------------------------------
// Ingredient key resolution
// ---------------------------------------------------------------------------

/**
 * Resolve an ingredient to its correlation key.
 *
 * 1. family + hydrolyzed → "family (hydrolyzed)"
 * 2. family + not hydrolyzed → "family"
 * 3. no family + sourceGroup → "sourceGroup (ambiguous)"
 * 4. no family + no sourceGroup → null (skip)
 */
export function resolveIngredientKey(
  ingredient: IngredientRecord,
): string | null {
  if (ingredient.family != null) {
    return ingredient.isHydrolyzed
      ? `${ingredient.family} (hydrolyzed)`
      : ingredient.family
  }
  if (ingredient.sourceGroup != null) {
    return `${ingredient.sourceGroup} (ambiguous)`
  }
  return null
}

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

function nextDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().split("T")[0]
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T12:00:00Z")
  const db = new Date(b + "T12:00:00Z")
  return Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24))
}

function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = []
  let current = start
  while (current <= end) {
    dates.push(current)
    current = nextDate(current)
  }
  return dates
}

// ---------------------------------------------------------------------------
// Day snapshot building — helpers
// ---------------------------------------------------------------------------

function getActiveProductIds(
  feedingPeriods: CorrelationInput["feedingPeriods"],
  date: string,
): Set<string> {
  const ids = new Set<string>()
  for (const fp of feedingPeriods) {
    if (fp.startDate <= date && (fp.endDate == null || fp.endDate >= date)) {
      ids.add(fp.productId)
    }
  }
  return ids
}

function resolveIngredientsForProducts(
  foodProductIds: Set<string>,
  treatProductIds: Set<string>,
  productIngredientMap: Map<string, ProductIngredientRecord[]>,
): ActiveIngredient[] {
  const keyMap = new Map<
    string,
    { ingredientIds: Set<string>; bestPosition: number; fromTreat: boolean }
  >()

  const processProduct = (productId: string, isTreat: boolean): void => {
    const ingredients = productIngredientMap.get(productId)
    if (!ingredients) return

    for (const pi of ingredients) {
      const key = resolveIngredientKey(pi.ingredient)
      if (key == null) continue

      const existing = keyMap.get(key)
      if (existing) {
        existing.ingredientIds.add(pi.ingredient.id)
        if (pi.position < existing.bestPosition) {
          existing.bestPosition = pi.position
        }
        if (isTreat) existing.fromTreat = true
      } else {
        keyMap.set(key, {
          ingredientIds: new Set([pi.ingredient.id]),
          bestPosition: pi.position,
          fromTreat: isTreat,
        })
      }
    }
  }

  for (const productId of foodProductIds) {
    processProduct(productId, false)
  }
  for (const productId of treatProductIds) {
    processProduct(productId, true)
  }

  return Array.from(keyMap.entries()).map(([key, data]) => ({
    key,
    ingredientIds: Array.from(data.ingredientIds),
    bestPosition: data.bestPosition,
    fromTreat: data.fromTreat,
  }))
}

function buildDayOutcome(
  date: string,
  input: CorrelationInput,
): DayOutcome {
  // Poop score: average of all logs for this date
  const poopLogsForDate = input.poopLogs.filter((l) => l.date === date)
  const poopScore =
    poopLogsForDate.length > 0
      ? poopLogsForDate.reduce((sum, l) => sum + l.firmnessScore, 0) /
        poopLogsForDate.length
      : null

  // Itch score: average of all logs for this date
  const itchLogsForDate = input.itchinessLogs.filter((l) => l.date === date)
  const itchScore =
    itchLogsForDate.length > 0
      ? itchLogsForDate.reduce((sum, l) => sum + l.score, 0) /
        itchLogsForDate.length
      : null

  // Vomit count
  const vomitCount = input.vomitLogs.filter((l) => l.date === date).length

  // Scorecard fallback: only when no poop logs exist
  let scorecardPoopFallback: number | null = null
  if (poopScore == null) {
    const activePlanGroupId = resolveActivePlan(input.planPeriods, date)
    if (activePlanGroupId != null) {
      const scorecard = input.scorecards.find(
        (sc) => sc.planGroupId === activePlanGroupId,
      )
      if (scorecard?.poopQuality != null) {
        scorecardPoopFallback = scorecard.poopQuality
      }
    }
  }

  // Medication flags
  const onItchinessMedication = input.medications.some(
    (m) =>
      m.reason === "itchiness" &&
      m.startDate <= date &&
      (m.endDate == null || m.endDate >= date),
  )
  const onDigestiveMedication = input.medications.some(
    (m) =>
      m.reason === "digestive" &&
      m.startDate <= date &&
      (m.endDate == null || m.endDate >= date),
  )

  // Pollen
  const pollenLog = input.pollenLogs.find((l) => l.date === date)
  const pollenIndex = pollenLog?.pollenIndex ?? null

  // Accidental exposure
  const hasAccidentalExposure = input.accidentalExposures.some(
    (e) => e.date === date,
  )

  return {
    poopScore,
    itchScore,
    vomitCount,
    scorecardPoopFallback,
    onItchinessMedication,
    onDigestiveMedication,
    pollenIndex,
    hasAccidentalExposure,
  }
}

// ---------------------------------------------------------------------------
// buildDaySnapshots
// ---------------------------------------------------------------------------

export function buildDaySnapshots(
  input: CorrelationInput,
  options: CorrelationOptions,
): DaySnapshot[] {
  const dates = enumerateDates(input.windowStart, input.windowEnd)
  const snapshots: DaySnapshot[] = []

  // Pre-index exposure dates for quick lookup
  const exposureDates = new Set(input.accidentalExposures.map((e) => e.date))

  let prevProductIds: Set<string> | null = null
  let transitionCountdown = 0

  for (const date of dates) {
    // Collect active food products
    const foodProductIds = getActiveProductIds(input.feedingPeriods, date)

    // Collect treat products for this date
    const treatProductIds = new Set(
      input.treatLogs.filter((t) => t.date === date).map((t) => t.productId),
    )

    // Resolve ingredients (deduped by key)
    const ingredients = resolveIngredientsForProducts(
      foodProductIds,
      treatProductIds,
      input.productIngredientMap,
    )

    // Transition buffer: detect food product set change from previous day
    if (prevProductIds != null) {
      const sameProducts =
        foodProductIds.size === prevProductIds.size &&
        [...foodProductIds].every((id) => prevProductIds!.has(id))
      if (!sameProducts) {
        transitionCountdown = options.transitionBufferDays
      }
    }
    const isTransitionBuffer = transitionCountdown > 0
    if (transitionCountdown > 0) transitionCountdown--

    // Exposure buffer: check if any exposure occurred within the last N days
    let isExposureBuffer = false
    for (const expDate of exposureDates) {
      const diff = daysBetween(expDate, date)
      if (diff >= 0 && diff < options.exposureBufferDays) {
        isExposureBuffer = true
        break
      }
    }

    // Build outcome
    const outcome = buildDayOutcome(date, input)

    snapshots.push({
      date,
      ingredients,
      outcome,
      isTransitionBuffer,
      isExposureBuffer,
    })

    prevProductIds = foodProductIds
  }

  return snapshots
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export function computeConfidence(
  daysWithEventLogs: number,
  daysWithScorecardOnly: number,
): Confidence {
  const total = daysWithEventLogs + daysWithScorecardOnly
  if (daysWithEventLogs >= 14) return "high"
  if (daysWithEventLogs >= 7) return "medium"
  if (daysWithEventLogs >= 3) return "low"
  if (total >= 3) return "low"
  return "insufficient"
}

// ---------------------------------------------------------------------------
// Ingredient scoring
// ---------------------------------------------------------------------------

interface IngredientAccumulator {
  poopSum: number
  poopCount: number
  itchSum: number
  itchCount: number
  vomitTotal: number
  dayCount: number
  bestPosition: number
  fromTreat: boolean
  daysWithEventLogs: number
  daysWithScorecardOnly: number
  badDays: number
  goodDays: number
}

export function computeIngredientScores(
  snapshots: DaySnapshot[],
  options: CorrelationOptions,
): IngredientScore[] {
  // Filter out excluded days
  const filtered = snapshots.filter((snap) => {
    if (snap.isTransitionBuffer) return false
    if (snap.isExposureBuffer) return false
    if (
      options.excludeMedicationPeriods &&
      (snap.outcome.onItchinessMedication || snap.outcome.onDigestiveMedication)
    ) {
      return false
    }
    return true
  })

  // Identify scoreable days: at least one outcome signal
  const scoreable = filtered.filter((snap) => {
    if (snap.outcome.poopScore != null) return true
    if (snap.outcome.itchScore != null) return true
    if (snap.outcome.vomitCount > 0) return true
    if (
      options.includeScorecardFallback &&
      snap.outcome.scorecardPoopFallback != null
    ) {
      return true
    }
    return false
  })

  const totalScoreableDays = scoreable.length
  const excludedCount = snapshots.length - filtered.length

  // Accumulate per ingredient key
  const accMap = new Map<string, IngredientAccumulator>()

  for (const snap of scoreable) {
    const effectivePoop =
      snap.outcome.poopScore ??
      (options.includeScorecardFallback
        ? snap.outcome.scorecardPoopFallback
        : null)
    const hasEventLog = snap.outcome.poopScore != null
    const hasScorecardOnly =
      !hasEventLog &&
      options.includeScorecardFallback &&
      snap.outcome.scorecardPoopFallback != null

    for (const ing of snap.ingredients) {
      let acc = accMap.get(ing.key)
      if (!acc) {
        acc = {
          poopSum: 0,
          poopCount: 0,
          itchSum: 0,
          itchCount: 0,
          vomitTotal: 0,
          dayCount: 0,
          bestPosition: ing.bestPosition,
          fromTreat: ing.fromTreat,
          daysWithEventLogs: 0,
          daysWithScorecardOnly: 0,
          badDays: 0,
          goodDays: 0,
        }
        accMap.set(ing.key, acc)
      }

      acc.dayCount++
      if (ing.bestPosition < acc.bestPosition) {
        acc.bestPosition = ing.bestPosition
      }
      if (ing.fromTreat) acc.fromTreat = true

      if (effectivePoop != null) {
        acc.poopSum += effectivePoop
        acc.poopCount++
        if (effectivePoop >= 5) acc.badDays++
        if (effectivePoop <= 3) acc.goodDays++
      }

      if (snap.outcome.itchScore != null) {
        acc.itchSum += snap.outcome.itchScore
        acc.itchCount++
      }

      acc.vomitTotal += snap.outcome.vomitCount

      if (hasEventLog) acc.daysWithEventLogs++
      else if (hasScorecardOnly) acc.daysWithScorecardOnly++
    }
  }

  // Build results
  const results: IngredientScore[] = []
  for (const [key, acc] of accMap) {
    results.push({
      key,
      dayCount: acc.dayCount,
      avgPoopScore: acc.poopCount > 0 ? acc.poopSum / acc.poopCount : null,
      avgItchScore: acc.itchCount > 0 ? acc.itchSum / acc.itchCount : null,
      vomitCount: acc.vomitTotal,
      badDayCount: acc.badDays,
      goodDayCount: acc.goodDays,
      confidence: computeConfidence(
        acc.daysWithEventLogs,
        acc.daysWithScorecardOnly,
      ),
      exposureFraction:
        totalScoreableDays > 0 ? acc.dayCount / totalScoreableDays : 0,
      bestPosition: acc.bestPosition,
      appearedInTreats: acc.fromTreat,
      excludedDays: excludedCount,
      daysWithEventLogs: acc.daysWithEventLogs,
      daysWithScorecardOnly: acc.daysWithScorecardOnly,
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// Cross-reactivity
// ---------------------------------------------------------------------------

function extractFamilyFromKey(key: string): string | null {
  if (key.endsWith(" (ambiguous)")) return null
  if (key.endsWith(" (hydrolyzed)")) {
    return key.slice(0, -" (hydrolyzed)".length)
  }
  return key
}

export function flagCrossReactivity(
  scores: IngredientScore[],
  groups: CrossReactivityGroup[],
): IngredientScore[] {
  const result = scores.map((s) => ({ ...s }))

  for (const group of groups) {
    const familySet = new Set(group.families)

    // Find all scores whose underlying family is in this group
    const matchingScores = result.filter((s) => {
      const family = extractFamilyFromKey(s.key)
      return family != null && familySet.has(family)
    })

    // Count distinct families with bad signals
    const badFamilies = new Set<string>()
    for (const s of matchingScores) {
      const family = extractFamilyFromKey(s.key)!
      const isBad =
        (s.avgPoopScore != null && s.avgPoopScore >= 4.0) ||
        (s.dayCount > 0 && s.badDayCount / s.dayCount > 0.3)
      if (isBad) badFamilies.add(family)
    }

    // Annotate if 2+ families are bad
    if (badFamilies.size >= 2) {
      for (const s of matchingScores) {
        const family = extractFamilyFromKey(s.key)!
        if (badFamilies.has(family)) {
          s.crossReactivityGroup = group.groupName
        }
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function runCorrelation(
  input: CorrelationInput,
  options: CorrelationOptions,
): CorrelationResult {
  const snapshots = buildDaySnapshots(input, options)
  let scores = computeIngredientScores(snapshots, options)
  scores = flagCrossReactivity(scores, input.crossReactivityGroups)

  // Count scoreable days (same filtering as computeIngredientScores)
  const scoreableDays = snapshots.filter((snap) => {
    if (snap.isTransitionBuffer || snap.isExposureBuffer) return false
    if (
      options.excludeMedicationPeriods &&
      (snap.outcome.onItchinessMedication || snap.outcome.onDigestiveMedication)
    ) {
      return false
    }
    if (snap.outcome.poopScore != null) return true
    if (snap.outcome.itchScore != null) return true
    if (snap.outcome.vomitCount > 0) return true
    if (
      options.includeScorecardFallback &&
      snap.outcome.scorecardPoopFallback != null
    ) {
      return true
    }
    return false
  }).length

  return {
    dogId: input.dogId,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    totalDays: snapshots.length,
    scoreableDays,
    scores,
    options,
  }
}
