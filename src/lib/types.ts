export interface ProductSummary {
  id: string
  name: string
  brandName: string
  brandId: string
  type: string | null
  format: string | null
  channel: string | null
  lifestage: string | null
  imageUrl: string | null
  isDiscontinued: boolean
  calorieContent: string | null
}

export interface TreatSummary {
  productId: string
  productName: string
  brandName: string
  imageUrl: string | null
  logCount: number
  firstDate: string
  lastDate: string
}

export interface FeedingPlanGroup {
  planGroupId: string
  planName: string | null
  startDate: string
  endDate: string | null
  isBackfill: boolean
  approximateDuration: string | null
  items: FeedingPlanItem[]
  treats: TreatSummary[]
  scorecard: ScorecardSummary | null
  logStats: LogStats | null
  transitionDays?: number | null
  previousPlanGroupId?: string | null
  transitionFromFoodName?: string | null
}

/** Aggregated stats from actual daily logs during a feeding period. */
export interface LogStats {
  avgPoopScore: number | null
  avgItchScore: number | null
  poopLogCount: number
  itchLogCount: number
  daysWithData: number
}

export interface FeedingPlanItem {
  id: string
  productId: string
  productName: string
  brandName: string
  imageUrl: string | null
  type: string | null
  format: string | null
  quantity: string | null
  quantityUnit: string | null
  mealSlot: string | null
}

export interface ScorecardSummary {
  id: string
  poopQuality: number[] | null
  itchSeverity: number[] | null
  notes: string | null
}

export interface ActivePlan {
  planGroupId: string
  planName: string | null
  startDate: string
  endDate: string | null
  items: FeedingPlanItem[]
  transitionDays?: number | null
  previousPlanGroupId?: string | null
  /** Computed: true when transitionDays > 0 and transition is still in progress. */
  isTransitioning?: boolean
  /** Items from the ongoing (post-transition) rows only. */
  targetItems?: FeedingPlanItem[]
}

export interface MedicationSummary {
  id: string
  name: string
  dosage: string | null
  startDate: string
  endDate: string | null
  medicationProductId: string | null
  interval: string | null
  notes: string | null
  dosageForm: string | null
  description: string | null
  commonSideEffects: string | null
  sideEffectsSources: string | null
}

export interface LogFeedEntry {
  id: string
  type: "poop" | "itch" | "treat"
  date: string
  datetime: string | null
  data: Record<string, unknown>
}

export interface LogFeedResponse {
  entries: LogFeedEntry[]
  startDate: string
  endDate: string
}

export interface RoutineData {
  plan: ActivePlan | null
}
