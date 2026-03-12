"use client"

import { useMemo } from "react"
import {
  ComposedChart,
  Line,
  ReferenceArea,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts"
import { format, parseISO } from "date-fns"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import type { TimelineDataPoint, TimelineIndividualPoint } from "@/lib/timeline-types"

export type { TimelineDataPoint } from "@/lib/timeline-types"

interface TimelineChartProps {
  data?: TimelineDataPoint[]
  individualData?: TimelineIndividualPoint[]
  dailyPollen?: Record<string, number>
  mode: "daily" | "individual"
  className?: string
}

// --- Chart config ---

const chartConfig = {
  poopScore: {
    label: "Stool",
    color: "var(--chart-2)",
  },
  itchScore: {
    label: "Itch",
    color: "var(--chart-4)",
  },
} satisfies ChartConfig

// --- Pollen level → CSS variable mapping ---

const POLLEN_COLORS: Record<number, string> = {
  0: "transparent",
  1: "var(--pollen-low)",
  2: "var(--pollen-moderate)",
  3: "var(--pollen-high)",
  4: "var(--pollen-very-high)",
}

const POLLEN_LABELS: Record<number, string> = {
  0: "None",
  1: "Low",
  2: "Moderate",
  3: "High",
  4: "Very High",
}

// --- Helpers ---

/**
 * Group consecutive days with the same pollen level into ReferenceArea ranges.
 *
 * Recharts renders ReferenceArea between tick centers, so a band from Mar 3 to
 * Mar 7 only covers center(Mar 3)→center(Mar 7), leaving half-day gaps at edges.
 * Fix: extend each band's x2 to the next transition point (or end of data) so
 * bands tile edge-to-edge with no visual gaps.
 */
function buildPollenBands(
  data: TimelineDataPoint[],
): { x1: string; x2: string; level: number }[] {
  const bands: { x1: string; x2: string; level: number }[] = []
  let bandStart = -1
  let bandLevel = 0

  for (let i = 0; i < data.length; i++) {
    const level = data[i].pollenLevel
    if (level && level > 0) {
      if (bandStart >= 0 && level === bandLevel) {
        // Continue current band
      } else {
        // End previous band at this transition point
        if (bandStart >= 0) {
          bands.push({ x1: data[bandStart].date, x2: data[i].date, level: bandLevel })
        }
        bandStart = i
        bandLevel = level
      }
    } else {
      if (bandStart >= 0) {
        // End band: extend to this point (first non-pollen day)
        bands.push({ x1: data[bandStart].date, x2: data[i].date, level: bandLevel })
        bandStart = -1
      }
    }
  }
  // Final band extends to last data point
  if (bandStart >= 0) {
    bands.push({ x1: data[bandStart].date, x2: data[data.length - 1].date, level: bandLevel })
  }
  return bands
}

// --- Custom tooltip ---

function TimelineTooltipContent({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{
    dataKey?: string | number
    value?: number | null
    payload?: TimelineDataPoint | TimelineIndividualPoint
  }>
}): React.ReactElement | null {
  if (!active || !payload?.length) return null

  const point = payload[0]?.payload
  if (!point) return null

  // Individual mode has timestamp + time fields
  const isIndividual = "timestamp" in point
  const indPoint = isIndividual ? (point as TimelineIndividualPoint) : null

  const dateLabel = indPoint?.time
    ? `${format(parseISO(point.date), "EEE, MMM d")} at ${indPoint.time}`
    : format(parseISO(point.date), "EEE, MMM d, yyyy")

  return (
    <div className="border-border-light bg-background rounded-lg border px-3 py-2 text-xs shadow-xl">
      <div className="mb-1.5 font-medium text-foreground">{dateLabel}</div>
      <div className="grid gap-1">
        {point.poopScore !== null && (
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: "var(--chart-2)" }} />
            <span className="text-muted-foreground">Stool</span>
            <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
              {point.poopScore}
            </span>
          </div>
        )}
        {/* Show itch: only when non-null in individual mode, only when > 0 in daily mode */}
        {(isIndividual ? indPoint?.itchScore !== null : (point as TimelineDataPoint).itchScore > 0) && (
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: "var(--chart-4)" }} />
            <span className="text-muted-foreground">Itch</span>
            <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
              {isIndividual ? indPoint?.itchScore : (point as TimelineDataPoint).itchScore}
            </span>
          </div>
        )}
        {point.rawPollenLevel !== null && (
          <div className="flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ backgroundColor: POLLEN_COLORS[point.rawPollenLevel] ?? "var(--muted)" }}
            />
            <span className="text-muted-foreground">Pollen <span className="text-foreground-muted-50">({POLLEN_LABELS[point.rawPollenLevel] ?? "None"})</span></span>
            <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
              {point.rawPollenLevel}
            </span>
          </div>
        )}
        {point.rawSporeLevel !== null && (
          <div className="flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ backgroundColor: POLLEN_COLORS[point.rawSporeLevel] ?? "var(--muted)" }}
            />
            <span className="text-muted-foreground">Spore <span className="text-foreground-muted-50">({POLLEN_LABELS[point.rawSporeLevel] ?? "None"})</span></span>
            <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
              {point.rawSporeLevel}
            </span>
          </div>
        )}
        {point.poopScore === null && point.rawPollenLevel === null && (
          <span className="text-muted-foreground">No logs</span>
        )}
      </div>
    </div>
  )
}

// --- Pollen bands for individual mode (timestamp-based x-axis) ---

/** Build pollen bands from daily pollen map, clamped to visible domain. */
function buildPollenBandsTimestamp(
  dailyPollen: Record<string, number>,
  domain: [number, number],
): { x1: number; x2: number; level: number }[] {
  const sortedDates = Object.entries(dailyPollen)
    .filter(([, level]) => level > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))

  if (sortedDates.length === 0) return []

  const bands: { x1: number; x2: number; level: number }[] = []
  let bandStart: string | null = null
  let prevDate: string | null = null
  let bandLevel = 0

  for (const [date, level] of sortedDates) {
    // Break band on level change OR non-consecutive dates (gap from filtered-out 0-level days)
    const isConsecutive = prevDate !== null &&
      (new Date(date + "T00:00:00Z").getTime() - new Date(prevDate + "T00:00:00Z").getTime()) <= 86_400_000 * 1.5

    if (bandStart !== null && level === bandLevel && isConsecutive) {
      // Continue band
    } else {
      if (bandStart !== null) {
        bands.push({
          x1: new Date(bandStart + "T00:00:00Z").getTime(),
          x2: new Date(prevDate! + "T23:59:59Z").getTime(),
          level: bandLevel,
        })
      }
      bandStart = date
      bandLevel = level
    }
    prevDate = date
  }
  if (bandStart !== null) {
    const lastDate = sortedDates[sortedDates.length - 1][0]
    bands.push({
      x1: new Date(bandStart + "T00:00:00Z").getTime(),
      x2: new Date(lastDate + "T23:59:59Z").getTime(),
      level: bandLevel,
    })
  }

  // Clamp band edges to visible domain so they don't extend into empty space
  return bands
    .map((b) => ({ ...b, x1: Math.max(b.x1, domain[0]), x2: Math.min(b.x2, domain[1]) }))
    .filter((b) => b.x1 < b.x2)
}

// --- Main component ---

export function TimelineChart({ data, individualData, dailyPollen, mode, className }: TimelineChartProps): React.ReactElement {
  const isIndividual = mode === "individual"
  const chartData: (TimelineDataPoint | TimelineIndividualPoint)[] = isIndividual ? (individualData ?? []) : (data ?? [])

  // Key that changes per dataset so Line components remount with fresh draw-in animation
  const firstDate = chartData.length > 0 ? chartData[0].date : ""
  const animKey = `${mode}-${firstDate}-${chartData.length}`

  const pollenBands = useMemo(() => {
    if (isIndividual) return null
    return buildPollenBands(data ?? [])
  }, [isIndividual, data])

  // Domain from first to last data point so there's no empty space at edges
  const timestampAxis = useMemo(() => {
    if (!isIndividual || !individualData?.length) return { domain: undefined as [number, number] | undefined, ticks: undefined as number[] | undefined }

    const timestamps = individualData.map((d) => d.timestamp)
    const domain: [number, number] = [
      timestamps.reduce((a, b) => Math.min(a, b), Infinity),
      timestamps.reduce((a, b) => Math.max(a, b), -Infinity),
    ]

    // One tick per day at noon
    const dates = [...new Set(individualData.map((d) => d.date))].sort()
    const ticks: number[] = []
    const d = new Date(dates[0] + "T12:00:00Z")
    const end = new Date(dates[dates.length - 1] + "T12:00:00Z")
    while (d <= end) {
      ticks.push(d.getTime())
      d.setDate(d.getDate() + 1)
    }

    return { domain, ticks }
  }, [isIndividual, individualData])

  const pollenBandsTimestamp = useMemo(() => {
    if (!isIndividual || !dailyPollen || !timestampAxis.domain) return null
    return buildPollenBandsTimestamp(dailyPollen, timestampAxis.domain)
  }, [isIndividual, dailyPollen, timestampAxis.domain])

  // Check if there's any itch data worth showing
  const hasItchData = useMemo(() => {
    if (isIndividual) return (individualData ?? []).some((d) => d.itchScore !== null && d.itchScore > 0)
    return (data ?? []).some((d) => d.itchScore > 0)
  }, [isIndividual, data, individualData])

  return (
    <ChartContainer config={chartConfig} className={className}>
      <ComposedChart
        data={chartData}
        margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border-grid" />

        {/* Pollen background bands — daily mode */}
        {pollenBands?.map((band) => (
          <ReferenceArea
            key={`${band.x1}-${band.level}`}
            x1={band.x1}
            x2={band.x2}
            y1={0}
            y2={7}
            fill={POLLEN_COLORS[band.level] ?? "transparent"}
            fillOpacity={1}
            strokeOpacity={0}
          />
        ))}

        {/* Pollen background bands — individual mode */}
        {pollenBandsTimestamp?.map((band) => (
          <ReferenceArea
            key={`ts-${band.x1}-${band.level}`}
            x1={band.x1}
            x2={band.x2}
            y1={0}
            y2={7}
            fill={POLLEN_COLORS[band.level] ?? "transparent"}
            fillOpacity={1}
            strokeOpacity={0}
          />
        ))}

        {isIndividual ? (
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={timestampAxis.domain}
            ticks={timestampAxis.ticks}
            axisLine={false}
            tickLine={false}
            tickMargin={8}
            tickFormatter={(value: number) => format(new Date(value), "EEE")}
            className="text-[10px]"
          />
        ) : (
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tickMargin={8}
            minTickGap={Math.max(24, Math.floor((data ?? []).length * 0.8))}
            tickFormatter={(value: string) => format(parseISO(value), "MMM d")}
            className="text-[10px]"
          />
        )}

        <YAxis
          domain={[0, 7]}
          ticks={[0, 1, 2, 3, 4, 5, 6, 7]}
          axisLine={false}
          tickLine={false}
          tickMargin={4}
          width={32}
          className="text-[10px]"
        />

        <ChartTooltip
          content={<TimelineTooltipContent />}
          cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
          isAnimationActive={false}
        />

        {/* Poop score line */}
        <Line
          key={`poop-${animKey}`}
          type="monotone"
          dataKey="poopScore"
          stroke="var(--chart-2)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0, fill: "var(--chart-2)" }}
          connectNulls={isIndividual}
        />

        {/* Itch score line */}
        {hasItchData && (
          <Line
            key={`itch-${animKey}`}
            type="monotone"
            dataKey="itchScore"
            stroke="var(--chart-4)"
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: "var(--chart-4)" }}
            connectNulls={true}
          />
        )}
      </ComposedChart>
    </ChartContainer>
  )
}
