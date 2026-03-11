import { differenceInDays, format, parseISO } from "date-fns"
import { averageScores } from "@/lib/correlation/engine"
import { getToday } from "@/lib/utils"
import type { PositionCategory } from "@/lib/correlation/types"

export function formatDateRange(startDate: string, endDate: string | null): string {
  const start = format(parseISO(startDate), "MMM d, yyyy")
  if (!endDate) return `${start} - Today`
  if (endDate === startDate) return start
  return `${start} - ${format(parseISO(endDate), "MMM d, yyyy")}`
}

export function daysInRange(startDate: string, endDate: string | null): number {
  const today = getToday()
  return differenceInDays(parseISO(endDate ?? today), parseISO(startDate)) + 1
}

/** Compute avg from scorecard range array (e.g. poopQuality [2,4] → 3.0) */
export function avgFromRange(scores: number[] | null): number | null {
  if (!scores || scores.length === 0) return null
  return averageScores(scores)
}

export const POSITION_LABELS: Record<PositionCategory, string> = {
  primary: "Primary",
  secondary: "Secondary",
  minor: "Minor",
  trace: "Trace",
}
