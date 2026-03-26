"use client"

import { useMemo, useState, useRef, useCallback, useEffect } from "react"
import { createPortal } from "react-dom"
import { format, parseISO } from "date-fns"
import { cn, smallImageUrl } from "@/lib/utils"
import { getDosageFormIcon } from "@/lib/medication-utils"
import { daysBetween } from "@/lib/date-utils"
import type { GanttBarData as GanttBar } from "@/lib/timeline-types"

export type { GanttBarData as GanttBar } from "@/lib/timeline-types"

interface TimelineGanttProps {
  bars: GanttBar[]
  startDate: string // YYYY-MM-DD — left edge of the timeline
  endDate: string // YYYY-MM-DD — right edge of the timeline
  className?: string
}

// --- Helpers ---

function clampDate(date: string, min: string, max: string): string {
  if (date < min) return min
  if (date > max) return max
  return date
}

function formatDateRange(start: string, end: string): string {
  return `${format(parseISO(start), "MMM d")} - ${format(parseISO(end), "MMM d, yyyy")}`
}

function formatQuantity(quantity: string, unit: string): string {
  if (unit === "g") return `${quantity}g/day`
  return `${quantity} ${unit}/day`
}

// --- Category config ---

const CATEGORY_ORDER: Record<string, number> = {
  food: 0,
  transition: 0, // same row as food
  supplement: 1,
  medication: 2,
}

const CATEGORY_LABELS: Record<string, string> = {
  food: "Food",
  transition: "Transition",
  medication: "Medication",
  supplement: "Supplement",
}

// Colors per category
const CATEGORY_COLORS: Record<string, string> = {
  food: "var(--gantt-food-a)",
  transition: "var(--gantt-transition)",
  medication: "var(--medication)",
  supplement: "var(--gantt-supplement-a)",
}

// --- Tooltip ---

interface TooltipState {
  bar: GanttBar
  x: number
  y: number
}

function GanttTooltip({ bar, x, y }: TooltipState): React.ReactElement {
  const days = daysBetween(bar.startDate, bar.endDate) + 1
  const meta = bar.meta

  const imgSrc = meta?.imageUrl ? smallImageUrl(meta.imageUrl) : null
  const MedIcon = bar.category === "medication" ? getDosageFormIcon(meta?.dosageForm) : null

  // Build category + quantity line, e.g. "Food, 1.5 can/day"
  const categoryLine = (() => {
    const label = CATEGORY_LABELS[bar.category] ?? bar.category
    if (bar.category === "transition" && bar.transitionMeta) {
      return `${bar.transitionMeta.oldFoodName} → ${bar.transitionMeta.newFoodName}`
    }
    if (meta?.quantity && meta?.quantityUnit) {
      return `${label}, ${formatQuantity(meta.quantity, meta.quantityUnit)}`
    }
    return label
  })()

  return createPortal(
    <div
      className="pointer-events-none fixed z-50 border-border-light bg-background rounded-lg border px-3 py-2 text-xs shadow-xl max-w-[320px]"
      style={{ left: x, top: y, transform: "translate(-50%, -100%) translateY(-8px)" }}
    >
      <div className="flex items-start gap-3">
        {/* Left: text info */}
        <div className="min-w-0 flex-1">
          {/* Brand above product name (food/supplement) */}
          {meta?.brandName && (bar.category === "food" || bar.category === "supplement") && (
            <div className="text-[10px] text-foreground-muted-60">{meta.brandName}</div>
          )}
          <div className="mb-1.5 font-medium text-foreground leading-tight">
            {bar.category === "medication" && meta?.dosage
              ? bar.label.replace(` ${meta.dosage}`, "")
              : bar.label}
          </div>

          <div className="grid gap-0.5 text-muted-foreground">
            {/* Category + quantity */}
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-[2px] opacity-50" style={{ backgroundColor: CATEGORY_COLORS[bar.category] }} />
              <span>{categoryLine}</span>
            </div>

            {/* Dosage + Interval (medication) */}
            {bar.category === "medication" && meta?.dosage && (
              <div>
                {meta.dosage}
                {meta.interval && <span> · {meta.interval}</span>}
              </div>
            )}

            {/* Date range + duration */}
            <div className="mt-1 flex items-center gap-2 border-t border-border-light pt-1">
              <span>{formatDateRange(bar.startDate, bar.endDate)}</span>
              <span className="font-mono tabular-nums text-foreground">{days}d</span>
            </div>
          </div>
        </div>

        {/* Right: product image or medication icon */}
        {imgSrc ? (
          <div className="flex shrink-0 items-center justify-center size-14 rounded-md bg-score-strip">
            <img
              src={imgSrc}
              alt=""
              className="size-full rounded-md object-contain mix-blend-multiply dark:mix-blend-normal"
            />
          </div>
        ) : MedIcon ? (
          <div className="flex shrink-0 items-center justify-center size-9 rounded-md bg-secondary">
            <MedIcon className="size-5 text-muted-foreground" />
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

// --- Main component ---

export function TimelineGantt({
  bars,
  startDate,
  endDate,
  className,
}: TimelineGanttProps): React.ReactElement {
  const totalDays = daysBetween(startDate, endDate) + 1
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const showTooltip = useCallback((bar: GanttBar, x: number, y: number) => {
    setTooltip({ bar, x, y })
  }, [])

  const handleBarHover = useCallback((bar: GanttBar, e: React.MouseEvent) => {
    showTooltip(bar, e.clientX, e.currentTarget.getBoundingClientRect().top)
  }, [showTooltip])

  const handleBarTouch = useCallback((bar: GanttBar, e: React.TouchEvent) => {
    e.preventDefault()
    const touch = e.touches[0]
    showTooltip(bar, touch.clientX, e.currentTarget.getBoundingClientRect().top)
  }, [showTooltip])

  const handleBarLeave = useCallback(() => {
    setTooltip(null)
  }, [])

  // Dismiss tooltip on touch outside (mobile)
  useEffect(() => {
    if (!tooltip) return
    const dismiss = () => setTooltip(null)
    document.addEventListener("touchstart", dismiss)
    return () => document.removeEventListener("touchstart", dismiss)
  }, [tooltip])

  // Group bars by category, maintaining order
  const groupedBars = useMemo(() => {
    const grouped = new Map<string, GanttBar[]>()

    const sorted = [...bars].sort((a, b) => {
      const catDiff = (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99)
      if (catDiff !== 0) return catDiff
      return a.startDate.localeCompare(b.startDate)
    })

    for (const bar of sorted) {
      // Transition bars render in the food row
      const groupKey = bar.category === "transition" ? "food" : bar.category
      const existing = grouped.get(groupKey) ?? []
      existing.push(bar)
      grouped.set(groupKey, existing)
    }

    return grouped
  }, [bars])

  if (totalDays <= 0 || bars.length === 0) return <></>

  return (
    <div ref={containerRef} className={cn("ml-4 mr-2 space-y-1", className)}>
      {Array.from(groupedBars.entries()).map(([category, categoryBars]) => {
        // Detect bars whose visual end overlaps with a later bar's start (same-day boundary).
        // Trim the earlier bar by 1 day so both bars are visible with a gap.
        const trimEnd = new Set<number>()
        for (let i = 0; i < categoryBars.length; i++) {
          const iEnd = clampDate(categoryBars[i].endDate, startDate, endDate)
          const iStart = clampDate(categoryBars[i].startDate, startDate, endDate)
          for (let j = i + 1; j < categoryBars.length; j++) {
            const jStart = clampDate(categoryBars[j].startDate, startDate, endDate)
            if (jStart === iEnd && iStart < jStart) { trimEnd.add(i); break }
            if (jStart > iEnd) break
          }
        }

        return (
        <div key={category} className="relative h-[18px] rounded-sm overflow-hidden">
          {categoryBars.map((bar, idx) => {
            const barStart = clampDate(bar.startDate, startDate, endDate)
            const barEnd = clampDate(bar.endDate, startDate, endDate)
            const leftPct = (daysBetween(startDate, barStart) / totalDays) * 100
            // +1 because endDate is inclusive (a bar on Mar 9–Mar 9 spans 1 full day)
            const dayCount = daysBetween(barStart, barEnd) + 1 - (trimEnd.has(idx) ? 1 : 0)
            const widthPct = Math.max((dayCount / totalDays) * 100, 1)
            const color = CATEGORY_COLORS[category] ?? "var(--muted)"

            return (
              <div
                key={bar.id + "-" + idx}
                className="absolute top-0 h-full flex items-center rounded-[3px] overflow-hidden cursor-default"
                style={{
                  left: `${leftPct}%`,
                  width: `calc(${widthPct}% - 4px)`,
                }}
                onMouseEnter={(e) => handleBarHover(bar, e)}
                onMouseMove={(e) => handleBarHover(bar, e)}
                onMouseLeave={handleBarLeave}
                onTouchStart={(e) => handleBarTouch(bar, e)}
              >
                {/* Background — striped for transitions, solid for others */}
                {bar.category === "transition" ? (
                  <div
                    className="absolute inset-0 opacity-60"
                    style={{
                      background: `repeating-linear-gradient(
                        -45deg,
                        ${color},
                        ${color} 3px,
                        transparent 3px,
                        transparent 6px
                      )`,
                    }}
                  />
                ) : (
                  <div className="absolute inset-0 opacity-50" style={{ backgroundColor: color }} />
                )}
                {/* Text at full opacity, vertically centered */}
                <span className={cn(
                  "relative truncate px-1.5 text-[10px] font-medium text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]",
                  bar.category === "transition" && "bg-black/25 rounded-sm",
                )}>
                  {bar.label}
                </span>
              </div>
            )
          })}
        </div>
        )
      })}

      {mounted && tooltip && <GanttTooltip {...tooltip} />}
    </div>
  )
}
