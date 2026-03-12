import { shiftDate, daysBetween } from "@/lib/date-utils"
import type { GanttBarData, TimelineDataPoint } from "@/lib/timeline-types"

// --- Pollen ---

/** Compute daily max pollen level (max of pollen, spore) for each date. */
export function computeDailyMaxPollen(
  rows: { date: string; pollenLevel: number; sporeLevel: number | null }[],
  startDate: string,
  endDate: string,
): Map<string, number> {
  const result = new Map<string, number>()
  for (const row of rows) {
    if (row.date < startDate || row.date > endDate) continue
    const level = Math.max(row.pollenLevel, row.sporeLevel ?? 0)
    result.set(row.date, Math.max(result.get(row.date) ?? 0, level))
  }
  return result
}

// --- Gantt bar merging ---

/** Merge adjacent bars with the same label + category + dosage where gap <= 1 day. */
export function mergeAdjacentBars(bars: GanttBarData[]): GanttBarData[] {
  const sorted = [...bars].sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    if (a.label !== b.label) return a.label.localeCompare(b.label)
    return a.startDate.localeCompare(b.startDate)
  })

  const merged: GanttBarData[] = []
  for (const bar of sorted) {
    const last = merged[merged.length - 1]
    if (
      last &&
      last.label === bar.label &&
      last.category === bar.category &&
      last.meta?.dosage === bar.meta?.dosage &&
      daysBetween(last.endDate, bar.startDate) <= 1
    ) {
      last.endDate = bar.endDate > last.endDate ? bar.endDate : last.endDate
    } else {
      merged.push({ ...bar })
    }
  }
  return merged
}

// --- Backfill scorecard map ---

export interface ScorecardRow {
  planGroupId: string
  poopQuality: number[] | null
  itchSeverity: number[] | null
}

export function buildScorecardMap(
  scorecardRows: ScorecardRow[],
): Map<string, { poopAvg: number | null; itchAvg: number | null }> {
  const map = new Map<string, { poopAvg: number | null; itchAvg: number | null }>()
  for (const sc of scorecardRows) {
    const poopAvg = sc.poopQuality?.length
      ? sc.poopQuality.reduce((a: number, b: number) => a + b, 0) / sc.poopQuality.length
      : null
    const itchAvg = sc.itchSeverity?.length
      ? sc.itchSeverity.reduce((a: number, b: number) => a + b, 0) / sc.itchSeverity.length
      : null
    map.set(sc.planGroupId, { poopAvg, itchAvg })
  }
  return map
}

// --- Backfill day expansion ---

interface BackfillPeriod {
  startDate: string
  endDate: string | null
  isBackfill: boolean
  planGroupId: string
}

export function buildBackfillDayMaps(
  feedingRows: BackfillPeriod[],
  scorecardMap: Map<string, { poopAvg: number | null; itchAvg: number | null }>,
  windowStart: string,
  today: string,
): { backfillPoopByDay: Map<string, number>; backfillItchByDay: Map<string, number> } {
  const backfillPoopByDay = new Map<string, number>()
  const backfillItchByDay = new Map<string, number>()

  const sorted = [...feedingRows].sort((a, b) => a.startDate.localeCompare(b.startDate))
  for (const fp of sorted) {
    if (!fp.isBackfill) continue
    const sc = scorecardMap.get(fp.planGroupId)
    if (!sc) continue
    const periodEnd = fp.endDate ?? today
    let d = fp.startDate < windowStart ? windowStart : fp.startDate
    while (d <= periodEnd && d <= today) {
      if (sc.poopAvg !== null && !backfillPoopByDay.has(d)) {
        backfillPoopByDay.set(d, Math.round(sc.poopAvg))
      }
      if (sc.itchAvg !== null && !backfillItchByDay.has(d)) {
        backfillItchByDay.set(d, Math.round(sc.itchAvg))
      }
      d = shiftDate(d, 1)
    }
  }

  return { backfillPoopByDay, backfillItchByDay }
}

// --- Chart data builder ---

export function buildChartData(
  windowStart: string,
  today: string,
  worstPoopByDay: Map<string, number>,
  backfillPoopByDay: Map<string, number>,
  maxItchByDay: Map<string, number>,
  backfillItchByDay: Map<string, number>,
  dailyPollen: Map<string, number>,
  rawPollenByDay: Map<string, number>,
  rawSporeByDay: Map<string, number>,
): TimelineDataPoint[] {
  const chartData: TimelineDataPoint[] = []
  let current = windowStart
  while (current <= today) {
    const hasPollenData = rawPollenByDay.has(current) || rawSporeByDay.has(current)
    chartData.push({
      date: current,
      poopScore: worstPoopByDay.get(current) ?? backfillPoopByDay.get(current) ?? null,
      itchScore: maxItchByDay.get(current) ?? backfillItchByDay.get(current) ?? 0,
      pollenLevel: dailyPollen.get(current) ?? null,
      rawPollenLevel: hasPollenData ? (rawPollenByDay.get(current) ?? 0) : null,
      rawSporeLevel: hasPollenData ? (rawSporeByDay.get(current) ?? 0) : null,
    })
    current = shiftDate(current, 1)
  }
  return chartData
}
