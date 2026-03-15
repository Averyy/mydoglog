/**
 * Correlation engine — pure functions, no DB access.
 * All logic is testable with plain data.
 */

import { resolveActivePlan } from "@/lib/feeding"
import { capitalize } from "@/lib/utils"
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
  RawMedicationPeriod,
} from "./types"
import { DEFAULT_SCORING_CONSTANTS } from "./types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Average an array of scores, rounding to one decimal. Returns 0 for empty arrays. */
export function averageScores(scores: number[]): number {
  if (scores.length === 0) return 0
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
// Date utilities (re-exported from shared module)
// ---------------------------------------------------------------------------

import { enumerateDates } from "@/lib/date-utils"

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

/** Build a Map from date string to array of items for O(1) date lookups. */
function indexByDate<T extends { date: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const existing = map.get(item.date)
    if (existing) {
      existing.push(item)
    } else {
      map.set(item.date, [item])
    }
  }
  return map
}

/** Get effective pollen level for a single date: max(pollenLevel, sporeLevel ?? 0). */
function dailyPollenLevel(
  pollenByDate: Map<string, CorrelationInput["pollenLogs"]>,
  date: string,
): number | null {
  const rows = pollenByDate.get(date)
  if (!rows || rows.length === 0) return null
  const r = rows[0]
  return Math.max(r.pollenLevel, r.sporeLevel ?? 0)
}

/** Subtract N days from a YYYY-MM-DD date string. */
function subtractDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/**
 * Compute 3-day rolling max of effective pollen level (day, day-1, day-2).
 * Uses available days only — missing days are skipped, not zero-filled.
 * Returns null if no pollen data exists for any of the 3 days.
 */
export function computeRollingMaxPollen(
  date: string,
  pollenByDate: Map<string, CorrelationInput["pollenLogs"]>,
): number | null {
  const levels: number[] = []
  for (let i = 0; i < 3; i++) {
    const d = subtractDays(date, i)
    const level = dailyPollenLevel(pollenByDate, d)
    if (level != null) levels.push(level)
  }
  return levels.length > 0 ? Math.max(...levels) : null
}

/**
 * Compute seasonal confounding flag for an ingredient.
 * True when enough pollen-observed bad itch days exist AND a high fraction overlap high pollen.
 */
function computeSeasonalConfounding(acc: IngredientAccumulator): boolean {
  const totalPollenDays = acc.highPollenBadItchDays + acc.lowPollenBadItchDays
  if (totalPollenDays < DEFAULT_SCORING_CONSTANTS.seasonalConfoundingMinDays) return false
  return acc.highPollenBadItchDays / totalPollenDays > DEFAULT_SCORING_CONSTANTS.seasonalConfoundingThreshold
}

/** Pre-indexed lookup tables for O(1) per-date access in the day loop. */
interface DateIndex {
  poopByDate: Map<string, CorrelationInput["poopLogs"]>
  itchByDate: Map<string, CorrelationInput["itchinessLogs"]>
  pollenByDate: Map<string, CorrelationInput["pollenLogs"]>
  treatByDate: Map<string, CorrelationInput["treatLogs"]>
  scorecardByGroupId: Map<string, CorrelationInput["scorecards"][number]>
}

function buildDateIndex(input: CorrelationInput): DateIndex {
  return {
    poopByDate: indexByDate(input.poopLogs),
    itchByDate: indexByDate(input.itchinessLogs),
    pollenByDate: indexByDate(input.pollenLogs),
    treatByDate: indexByDate(input.treatLogs),
    scorecardByGroupId: new Map(input.scorecards.map((sc) => [sc.planGroupId, sc])),
  }
}

/** Check if any medication with the given flag overlaps a date. */
export function annotateMedicationFlags(
  date: string,
  medicationPeriods: RawMedicationPeriod[],
): { onItchSuppressant: boolean; onGiSideEffectMed: boolean } {
  let onItchSuppressant = false
  let onGiSideEffectMed = false
  for (const med of medicationPeriods) {
    if (med.startDate <= date && (med.endDate == null || med.endDate >= date)) {
      if (med.suppressesItch) onItchSuppressant = true
      if (med.hasGiSideEffects) onGiSideEffectMed = true
      if (onItchSuppressant && onGiSideEffectMed) break
    }
  }
  return { onItchSuppressant, onGiSideEffectMed }
}

function buildDayOutcome(
  date: string,
  input: CorrelationInput,
  idx: DateIndex,
): DayOutcome {
  // Poop score: average of all logs for this date
  const poopLogsForDate = idx.poopByDate.get(date) ?? []
  const poopScore =
    poopLogsForDate.length > 0
      ? poopLogsForDate.reduce((sum, l) => sum + l.firmnessScore, 0) /
        poopLogsForDate.length
      : null

  // Itch score: average of all logs for this date
  const itchLogsForDate = idx.itchByDate.get(date) ?? []
  const itchScore =
    itchLogsForDate.length > 0
      ? itchLogsForDate.reduce((sum, l) => sum + l.score, 0) /
        itchLogsForDate.length
      : null

  // Scorecard fallback: only when no poop logs exist
  let scorecardPoopFallback: number | null = null
  if (poopScore == null) {
    const activePlanGroupId = resolveActivePlan(input.planPeriods, date)
    if (activePlanGroupId != null) {
      const scorecard = idx.scorecardByGroupId.get(activePlanGroupId)
      if (scorecard?.poopQuality != null && scorecard.poopQuality.length > 0) {
        scorecardPoopFallback = averageScores(scorecard.poopQuality)
      }
    }
  }

  // Pollen: 3-day rolling max of max(pollenLevel, sporeLevel ?? 0)
  const effectivePollenLevel = computeRollingMaxPollen(date, idx.pollenByDate)

  // Medication flags
  const medFlags = annotateMedicationFlags(date, input.medicationPeriods)

  return {
    poopScore,
    itchScore,
    scorecardPoopFallback,
    effectivePollenLevel,
    onItchSuppressant: medFlags.onItchSuppressant,
    onGiSideEffectMed: medFlags.onGiSideEffectMed,
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

  // Pre-index all log arrays by date for O(1) lookups
  const idx = buildDateIndex(input)

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
    const treatLogsForDate = idx.treatByDate.get(date) ?? []
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
        // Suppress double buffer: if new products are subset of old, don't start countdown
        // (e.g. removing a product isn't a transition)
        const isSubset = [...foodProductIds].every((id) => prevFoodProductIds!.has(id))
        if (!isSubset) {
          // Use feeding period's transitionDays if available, else default
          const periodTransitionDays = activePeriods.find((fp) => fp.transitionDays != null)?.transitionDays
          transitionCountdown = periodTransitionDays ?? options.transitionBufferDays
        }
      }
    }
    const isTransitionBuffer = transitionCountdown > 0
    if (transitionCountdown > 0) transitionCountdown--

    // Build outcome
    const outcome = buildDayOutcome(date, input, idx)

    snapshots.push({
      date,
      ingredients,
      outcome,
      isTransitionBuffer,
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
  highPollenBadItchDays: number
  lowPollenBadItchDays: number
  // Medication on/off split accumulators
  onItchMedItchSum: number
  onItchMedItchCount: number
  offItchMedItchSum: number
  offItchMedItchCount: number
  onGiMedPoopSum: number
  onGiMedPoopCount: number
  offGiMedPoopSum: number
  offGiMedPoopCount: number
}

export function computeIngredientScores(
  snapshots: DaySnapshot[],
  options: CorrelationOptions,
): IngredientScore[] {
  // Filter out excluded days
  const filtered = snapshots.filter((snap) => {
    if (snap.isTransitionBuffer) return false
    return true
  })

  // Identify scoreable days: at least one outcome signal
  const scoreable = filtered.filter((snap) => {
    if (snap.outcome.poopScore != null) return true
    if (snap.outcome.itchScore != null) return true
    if (
      options.includeScorecardFallback &&
      snap.outcome.scorecardPoopFallback != null
    ) {
      return true
    }
    return false
  })

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
          highPollenBadItchDays: 0,
          lowPollenBadItchDays: 0,
          onItchMedItchSum: 0,
          onItchMedItchCount: 0,
          offItchMedItchSum: 0,
          offItchMedItchCount: 0,
          onGiMedPoopSum: 0,
          onGiMedPoopCount: 0,
          offGiMedPoopSum: 0,
          offGiMedPoopCount: 0,
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

        const isBadItchDay = snap.outcome.itchScore >= 4

        // Pollen discount: reduce weight of bad itch days during high pollen
        // Good itch days keep full weight regardless of pollen
        let pollenDiscount = 1.0
        if (isBadItchDay && snap.outcome.effectivePollenLevel != null) {
          if (snap.outcome.effectivePollenLevel >= 3) {
            pollenDiscount = DEFAULT_SCORING_CONSTANTS.pollenDiscountHigh
          } else if (snap.outcome.effectivePollenLevel >= 2) {
            pollenDiscount = DEFAULT_SCORING_CONSTANTS.pollenDiscountModerate
          }
        }

        // Weighted: itch >= 4 is bad — standard position decay (additives don't cause skin reactions)
        const dayWeight = (isBadItchDay
          ? DEFAULT_SCORING_CONSTANTS.badDayMultiplier
          : DEFAULT_SCORING_CONSTANTS.goodDayMultiplier) * pollenDiscount
        acc.weightedItchNumerator += snap.outcome.itchScore * vpw * dayWeight
        acc.weightedItchDenominator += vpw * dayWeight

        if (isBadItchDay) {
          acc.badItchDays++
          // Track pollen overlap for seasonal confounding (only when pollen data exists)
          if (snap.outcome.effectivePollenLevel != null) {
            if (snap.outcome.effectivePollenLevel >= 2) {
              acc.highPollenBadItchDays++
            } else {
              acc.lowPollenBadItchDays++
            }
          }
        }
        if (snap.outcome.itchScore <= 2) acc.goodItchDays++
      }

      // Union counts: a day is "bad" if EITHER track is bad (counted once)
      const poopBad = effectivePoop != null && effectivePoop >= 5
      const itchBad = snap.outcome.itchScore != null && snap.outcome.itchScore >= 4
      if (poopBad || itchBad) acc.badDays++

      const poopGood = effectivePoop != null && effectivePoop <= 3
      const itchGood = snap.outcome.itchScore != null && snap.outcome.itchScore <= 2
      if (poopGood || itchGood) acc.goodDays++

      // Medication on/off split accumulation
      if (effectivePoop != null) {
        if (snap.outcome.onGiSideEffectMed) {
          acc.onGiMedPoopSum += effectivePoop
          acc.onGiMedPoopCount++
        } else {
          acc.offGiMedPoopSum += effectivePoop
          acc.offGiMedPoopCount++
        }
      }

      if (snap.outcome.itchScore != null) {
        if (snap.outcome.onItchSuppressant) {
          acc.onItchMedItchSum += snap.outcome.itchScore
          acc.onItchMedItchCount++
        } else {
          acc.offItchMedItchSum += snap.outcome.itchScore
          acc.offItchMedItchCount++
        }
      }

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
      itchSeasonallyConfounded: computeSeasonalConfounding(acc),
      itchMedicationConfounded: acc.onItchMedItchCount > 0 &&
        acc.onItchMedItchCount / (acc.onItchMedItchCount + acc.offItchMedItchCount) >= 0.5,
      poopMedicationConfounded: acc.onGiMedPoopCount > 0 &&
        acc.onGiMedPoopCount / (acc.onGiMedPoopCount + acc.offGiMedPoopCount) >= 0.5,
      onMedRawAvgItchScore: acc.onItchMedItchCount > 0 ? acc.onItchMedItchSum / acc.onItchMedItchCount : null,
      offMedRawAvgItchScore: acc.offItchMedItchCount > 0 ? acc.offItchMedItchSum / acc.offItchMedItchCount : null,
      onMedRawAvgPoopScore: acc.onGiMedPoopCount > 0 ? acc.onGiMedPoopSum / acc.onGiMedPoopCount : null,
      offMedRawAvgPoopScore: acc.offGiMedPoopCount > 0 ? acc.offGiMedPoopSum / acc.offGiMedPoopCount : null,
      onItchMedDays: acc.onItchMedItchCount,
      offItchMedDays: acc.offItchMedItchCount,
      onGiMedDays: acc.onGiMedPoopCount,
      offGiMedDays: acc.offGiMedPoopCount,
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

/** Returns true if the score has elevated poop or itch signals. */
function hasBadSignal(s: IngredientScore): boolean {
  return (
    (s.weightedPoopScore != null && s.weightedPoopScore >= 4.0) ||
    (s.weightedItchScore != null && s.weightedItchScore >= 4.0) ||
    (s.dayCount > 0 && s.badPoopDayCount / s.dayCount > 0.3) ||
    (s.dayCount > 0 && s.badItchDayCount / s.dayCount > 0.3)
  )
}

/**
 * Maps source_group values to cross-reactivity group names when they differ.
 * Must stay in sync with cross_reactivity_groups in scraper/build_families.py.
 */
const SOURCE_GROUP_TO_CROSS_REACTIVITY: Record<string, string[]> = {
  red_meat: ["cattle_sheep", "deer_elk", "pork"],
  dairy: ["cattle_sheep"],
  crustacean: ["shellfish", "arthropod"],
  mollusk: ["shellfish"],
  grain: ["gluten_grains"],
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
      if (hasBadSignal(s)) badFamilies.add(family)
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
          s.crossReactivityWarning = `${capitalize(badFamily)} scored poorly \u2014 ${capitalize(family)} is in the same ${group.groupName.replaceAll("_", " ")} family and may cause similar reactions`
        }
      }
    }
  }

  // Handle ambiguous ingredients: if "poultry (ambiguous)" exists and any
  // specific family in a related cross-reactivity group has bad signals, warn
  // the ambiguous key. Source groups may map to multiple cross-reactivity groups
  // (e.g. "red_meat" spans cattle_sheep, deer_elk, and pork).
  for (const s of result) {
    const sourceGroup = extractSourceGroupFromAmbiguousKey(s.key)
    if (sourceGroup == null) continue

    // Find all groups whose families overlap with this source group and
    // collect bad families across all matching groups into a single warning
    const allBad: IngredientScore[] = []
    for (const group of groups) {
      if (group.groupName !== sourceGroup && !SOURCE_GROUP_TO_CROSS_REACTIVITY[sourceGroup]?.includes(group.groupName)) continue

      const familySet = new Set(group.families)
      const badInGroup = result.filter((other) => {
        if (isNonAllergenicKey(other.key)) return false
        const family = extractFamilyFromKey(other.key)
        if (family == null || !familySet.has(family)) return false
        return hasBadSignal(other)
      })
      allBad.push(...badInGroup)
    }

    if (allBad.length > 0) {
      const seen = new Set<string>()
      const badNames = allBad
        .map((b) => extractFamilyFromKey(b.key))
        .filter((f): f is string => f != null && !seen.has(f) && (seen.add(f), true))
        .map((f) => capitalize(f))
        .join(", ")
      s.crossReactivityWarning = `This could be any ${sourceGroup.replaceAll("_", " ")} protein \u2014 and ${badNames} scored poorly`
    }
  }

  return result
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

    const medFlags = annotateMedicationFlags(date, input.medicationPeriods)

    snapshots.push({
      date: `backfill:${date}`,
      ingredients,
      outcome: {
        poopScore: avgPoop,
        itchScore: avgItch,
        scorecardPoopFallback: null,
        effectivePollenLevel: null,
        onItchSuppressant: medFlags.onItchSuppressant,
        onGiSideEffectMed: medFlags.onGiSideEffectMed,
      },
      isTransitionBuffer: false,
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

    // Medication confounding: sum day counts across forms and recompute flags
    // Using sum (not max) because each form tracks distinct days independently.
    // Using some() would let a 6-day treat flag a 473-day protein family.
    const totalOnItchMedDays = group.reduce((sum, s) => sum + s.onItchMedDays, 0)
    const totalOffItchMedDays = group.reduce((sum, s) => sum + s.offItchMedDays, 0)
    const totalOnGiMedDays = group.reduce((sum, s) => sum + s.onGiMedDays, 0)
    const totalOffGiMedDays = group.reduce((sum, s) => sum + s.offGiMedDays, 0)

    // Weighted average for on/off splits (weighted by day count per form)
    let onMedPoopSum = 0, onMedPoopCount = 0
    let offMedPoopSum = 0, offMedPoopCount = 0
    let onMedItchSum = 0, onMedItchCount = 0
    let offMedItchSum = 0, offMedItchCount = 0
    for (const s of group) {
      if (s.onMedRawAvgPoopScore != null) {
        onMedPoopSum += s.onMedRawAvgPoopScore * s.onGiMedDays
        onMedPoopCount += s.onGiMedDays
      }
      if (s.offMedRawAvgPoopScore != null) {
        offMedPoopSum += s.offMedRawAvgPoopScore * s.offGiMedDays
        offMedPoopCount += s.offGiMedDays
      }
      if (s.onMedRawAvgItchScore != null) {
        onMedItchSum += s.onMedRawAvgItchScore * s.onItchMedDays
        onMedItchCount += s.onItchMedDays
      }
      if (s.offMedRawAvgItchScore != null) {
        offMedItchSum += s.offMedRawAvgItchScore * s.offItchMedDays
        offMedItchCount += s.offItchMedDays
      }
    }

    merged.push({
      key: family,
      dayCount,
      weightedPoopScore,
      weightedItchScore,
      rawAvgPoopScore,
      rawAvgItchScore,
      badDayCount: Math.max(...group.map((s) => s.badDayCount)),
      goodDayCount: Math.max(...group.map((s) => s.goodDayCount)),
      badPoopDayCount: Math.max(...group.map((s) => s.badPoopDayCount)),
      goodPoopDayCount: Math.max(...group.map((s) => s.goodPoopDayCount)),
      badItchDayCount: Math.max(...group.map((s) => s.badItchDayCount)),
      goodItchDayCount: Math.max(...group.map((s) => s.goodItchDayCount)),
      confidence: computeConfidence(daysWithEventLogs, daysWithScorecardOnly, daysWithBackfill),
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
      itchSeasonallyConfounded: group.some((s) => s.itchSeasonallyConfounded),
      itchMedicationConfounded: totalOnItchMedDays > 0 &&
        totalOnItchMedDays / (totalOnItchMedDays + totalOffItchMedDays) >= 0.5,
      poopMedicationConfounded: totalOnGiMedDays > 0 &&
        totalOnGiMedDays / (totalOnGiMedDays + totalOffGiMedDays) >= 0.5,
      onMedRawAvgItchScore: onMedItchCount > 0 ? onMedItchSum / onMedItchCount : null,
      offMedRawAvgItchScore: offMedItchCount > 0 ? offMedItchSum / offMedItchCount : null,
      onMedRawAvgPoopScore: onMedPoopCount > 0 ? onMedPoopSum / onMedPoopCount : null,
      offMedRawAvgPoopScore: offMedPoopCount > 0 ? offMedPoopSum / offMedPoopCount : null,
      onItchMedDays: totalOnItchMedDays,
      offItchMedDays: totalOffItchMedDays,
      onGiMedDays: totalOnGiMedDays,
      offGiMedDays: totalOffGiMedDays,
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
    if (snap.isTransitionBuffer) continue
    const isScoreable =
      snap.outcome.poopScore != null ||
      snap.outcome.itchScore != null ||
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
    totalDays: allSnapshots.length,
    loggedDays: daySnapshots.length,
    backfillDays: backfillSnaps.length,
    scoreableDays,
    totalDistinctProducts: allProductIds.size,
    scores,
    giMergedScores,
    options,
  }
}
