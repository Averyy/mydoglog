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
}

export const DEFAULT_SCORING_CONSTANTS: ScoringConstants = {
  positionWeights: { lambda: 0.15 },
  badDayMultiplier: 3.0,
  goodDayMultiplier: 1.0,
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
  vomitCount: number
  scorecardPoopFallback: number | null
  onItchinessMedication: boolean
  onDigestiveMedication: boolean
  pollenIndex: number | null
  hasAccidentalExposure: boolean
}

/** Full snapshot for one calendar day. */
export interface DaySnapshot {
  date: string
  ingredients: ActiveIngredient[]
  outcome: DayOutcome
  isTransitionBuffer: boolean
  isExposureBuffer: boolean
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
  vomitCount: number
  badDayCount: number
  goodDayCount: number
  badPoopDayCount: number
  goodPoopDayCount: number
  badItchDayCount: number
  goodItchDayCount: number
  confidence: Confidence
  exposureFraction: number
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
  digestiveImpact: string | null
  itchinessImpact: string | null
  /** Original ingredient form key when merged into a family group (e.g. "corn (oil)"). */
  formKey?: string
}

export interface CorrelationOptions {
  transitionBufferDays: number
  exposureBufferDays: number
  includeScorecardFallback: boolean
  excludeMedicationPeriods: boolean
}

export const DEFAULT_CORRELATION_OPTIONS: CorrelationOptions = {
  transitionBufferDays: 5,
  exposureBufferDays: 5,
  includeScorecardFallback: true,
  excludeMedicationPeriods: false,
}

export interface CorrelationResult {
  dogId: string
  windowStart: string
  windowEnd: string
  totalDays: number
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

export interface RawVomitLog {
  date: string
}

export interface RawAccidentalExposure {
  date: string
}

export interface RawMedication {
  startDate: string
  endDate: string | null
  reason: string | null
}

export interface RawScorecard {
  planGroupId: string
  poopQuality: number[] | null
  digestiveImpact: string | null
  itchinessImpact: string | null
  itchSeverity: number[] | null
}

export interface RawPollenLog {
  date: string
  pollenIndex: number | null
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
  vomitLogs: RawVomitLog[]
  accidentalExposures: RawAccidentalExposure[]
  medications: RawMedication[]
  scorecards: RawScorecard[]
  pollenLogs: RawPollenLog[]
  planPeriods: PlanPeriod[]
  backfills: RawBackfill[]
  crossReactivityGroups: CrossReactivityGroup[]
  /** Product ID → product info (type + format + calorie content). Used for gram estimation. */
  productInfo: Map<string, { type: string; format: string; calorieContent: string | null }>
}
