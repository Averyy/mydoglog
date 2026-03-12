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

/** Chart data point for one calendar day. */
export interface TimelineDataPoint {
  date: string // YYYY-MM-DD
  poopScore: number | null // worst score for the day, null = no log
  itchScore: number // 0 = not logged / no itch
  pollenLevel: number | null // 0-4 daily max, null = no data (used for background band color)
  rawPollenLevel: number | null // raw daily pollen level for tooltip
  rawSporeLevel: number | null // raw daily spore level for tooltip
}

/** Gantt bar data shared between API response and client rendering. */
export interface GanttBarData {
  id: string
  label: string
  startDate: string
  endDate: string
  category: "food" | "medication" | "supplement"
  meta?: {
    brandName?: string
    quantity?: string
    quantityUnit?: string
    dosage?: string
    interval?: string
    dosageForm?: string
    imageUrl?: string
  }
}

/** Full timeline API response shape. */
export interface TimelineData {
  chartData: TimelineDataPoint[]
  ganttBars: GanttBarData[]
  startDate: string
  endDate: string
}
