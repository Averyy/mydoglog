/**
 * Correlation engine types.
 * No Drizzle imports — all raw input types are plain interfaces.
 */

import type { PlanPeriod } from "@/lib/feeding"

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export type Confidence = "high" | "medium" | "low" | "insufficient"

// ---------------------------------------------------------------------------
// Position categories
// ---------------------------------------------------------------------------

export type PositionCategory = "primary" | "secondary" | "minor" | "trace"

// ---------------------------------------------------------------------------
// Scoring constants
// ---------------------------------------------------------------------------

export interface ScoringConstants {
  positionWeights: {
    lambda: number
  }
  badDayMultiplier: number
  goodDayMultiplier: number
  /** Pollen discount applied to bad itch days at high/very high level (3-4). */
  pollenDiscountHigh: number
  /** Pollen discount applied to bad itch days at moderate level (2). */
  pollenDiscountModerate: number
  /** Minimum days with pollen data to compute seasonal confounding flag. */
  seasonalConfoundingMinDays: number
  /** Fraction of bad itch days during high pollen to flag confounding (0-1). */
  seasonalConfoundingThreshold: number
}

export const DEFAULT_SCORING_CONSTANTS: ScoringConstants = {
  positionWeights: { lambda: 0.15 },
  badDayMultiplier: 3.0,
  goodDayMultiplier: 1.0,
  pollenDiscountHigh: 0.4,
  pollenDiscountModerate: 0.7,
  seasonalConfoundingMinDays: 14,
  seasonalConfoundingThreshold: 0.6,
}

// ---------------------------------------------------------------------------
// Ingredient records (from DB)
// ---------------------------------------------------------------------------

export interface IngredientRecord {
  id: string
  normalizedName: string
  family: string | null
  sourceGroup: string | null
  formType: string | null
  isHydrolyzed: boolean
}

export interface ProductIngredientRecord {
  productId: string
  position: number
  ingredient: IngredientRecord
}

// ---------------------------------------------------------------------------
// Day-level types
// ---------------------------------------------------------------------------

/** One resolved ingredient key for a single day. */
export interface ActiveIngredient {
  key: string
  ingredientIds: string[]
  productIds: string[]
  bestPosition: number
  worstPosition: number
  ingredientCount: number
  fromTreat: boolean
  formType: string | null
  sourceGroup: string | null
  /** Volume-weighted position weight (0–1). Accounts for product's share of daily intake. */
  volumePositionWeight: number
}

/** Outcome signals for one calendar day. */
export interface DayOutcome {
  poopScore: number | null
  itchScore: number | null
  scorecardPoopFallback: number | null
  /** 3-day rolling max of max(pollenLevel, sporeLevel ?? 0). Null when no pollen data. */
  effectivePollenLevel: number | null
  onItchSuppressant: boolean
  onGiSideEffectMed: boolean
}

/** Full snapshot for one calendar day. */
export interface DaySnapshot {
  date: string
  ingredients: ActiveIngredient[]
  outcome: DayOutcome
  isTransitionBuffer: boolean
  isBackfill: boolean
}

// ---------------------------------------------------------------------------
// Scoring types
// ---------------------------------------------------------------------------

export interface IngredientScore {
  key: string
  dayCount: number
  weightedPoopScore: number | null
  weightedItchScore: number | null
  rawAvgPoopScore: number | null
  rawAvgItchScore: number | null
  badDayCount: number
  goodDayCount: number
  badPoopDayCount: number
  goodPoopDayCount: number
  badItchDayCount: number
  goodItchDayCount: number
  confidence: Confidence
  bestPosition: number
  positionCategory: PositionCategory
  appearedInTreats: boolean
  excludedDays: number
  daysWithEventLogs: number
  daysWithScorecardOnly: number
  daysWithBackfill: number
  isAllergenicallyRelevant: boolean
  isSplit: boolean
  distinctProductCount: number
  itchSeasonallyConfounded: boolean
  itchMedicationConfounded: boolean
  poopMedicationConfounded: boolean
  onMedRawAvgItchScore: number | null
  offMedRawAvgItchScore: number | null
  onMedRawAvgPoopScore: number | null
  offMedRawAvgPoopScore: number | null
  onItchMedDays: number
  offItchMedDays: number
  onGiMedDays: number
  offGiMedDays: number
  crossReactivityGroup?: string
  crossReactivityWarning?: string
  /** When GI-merged from multiple forms, shows per-form scores. */
  formBreakdown?: { key: string; weightedPoopScore: number | null; weightedItchScore: number | null; dayCount: number }[]
}

export interface IngredientProductEntry {
  productId: string
  productName: string
  brandName: string
  position: number
  positionCategory: PositionCategory
  productType: string
  avgPoopScore: number | null
  avgItchScore: number | null
  /** Original ingredient form key when merged into a family group (e.g. "corn (oil)"). */
  formKey?: string
}

export interface CorrelationOptions {
  transitionBufferDays: number
  includeScorecardFallback: boolean
}

export const DEFAULT_CORRELATION_OPTIONS: CorrelationOptions = {
  transitionBufferDays: 5,
  includeScorecardFallback: true,
}

export interface CorrelationResult {
  dogId: string
  windowStart: string
  windowEnd: string
  totalDays: number
  loggedDays: number
  backfillDays: number
  scoreableDays: number
  totalDistinctProducts: number
  scores: IngredientScore[]
  giMergedScores: IngredientScore[]
  options: CorrelationOptions
}

export interface CrossReactivityGroup {
  groupName: string
  families: string[]
}

// ---------------------------------------------------------------------------
// Raw input types (match DB output shape, no Drizzle imports)
// ---------------------------------------------------------------------------

export interface RawFeedingPeriod {
  id: string
  productId: string
  startDate: string
  endDate: string | null
  planGroupId: string
  createdAt: string
  quantity: number
  quantityUnit: string
  transitionDays?: number | null
}

export interface RawTreatLog {
  date: string
  productId: string
  quantity: number
  quantityUnit: string
}

export interface RawPoopLog {
  date: string
  firmnessScore: number
}

export interface RawItchinessLog {
  date: string
  score: number
}

export interface RawScorecard {
  planGroupId: string
  poopQuality: number[] | null
  itchSeverity: number[] | null
}

export interface RawPollenLog {
  date: string
  pollenLevel: number
  sporeLevel: number | null
}

export interface RawMedicationPeriod {
  name: string
  startDate: string
  endDate: string | null
  suppressesItch: boolean
  hasGiSideEffects: boolean
}

/** A backfill entry — aggregate historical record with duration + scorecard. */
export interface RawBackfill {
  planGroupId: string
  productId: string
  startDate: string
  endDate: string
  durationDays: number
  quantity: number
  quantityUnit: string
  scorecard: RawScorecard | null
}

/** Bundle of all raw data from the query layer. */
export interface CorrelationInput {
  dogId: string
  windowStart: string
  windowEnd: string
  feedingPeriods: RawFeedingPeriod[]
  treatLogs: RawTreatLog[]
  productIngredientMap: Map<string, ProductIngredientRecord[]>
  poopLogs: RawPoopLog[]
  itchinessLogs: RawItchinessLog[]
  scorecards: RawScorecard[]
  pollenLogs: RawPollenLog[]
  planPeriods: PlanPeriod[]
  backfills: RawBackfill[]
  crossReactivityGroups: CrossReactivityGroup[]
  /** Product ID → product info (type + format + calorie content). Used for gram estimation. */
  productInfo: Map<string, { type: string; format: string; calorieContent: string | null }>
  medicationPeriods: RawMedicationPeriod[]
}
