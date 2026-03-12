"use client"

import { TimelineChart } from "@/components/timeline-chart"
import { TimelineGantt } from "@/components/timeline-gantt"
import { cn } from "@/lib/utils"
import { RANGE_OPTIONS } from "@/lib/timeline-types"
import type { TimelineRange, TimelineData } from "@/lib/timeline-types"

export type { TimelineRange, TimelineData } from "@/lib/timeline-types"

// --- Props ---

interface InsightsTimelineProps {
  data: TimelineData | null
  loading?: boolean
  error?: boolean
  range: TimelineRange
  onRangeChange: (range: TimelineRange) => void
  onRetry?: () => void
}

// --- Range toggle ---

function RangeToggle({
  range,
  onRangeChange,
  disabled,
}: {
  range: TimelineRange
  onRangeChange: (range: TimelineRange) => void
  disabled?: boolean
}): React.ReactElement {
  return (
    <div className="flex rounded-lg border border-border overflow-hidden shrink-0 mr-2" role="group" aria-label="Time range">
      {RANGE_OPTIONS.map(({ value, label }) =>
        disabled ? (
          <div key={value} className="px-2.5 py-1 text-[11px] font-medium text-foreground-muted-40">
            {label}
          </div>
        ) : (
          <button
            key={value}
            type="button"
            onClick={() => onRangeChange(value)}
            aria-pressed={range === value}
            className={cn(
              "px-2.5 py-1 text-[11px] font-medium transition-colors",
              range === value
                ? "bg-primary text-primary-foreground"
                : "hover:bg-item-hover text-muted-foreground",
            )}
          >
            {label}
          </button>
        ),
      )}
    </div>
  )
}

// --- Loading skeleton ---

function TimelineSkeleton(): React.ReactElement {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-[200px] rounded-lg bg-muted" />
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="w-11 h-4 rounded bg-muted" />
          <div className="flex-1 h-6 rounded bg-muted" />
        </div>
        <div className="flex items-center gap-2">
          <div className="w-11 h-4 rounded bg-muted" />
          <div className="flex-1 h-6 rounded bg-muted" />
        </div>
        <div className="flex items-center gap-2">
          <div className="w-11 h-4 rounded bg-muted" />
          <div className="flex-1 h-6 rounded bg-muted" />
        </div>
      </div>
    </div>
  )
}

// --- Empty state ---

function TimelineEmpty(): React.ReactElement {
  return (
    <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
      No log data yet. Start logging to see your timeline.
    </div>
  )
}

// --- Error state ---

function TimelineError({ onRetry }: { onRetry?: () => void }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2">
      <p className="text-sm text-muted-foreground">Couldn&apos;t load timeline data.</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-sm text-primary hover:underline"
        >
          Try again
        </button>
      )}
    </div>
  )
}

// --- Legend ---

function TimelineLegend({ individual }: { individual?: boolean }): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <div className="h-[3px] w-4 rounded-full" style={{ backgroundColor: "var(--chart-2)" }} />
        <span>{individual ? "Stool" : "Worst stool"}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-[3px] w-4 rounded-full" style={{ backgroundColor: "var(--chart-4)", backgroundImage: "repeating-linear-gradient(90deg, transparent, transparent 3px, var(--background) 3px, var(--background) 5px)" }} />
        <span>{individual ? "Itch" : "Worst itch"}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-2.5 w-4 rounded-[2px] border border-border-light" style={{ backgroundColor: "var(--pollen-moderate)" }} />
        <span>Pollen level</span>
      </div>
    </div>
  )
}

// --- Main component ---

export function InsightsTimeline({ data, loading, error, range, onRangeChange, onRetry }: InsightsTimelineProps): React.ReactElement {
  if (loading) {
    return (
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-foreground">Timeline</h2>
          <RangeToggle range={range} onRangeChange={onRangeChange} disabled />
        </div>
        <TimelineSkeleton />
      </section>
    )
  }

  if (error) {
    return (
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-foreground">Timeline</h2>
          <RangeToggle range={range} onRangeChange={onRangeChange} />
        </div>
        <TimelineError onRetry={onRetry} />
      </section>
    )
  }

  const hasData = data && (data.mode === "individual" ? data.individualData.length > 0 : data.chartData.length > 0)

  if (!hasData) {
    return (
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-foreground">Timeline</h2>
          <RangeToggle range={range} onRangeChange={onRangeChange} />
        </div>
        <TimelineEmpty />
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-foreground">Timeline</h2>
        <RangeToggle range={range} onRangeChange={onRangeChange} />
      </div>
      <TimelineLegend individual={data.mode === "individual"} />

      {/* Shared scroll container for mobile */}
      <div className={cn("overflow-x-auto scrollbar-none -mx-4 px-4 md:mx-0 md:px-0")}>
        <div className="min-w-[500px] space-y-2">
          <TimelineChart
            data={data.mode === "daily" ? data.chartData : undefined}
            individualData={data.mode === "individual" ? data.individualData : undefined}
            dailyPollen={data.mode === "individual" ? data.dailyPollen : undefined}
            mode={data.mode}
            className="aspect-auto h-[200px] w-full"
          />
          <TimelineGantt
            bars={data.ganttBars}
            startDate={data.startDate}
            endDate={data.endDate}
          />
        </div>
      </div>
    </section>
  )
}
