/** Valid range values for the timeline API. */
export type TimelineRange = "7d" | "30d" | "60d" | "90d" | "all"

export const RANGE_OPTIONS: { value: TimelineRange; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "60d", label: "60d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
]

export const RANGE_OFFSETS: Record<TimelineRange, number | null> = {
  "7d": 6,
  "30d": 29,
  "60d": 59,
  "90d": 89,
  "all": null,
}

export function isValidRange(value: string | null): value is TimelineRange {
  return value !== null && value in RANGE_OFFSETS
}

/** Ranges that show individual log entries instead of daily aggregates. */
export const INDIVIDUAL_RANGES: ReadonlySet<TimelineRange> = new Set(["7d"])

/** Chart data point for one calendar day (30d+ ranges). */
export interface TimelineDataPoint {
  date: string // YYYY-MM-DD
  poopScore: number | null // worst score for the day, null = no log
  itchScore: number // 0 = not logged / no itch
  pollenLevel: number | null // 0-4 daily max, null = no data (used for background band color)
  rawPollenLevel: number | null // raw daily pollen level for tooltip
  rawSporeLevel: number | null // raw daily spore level for tooltip
}

/** Chart data point for individual log entries (7d range). */
export interface TimelineIndividualPoint {
  timestamp: number // Unix ms — x-axis dataKey
  date: string // YYYY-MM-DD (for pollen lookup + tooltip)
  time: string | null // "h:mm a" display string, null if datetime was null
  poopScore: number | null
  itchScore: number | null // null on poop-only entries so itch line skips them
  pollenLevel: number | null
  rawPollenLevel: number | null
  rawSporeLevel: number | null
}

/** Gantt bar data shared between API response and client rendering. */
export interface GanttBarData {
  id: string
  label: string
  startDate: string
  endDate: string
  category: "food" | "medication" | "supplement" | "transition"
  meta?: {
    brandName?: string
    quantity?: string
    quantityUnit?: string
    dosage?: string
    interval?: string
    dosageForm?: string
    imageUrl?: string
  }
  transitionMeta?: {
    oldFoodName: string
    newFoodName: string
  }
}

/** Full timeline API response shape. */
export interface TimelineData {
  mode: "daily" | "individual"
  chartData: TimelineDataPoint[] // populated in daily mode
  individualData: TimelineIndividualPoint[] // populated in individual mode (7d)
  dailyPollen?: Record<string, number> // date → level, for individual mode pollen bands
  ganttBars: GanttBarData[]
  startDate: string
  endDate: string
}
