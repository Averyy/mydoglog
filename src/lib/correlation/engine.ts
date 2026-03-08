/**
 * Correlation engine — pure functions, no DB access.
 * All logic is testable with plain data.
 */

import { resolveActivePlan } from "@/lib/feeding"
import { gramsPerServing } from "@/lib/nutrition"
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
  PositionCategory,
  ProductIngredientRecord,
  RawBackfill,
} from "./types"
import { DEFAULT_SCORING_CONSTANTS } from "./types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Average an array of scores, rounding to one decimal. */
export function averageScores(scores: number[]): number {
  const sum = scores.reduce((a, b) => a + b, 0)
  return Math.round((sum / scores.length) * 10) / 10
}

// ---------------------------------------------------------------------------
// Ingredient key resolution
// ---------------------------------------------------------------------------

const FAT_OIL_FORM_TYPES = new Set(["fat", "oil"])

/**
 * Resolve an ingredient to its correlation key.
 *
 * 1. family + hydrolyzed → "family (hydrolyzed)"
 * 2. family + fat/oil form → "family (fat)" / "family (oil)" — separate from protein
 * 3. family + other form → "family"
 * 4. no family + sourceGroup → "sourceGroup (ambiguous)"
 * 5. no family + no sourceGroup → null (skip)
 */
export function resolveIngredientKey(
  ingredient: IngredientRecord,
): string | null {
  if (ingredient.family != null) {
    if (ingredient.isHydrolyzed) {
      return `${ingredient.family} (hydrolyzed)`
    }
    if (ingredient.formType != null && FAT_OIL_FORM_TYPES.has(ingredient.formType)) {
      return `${ingredient.family} (${ingredient.formType})`
    }
    return ingredient.family
  }
  if (ingredient.sourceGroup != null && ingredient.sourceGroup !== "other") {
    return `${ingredient.sourceGroup} (ambiguous)`
  }
  return null
}

/**
 * Check whether a form type represents a fat/oil (non-allergenic).
 */
export function isNonAllergenicForm(formType: string | null): boolean {
  return formType != null && FAT_OIL_FORM_TYPES.has(formType)
}

// ---------------------------------------------------------------------------
// Position weighting
// ---------------------------------------------------------------------------

/**
 * Exponential decay weight for ingredient position.
 * Position 1 = 1.0, decays with lambda = 0.15.
 */
export function positionWeight(position: number): number {
  return Math.exp(-DEFAULT_SCORING_CONSTANTS.positionWeights.lambda * (position - 1))
}

/**
 * Categorize an ingredient position.
 */
export function positionCategory(position: number): PositionCategory {
  if (position <= 4) return "primary"
  if (position <= 10) return "secondary"
  if (position <= 17) return "minor"
  return "trace"
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
// Gram estimation
// ---------------------------------------------------------------------------

/**
 * Estimate grams from a quantity + unit.
 * Tries exact conversion via calorie data first, falls back to rough unit multipliers.
 */
export function estimateGrams(
  quantity: number,
  unit: string,
  calorieContent: string | null,
): number {
  if (unit === "g") return quantity
  if (unit === "ml") return quantity
  // Exact conversion via calorie data
  if (calorieContent) {
    const gps = gramsPerServing(calorieContent, unit)
    if (gps != null) return quantity * gps
  }
  // Rough unit multipliers when calorie data insufficient
  switch (unit) {
    case "cup": return quantity * 100
    case "can": return quantity * 370
    case "scoop": return quantity * 30
    case "piece": return quantity * 5
    case "treat": return quantity * 5
    case "tbsp": return quantity * 10
    case "tsp": return quantity * 3
    default: return quantity * 5
  }
}

// ---------------------------------------------------------------------------
// Day snapshot building — helpers
// ---------------------------------------------------------------------------

function getActiveFeedingPeriods(
  feedingPeriods: CorrelationInput["feedingPeriods"],
  date: string,
): CorrelationInput["feedingPeriods"] {
  return feedingPeriods.filter(
    (fp) => fp.startDate <= date && (fp.endDate == null || fp.endDate >= date),
  )
}

function resolveIngredientsForProducts(
  productGrams: Map<string, number>,
  treatProductIds: Set<string>,
  productIngredientMap: Map<string, ProductIngredientRecord[]>,
): ActiveIngredient[] {
  const totalGrams = Array.from(productGrams.values()).reduce((a, b) => a + b, 0)

  const keyMap = new Map<
    string,
    { ingredientIds: Set<string>; productIds: Set<string>; bestPosition: number; worstPosition: number; ingredientCount: number; fromTreat: boolean; formType: string | null; sourceGroup: string | null; volumePositionWeight: number }
  >()

  const processProduct = (productId: string, isTreat: boolean): void => {
    const ingredients = productIngredientMap.get(productId)
    if (!ingredients) return

    const grams = productGrams.get(productId) ?? 0
    const volumeFraction = totalGrams > 0 ? grams / totalGrams : 1

    for (const pi of ingredients) {
      const key = resolveIngredientKey(pi.ingredient)
      if (key == null) continue

      const vpw = positionWeight(pi.position) * volumeFraction

      const existing = keyMap.get(key)
      if (existing) {
        existing.ingredientIds.add(pi.ingredient.id)
        existing.productIds.add(productId)
        existing.ingredientCount++
        existing.volumePositionWeight += vpw
        if (pi.position < existing.bestPosition) {
          existing.bestPosition = pi.position
        }
        if (pi.position > existing.worstPosition) {
          existing.worstPosition = pi.position
        }
        if (isTreat) existing.fromTreat = true
      } else {
        keyMap.set(key, {
          ingredientIds: new Set([pi.ingredient.id]),
          productIds: new Set([productId]),
          bestPosition: pi.position,
          worstPosition: pi.position,
          ingredientCount: 1,
          fromTreat: isTreat,
          formType: pi.ingredient.formType,
          sourceGroup: pi.ingredient.sourceGroup,
          volumePositionWeight: vpw,
        })
      }
    }
  }

  for (const [productId] of productGrams) {
    processProduct(productId, treatProductIds.has(productId))
  }

  return Array.from(keyMap.entries()).map(([key, data]) => ({
    key,
    ingredientIds: Array.from(data.ingredientIds),
    productIds: Array.from(data.productIds),
    bestPosition: data.bestPosition,
    worstPosition: data.worstPosition,
    ingredientCount: data.ingredientCount,
    fromTreat: data.fromTreat,
    formType: data.formType,
    sourceGroup: data.sourceGroup,
    volumePositionWeight: data.volumePositionWeight,
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
      if (scorecard?.poopQuality != null && scorecard.poopQuality.length > 0) {
        scorecardPoopFallback = averageScores(scorecard.poopQuality)
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

  let prevFoodProductIds: Set<string> | null = null
  let transitionCountdown = 0

  for (const date of dates) {
    // Collect active feeding periods and their gram estimates
    const activePeriods = getActiveFeedingPeriods(input.feedingPeriods, date)
    const foodProductIds = new Set(activePeriods.map((fp) => fp.productId))

    const productGrams = new Map<string, number>()
    for (const fp of activePeriods) {
      const info = input.productInfo.get(fp.productId)
      const grams = estimateGrams(fp.quantity, fp.quantityUnit, info?.calorieContent ?? null)
      productGrams.set(fp.productId, (productGrams.get(fp.productId) ?? 0) + grams)
    }

    // Collect treat products for this date with gram estimates
    const treatLogsForDate = input.treatLogs.filter(
      (t) => t.date === date,
    )
    const treatProductIds = new Set(treatLogsForDate.map((t) => t.productId))
    for (const t of treatLogsForDate) {
      const info = input.productInfo.get(t.productId)
      const grams = estimateGrams(t.quantity, t.quantityUnit, info?.calorieContent ?? null)
      productGrams.set(t.productId, (productGrams.get(t.productId) ?? 0) + grams)
    }

    // Resolve ingredients (deduped by key, volume-weighted)
    const ingredients = resolveIngredientsForProducts(
      productGrams,
      treatProductIds,
      input.productIngredientMap,
    )

    // Transition buffer: detect food product set change from previous day
    // Only triggers on actual switches (A→B), not initial start (∅→A)
    if (prevFoodProductIds != null && prevFoodProductIds.size > 0) {
      const sameProducts =
        foodProductIds.size === prevFoodProductIds.size &&
        [...foodProductIds].every((id) => prevFoodProductIds!.has(id))
      if (!sameProducts && foodProductIds.size > 0) {
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
      isBackfill: false,
    })

    prevFoodProductIds = foodProductIds
  }

  return snapshots
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export function computeConfidence(
  daysWithEventLogs: number,
  daysWithScorecardOnly: number,
  daysWithBackfill: number,
): Confidence {
  // Effective days: event logs at full weight, backfill at 0.5x, scorecard-only at 0.25x
  const effectiveDays =
    daysWithEventLogs +
    daysWithBackfill * 0.5 +
    daysWithScorecardOnly * 0.25

  if (effectiveDays >= 56) return "high"
  if (effectiveDays >= 30) return "medium"
  if (effectiveDays >= 5) return "low"
  return "insufficient"
}

// ---------------------------------------------------------------------------
// Ingredient scoring
// ---------------------------------------------------------------------------

interface IngredientAccumulator {
  // Raw averages
  poopSum: number
  poopCount: number
  itchSum: number
  itchCount: number
  // Weighted numerator/denominator
  weightedPoopNumerator: number
  weightedPoopDenominator: number
  weightedItchNumerator: number
  weightedItchDenominator: number
  vomitTotal: number
  dayCount: number
  bestPosition: number
  fromTreat: boolean
  formType: string | null
  sourceGroup: string | null
  isSplit: boolean
  productIds: Set<string>
  daysWithEventLogs: number
  daysWithScorecardOnly: number
  daysWithBackfill: number
  badDays: number
  goodDays: number
  badPoopDays: number
  goodPoopDays: number
  badItchDays: number
  goodItchDays: number
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
          weightedPoopNumerator: 0,
          weightedPoopDenominator: 0,
          weightedItchNumerator: 0,
          weightedItchDenominator: 0,
          vomitTotal: 0,
          dayCount: 0,
          bestPosition: ing.bestPosition,
          fromTreat: ing.fromTreat,
          formType: ing.formType,
          sourceGroup: ing.sourceGroup,
          isSplit: false,
          productIds: new Set<string>(),
          daysWithEventLogs: 0,
          daysWithScorecardOnly: 0,
          daysWithBackfill: 0,
          badDays: 0,
          goodDays: 0,
          badPoopDays: 0,
          goodPoopDays: 0,
          badItchDays: 0,
          goodItchDays: 0,
        }
        accMap.set(ing.key, acc)
      }

      // Legume splitting: 3+ ingredients from same family in a product
      if (ing.sourceGroup === "legume" && ing.ingredientCount >= 3) {
        acc.isSplit = true
      }

      acc.dayCount++
      for (const pid of ing.productIds) {
        acc.productIds.add(pid)
      }
      if (ing.bestPosition < acc.bestPosition) {
        acc.bestPosition = ing.bestPosition
      }
      if (ing.fromTreat) acc.fromTreat = true

      // Use pre-computed volume-weighted position weight (accounts for product's
      // share of daily intake). Falls back to position-only weight for backfills.
      const vpw = ing.volumePositionWeight

      if (effectivePoop != null) {
        // Raw average
        acc.poopSum += effectivePoop
        acc.poopCount++

        // For additive source group, use minimum floor weight for GI track
        const giVpw = ing.sourceGroup === "additive"
          ? Math.max(vpw, 0.5)
          : vpw

        // Weighted: bad days (>=5) count 3x, good days count 1x
        const dayWeight = effectivePoop >= 5
          ? DEFAULT_SCORING_CONSTANTS.badDayMultiplier
          : DEFAULT_SCORING_CONSTANTS.goodDayMultiplier
        acc.weightedPoopNumerator += effectivePoop * giVpw * dayWeight
        acc.weightedPoopDenominator += giVpw * dayWeight

        if (effectivePoop >= 5) acc.badPoopDays++
        if (effectivePoop <= 3) acc.goodPoopDays++
      }

      if (snap.outcome.itchScore != null) {
        // Raw average
        acc.itchSum += snap.outcome.itchScore
        acc.itchCount++

        // Weighted: itch >= 4 is bad — standard position decay (additives don't cause skin reactions)
        const dayWeight = snap.outcome.itchScore >= 4
          ? DEFAULT_SCORING_CONSTANTS.badDayMultiplier
          : DEFAULT_SCORING_CONSTANTS.goodDayMultiplier
        acc.weightedItchNumerator += snap.outcome.itchScore * vpw * dayWeight
        acc.weightedItchDenominator += vpw * dayWeight

        if (snap.outcome.itchScore >= 4) acc.badItchDays++
        if (snap.outcome.itchScore <= 2) acc.goodItchDays++
      }

      // Union counts: a day is "bad" if EITHER track is bad (counted once)
      const poopBad = effectivePoop != null && effectivePoop >= 5
      const itchBad = snap.outcome.itchScore != null && snap.outcome.itchScore >= 4
      if (poopBad || itchBad) acc.badDays++

      const poopGood = effectivePoop != null && effectivePoop <= 3
      const itchGood = snap.outcome.itchScore != null && snap.outcome.itchScore <= 2
      if (poopGood || itchGood) acc.goodDays++

      acc.vomitTotal += snap.outcome.vomitCount

      if (snap.isBackfill) {
        acc.daysWithBackfill++
      } else if (hasEventLog) {
        acc.daysWithEventLogs++
      } else if (hasScorecardOnly) {
        acc.daysWithScorecardOnly++
      }
    }
  }

  // Build results
  const results: IngredientScore[] = []
  for (const [key, acc] of accMap) {
    results.push({
      key,
      dayCount: acc.dayCount,
      weightedPoopScore: acc.weightedPoopDenominator > 0
        ? acc.weightedPoopNumerator / acc.weightedPoopDenominator
        : null,
      weightedItchScore: acc.weightedItchDenominator > 0
        ? acc.weightedItchNumerator / acc.weightedItchDenominator
        : null,
      rawAvgPoopScore: acc.poopCount > 0 ? acc.poopSum / acc.poopCount : null,
      rawAvgItchScore: acc.itchCount > 0 ? acc.itchSum / acc.itchCount : null,
      vomitCount: acc.vomitTotal,
      badDayCount: acc.badDays,
      goodDayCount: acc.goodDays,
      badPoopDayCount: acc.badPoopDays,
      goodPoopDayCount: acc.goodPoopDays,
      badItchDayCount: acc.badItchDays,
      goodItchDayCount: acc.goodItchDays,
      confidence: computeConfidence(
        acc.daysWithEventLogs,
        acc.daysWithScorecardOnly,
        acc.daysWithBackfill,
      ),
      exposureFraction:
        totalScoreableDays > 0 ? acc.dayCount / totalScoreableDays : 0,
      bestPosition: acc.bestPosition,
      positionCategory: positionCategory(acc.bestPosition),
      appearedInTreats: acc.fromTreat,
      excludedDays: excludedCount,
      daysWithEventLogs: acc.daysWithEventLogs,
      daysWithScorecardOnly: acc.daysWithScorecardOnly,
      daysWithBackfill: acc.daysWithBackfill,
      isAllergenicallyRelevant: !isNonAllergenicForm(acc.formType) && acc.sourceGroup !== "additive",
      isSplit: acc.isSplit,
      distinctProductCount: acc.productIds.size,
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// Cross-reactivity
// ---------------------------------------------------------------------------

export function extractFamilyFromKey(key: string): string | null {
  if (key.endsWith(" (ambiguous)")) return null
  if (key.endsWith(" (hydrolyzed)")) {
    return key.slice(0, -" (hydrolyzed)".length)
  }
  if (key.endsWith(" (fat)")) {
    return key.slice(0, -" (fat)".length)
  }
  if (key.endsWith(" (oil)")) {
    return key.slice(0, -" (oil)".length)
  }
  return key
}

/**
 * Check if a key represents a non-allergenic form (fat/oil).
 */
function isNonAllergenicKey(key: string): boolean {
  return key.endsWith(" (fat)") || key.endsWith(" (oil)")
}

/**
 * Extract the source group from an ambiguous key like "poultry (ambiguous)".
 */
function extractSourceGroupFromAmbiguousKey(key: string): string | null {
  if (!key.endsWith(" (ambiguous)")) return null
  return key.slice(0, -" (ambiguous)".length)
}

export function flagCrossReactivity(
  scores: IngredientScore[],
  groups: CrossReactivityGroup[],
): IngredientScore[] {
  const result = scores.map((s) => ({ ...s }))

  for (const group of groups) {
    const familySet = new Set(group.families)

    // Find all scores whose underlying family is in this group
    // Skip non-allergenic forms — fat/oil can't trigger cross-reactivity
    const matchingScores = result.filter((s) => {
      if (isNonAllergenicKey(s.key)) return false
      const family = extractFamilyFromKey(s.key)
      return family != null && familySet.has(family)
    })

    // Count distinct families with bad signals (poop OR itch track)
    const badFamilies = new Set<string>()
    for (const s of matchingScores) {
      const family = extractFamilyFromKey(s.key)!
      const isBad =
        (s.weightedPoopScore != null && s.weightedPoopScore >= 4.0) ||
        (s.weightedItchScore != null && s.weightedItchScore >= 4.0) ||
        (s.dayCount > 0 && s.badPoopDayCount / s.dayCount > 0.3) ||
        (s.dayCount > 0 && s.badItchDayCount / s.dayCount > 0.3)
      if (isBad) badFamilies.add(family)
    }

    // Confirmed: 2+ families bad → flag with crossReactivityGroup
    if (badFamilies.size >= 2) {
      for (const s of matchingScores) {
        const family = extractFamilyFromKey(s.key)!
        if (badFamilies.has(family)) {
          s.crossReactivityGroup = group.groupName
        }
      }
    }

    // Warning: 1 family bad → warn other families in the same group
    if (badFamilies.size === 1) {
      const badFamily = [...badFamilies][0]
      for (const s of matchingScores) {
        const family = extractFamilyFromKey(s.key)!
        if (family !== badFamily) {
          s.crossReactivityWarning = `${capitalize(badFamily)} scored poorly \u2014 ${capitalize(family)} is in the same ${group.groupName} family and may cause similar reactions`
        }
      }
    }
  }

  // Handle ambiguous ingredients: if "poultry (ambiguous)" exists and any
  // specific poultry family has bad signals, warn the ambiguous key
  for (const s of result) {
    const sourceGroup = extractSourceGroupFromAmbiguousKey(s.key)
    if (sourceGroup == null) continue

    // Find any group that matches this source group name
    for (const group of groups) {
      if (group.groupName !== sourceGroup) continue

      const badInGroup = result.filter((other) => {
        if (isNonAllergenicKey(other.key)) return false
        const family = extractFamilyFromKey(other.key)
        if (family == null || !new Set(group.families).has(family)) return false
        return (
          (other.weightedPoopScore != null && other.weightedPoopScore >= 4.0) ||
          (other.weightedItchScore != null && other.weightedItchScore >= 4.0) ||
          (other.dayCount > 0 && other.badPoopDayCount / other.dayCount > 0.3) ||
          (other.dayCount > 0 && other.badItchDayCount / other.dayCount > 0.3)
        )
      })

      if (badInGroup.length > 0) {
        const badNames = badInGroup.map((b) => capitalize(extractFamilyFromKey(b.key)!)).join(", ")
        s.crossReactivityWarning = `This could be any ${sourceGroup} protein \u2014 and ${badNames} scored poorly`
      }
    }
  }

  return result
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ---------------------------------------------------------------------------
// Backfill snapshots — day-by-day with volume weighting
// ---------------------------------------------------------------------------

/**
 * Build virtual day snapshots from backfill entries.
 *
 * Enumerates real calendar dates across all backfills and processes each
 * date like buildDaySnapshots: builds a combined gram map from all active
 * backfills for that date, then calls resolveIngredientsForProducts for
 * correct volume weighting. A 25g topper gets ~4% weight vs a 600g food.
 *
 * Scorecard outcomes are gram-weighted averages across active backfills.
 * Dates within the daily-log window are skipped (daily logs are higher
 * quality). Uses `backfill:YYYY-MM-DD` date keys.
 */
export function buildBackfillSnapshots(
  input: CorrelationInput,
): DaySnapshot[] {
  // Filter to backfills with scorecard data
  const validBackfills = input.backfills.filter((bf) => {
    return (bf.scorecard?.poopQuality?.length ?? 0) > 0 ||
           (bf.scorecard?.itchSeverity?.length ?? 0) > 0
  })

  if (validBackfills.length === 0) return []

  // Find the full date range across all backfills
  let minDate = validBackfills[0].startDate
  let maxDate = validBackfills[0].endDate
  for (let i = 1; i < validBackfills.length; i++) {
    if (validBackfills[i].startDate < minDate) minDate = validBackfills[i].startDate
    if (validBackfills[i].endDate > maxDate) maxDate = validBackfills[i].endDate
  }

  const dates = enumerateDates(minDate, maxDate)
  const snapshots: DaySnapshot[] = []

  // Pre-compute grams per backfill (avoids re-computing for every date)
  const backfillGrams = new Map<RawBackfill, number>()
  for (const bf of validBackfills) {
    const info = input.productInfo.get(bf.productId)
    backfillGrams.set(bf, estimateGrams(bf.quantity, bf.quantityUnit, info?.calorieContent ?? null))
  }

  for (const date of dates) {
    // Skip dates covered by the daily-log window (daily logs are higher quality)
    if (date >= input.windowStart && date <= input.windowEnd) continue

    const activeBackfills = validBackfills.filter(
      (bf) => bf.startDate <= date && bf.endDate >= date,
    )
    if (activeBackfills.length === 0) continue

    // Build combined gram map
    const productGrams = new Map<string, number>()
    const treatProductIds = new Set<string>()

    for (const bf of activeBackfills) {
      const grams = backfillGrams.get(bf)!
      productGrams.set(bf.productId, (productGrams.get(bf.productId) ?? 0) + grams)
      const info = input.productInfo.get(bf.productId)
      if (info?.type === "treat") treatProductIds.add(bf.productId)
    }

    // Resolve ingredients with volume weighting (shared logic)
    const ingredients = resolveIngredientsForProducts(
      productGrams,
      treatProductIds,
      input.productIngredientMap,
    )
    if (ingredients.length === 0) continue

    // Build outcome: gram-weighted average of scorecard scores
    let poopNumerator = 0, poopDenominator = 0
    let itchNumerator = 0, itchDenominator = 0
    for (const bf of activeBackfills) {
      const grams = backfillGrams.get(bf)!
      if (bf.scorecard?.poopQuality?.length) {
        poopNumerator += averageScores(bf.scorecard.poopQuality) * grams
        poopDenominator += grams
      }
      if (bf.scorecard?.itchSeverity?.length) {
        itchNumerator += averageScores(bf.scorecard.itchSeverity) * grams
        itchDenominator += grams
      }
    }

    const avgPoop = poopDenominator > 0 ? poopNumerator / poopDenominator : null
    const avgItch = itchDenominator > 0 ? itchNumerator / itchDenominator : null
    if (avgPoop == null && avgItch == null) continue

    snapshots.push({
      date: `backfill:${date}`,
      ingredients,
      outcome: {
        poopScore: avgPoop,
        itchScore: avgItch,
        vomitCount: 0,
        scorecardPoopFallback: null,
        onItchinessMedication: false,
        onDigestiveMedication: false,
        pollenIndex: null,
        hasAccidentalExposure: false,
      },
      isTransitionBuffer: false,
      isExposureBuffer: false,
      isBackfill: true,
    })
  }

  return snapshots
}

// ---------------------------------------------------------------------------
// GI-merged scores — collapse forms (fat/oil) into base family for stool view
// ---------------------------------------------------------------------------

/**
 * Merge ingredient scores by family for GI analysis.
 * In GI mode, all forms of the same ingredient (e.g. "corn", "corn (fat)",
 * "corn (oil)") contribute to digestive issues regardless of form.
 * Ambiguous keys (no family) pass through unmodified.
 */
export function mergeScoresForGI(scores: IngredientScore[]): IngredientScore[] {
  // Group by family. Null-family keys pass through as-is.
  const familyGroups = new Map<string, IngredientScore[]>()
  const passThrough: IngredientScore[] = []

  for (const score of scores) {
    // Hydrolyzed proteins are enzymatically broken down — allergenically and
    // digestively distinct from their parent protein. Keep them separate.
    if (score.key.endsWith(" (hydrolyzed)")) {
      passThrough.push({ ...score, isAllergenicallyRelevant: true })
      continue
    }
    const family = extractFamilyFromKey(score.key)
    if (family == null) {
      passThrough.push({ ...score, isAllergenicallyRelevant: true })
    } else {
      const group = familyGroups.get(family)
      if (group) {
        group.push(score)
      } else {
        familyGroups.set(family, [score])
      }
    }
  }

  const merged: IngredientScore[] = [...passThrough]

  for (const [family, group] of familyGroups) {
    if (group.length === 1) {
      // Single form — pass through with family key, mark as GI-relevant
      merged.push({ ...group[0], key: family, isAllergenicallyRelevant: true })
      continue
    }

    // Multi-form merge
    const bestPosition = Math.min(...group.map((s) => s.bestPosition))
    const dayCount = Math.max(...group.map((s) => s.dayCount))
    const daysWithEventLogs = Math.max(...group.map((s) => s.daysWithEventLogs))
    const daysWithScorecardOnly = Math.max(...group.map((s) => s.daysWithScorecardOnly))
    const daysWithBackfill = Math.max(...group.map((s) => s.daysWithBackfill))

    // Worst-score (max) across forms — for elimination diet purposes, a bad
    // signal from any form should surface, not be averaged away by neutral data
    // from low-volume forms (e.g. treats).
    const poopScores = group.filter((s) => s.weightedPoopScore != null).map((s) => s.weightedPoopScore!)
    const weightedPoopScore = poopScores.length > 0 ? Math.max(...poopScores) : null

    const itchScores = group.filter((s) => s.weightedItchScore != null).map((s) => s.weightedItchScore!)
    const weightedItchScore = itchScores.length > 0 ? Math.max(...itchScores) : null

    // Raw averages — same worst-score approach
    const rawPoopScores = group.filter((s) => s.rawAvgPoopScore != null).map((s) => s.rawAvgPoopScore!)
    const rawAvgPoopScore = rawPoopScores.length > 0 ? Math.max(...rawPoopScores) : null

    const rawItchScores = group.filter((s) => s.rawAvgItchScore != null).map((s) => s.rawAvgItchScore!)
    const rawAvgItchScore = rawItchScores.length > 0 ? Math.max(...rawItchScores) : null

    // Cross-reactivity: carry from any form that has them
    const crossReactivityGroup = group.find((s) => s.crossReactivityGroup)?.crossReactivityGroup
    const crossReactivityWarning = group.find((s) => s.crossReactivityWarning)?.crossReactivityWarning

    merged.push({
      key: family,
      dayCount,
      weightedPoopScore,
      weightedItchScore,
      rawAvgPoopScore,
      rawAvgItchScore,
      vomitCount: Math.max(...group.map((s) => s.vomitCount)),
      badDayCount: Math.max(...group.map((s) => s.badDayCount)),
      goodDayCount: Math.max(...group.map((s) => s.goodDayCount)),
      badPoopDayCount: Math.max(...group.map((s) => s.badPoopDayCount)),
      goodPoopDayCount: Math.max(...group.map((s) => s.goodPoopDayCount)),
      badItchDayCount: Math.max(...group.map((s) => s.badItchDayCount)),
      goodItchDayCount: Math.max(...group.map((s) => s.goodItchDayCount)),
      confidence: computeConfidence(daysWithEventLogs, daysWithScorecardOnly, daysWithBackfill),
      exposureFraction: Math.max(...group.map((s) => s.exposureFraction)),
      bestPosition,
      positionCategory: positionCategory(bestPosition),
      appearedInTreats: group.some((s) => s.appearedInTreats),
      excludedDays: Math.max(...group.map((s) => s.excludedDays)),
      daysWithEventLogs,
      daysWithScorecardOnly,
      daysWithBackfill,
      isAllergenicallyRelevant: true,
      isSplit: group.some((s) => s.isSplit),
      distinctProductCount: group.reduce((sum, s) => sum + s.distinctProductCount, 0),
      crossReactivityGroup,
      crossReactivityWarning,
      formBreakdown: group.map((s) => ({
        key: s.key,
        weightedPoopScore: s.weightedPoopScore,
        weightedItchScore: s.weightedItchScore,
        dayCount: s.dayCount,
      })),
    })
  }

  return merged
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function runCorrelation(
  input: CorrelationInput,
  options: CorrelationOptions,
): CorrelationResult {
  const daySnapshots = buildDaySnapshots(input, options)
  const backfillSnaps = buildBackfillSnapshots(input)

  // Merge: day-by-day snapshots + backfill virtual snapshots
  const allSnapshots = [...daySnapshots, ...backfillSnaps]

  let scores = computeIngredientScores(allSnapshots, options)
  scores = flagCrossReactivity(scores, input.crossReactivityGroups)

  // Count scoreable days and collect distinct product IDs
  const allProductIds = new Set<string>()
  let scoreableDays = 0
  for (const snap of allSnapshots) {
    if (snap.isTransitionBuffer || snap.isExposureBuffer) continue
    if (
      options.excludeMedicationPeriods &&
      (snap.outcome.onItchinessMedication || snap.outcome.onDigestiveMedication)
    ) {
      continue
    }
    const isScoreable =
      snap.outcome.poopScore != null ||
      snap.outcome.itchScore != null ||
      snap.outcome.vomitCount > 0 ||
      (options.includeScorecardFallback && snap.outcome.scorecardPoopFallback != null)
    if (isScoreable) {
      scoreableDays++
      for (const ing of snap.ingredients) {
        for (const pid of ing.productIds) {
          allProductIds.add(pid)
        }
      }
    }
  }

  const giMergedScores = mergeScoresForGI(scores)

  return {
    dogId: input.dogId,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    totalDays: daySnapshots.length,
    scoreableDays,
    totalDistinctProducts: allProductIds.size,
    scores,
    giMergedScores,
    options,
  }
}
