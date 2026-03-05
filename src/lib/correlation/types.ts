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
  bestPosition: number
  fromTreat: boolean
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
}

// ---------------------------------------------------------------------------
// Scoring types
// ---------------------------------------------------------------------------

export interface IngredientScore {
  key: string
  dayCount: number
  avgPoopScore: number | null
  avgItchScore: number | null
  vomitCount: number
  badDayCount: number
  goodDayCount: number
  confidence: Confidence
  exposureFraction: number
  bestPosition: number
  appearedInTreats: boolean
  excludedDays: number
  daysWithEventLogs: number
  daysWithScorecardOnly: number
  crossReactivityGroup?: string
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
  scores: IngredientScore[]
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
}

export interface RawTreatLog {
  date: string
  productId: string
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
  poopQuality: number | null
}

export interface RawPollenLog {
  date: string
  pollenIndex: number | null
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
  crossReactivityGroups: CrossReactivityGroup[]
}
