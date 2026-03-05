"use client"

import { useState, useCallback, useRef } from "react"
import { cn } from "@/lib/utils"
import { SCORES } from "@/components/fecal-score-guide"

interface FecalScorePickerProps {
  value: number | null
  onChange: (score: number | null) => void
}

// ── Option A: Compact vertical list ──────────────────────────────────

export function FecalScorePickerVertical({
  value,
  onChange,
}: FecalScorePickerProps): React.ReactElement {
  const hasSelection = value !== null

  return (
    <div className="flex flex-col gap-1" role="radiogroup">
      {SCORES.map((s) => {
        const isSelected = value === s.score
        return (
          <button
            key={s.score}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`Score ${s.score}: ${s.label}`}
            onClick={() => onChange(isSelected ? null : s.score)}
            className={cn(
              "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-all",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none",
              isSelected
                ? "bg-item-active"
                : "border-border bg-background hover:bg-item-hover",
              hasSelection && !isSelected && "opacity-70",
            )}
            style={
              isSelected ? { borderColor: s.color } : undefined
            }
          >
            <div className={cn("flex h-10 w-14 shrink-0 items-center justify-center rounded-md p-1", !isSelected && "bg-muted-subtle")}>
              <img
                src={`/images/fecal-scores/score${s.score}.png`}
                alt={`Score ${s.score}`}
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ backgroundColor: s.color }}
                >
                  {s.score}
                </span>
                <span className="text-sm font-semibold">
                  {s.label}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {s.description}
              </p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── Option B: Horizontal scroll cards ────────────────────────────────

export function FecalScorePickerHorizontal({
  value,
  onChange,
}: FecalScorePickerProps): React.ReactElement {
  const hasSelection = value !== null
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const updateScrollState = useCallback((el: HTMLDivElement) => {
    setCanScrollLeft(el.scrollLeft > 2)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  const scrollRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el
    if (!el) return
    updateScrollState(el)
    const ro = new ResizeObserver(() => updateScrollState(el))
    ro.observe(el)
    return () => ro.disconnect()
  }, [updateScrollState])

  function handleSelect(score: number): void {
    onChange(value === score ? null : score)
    // Scroll to center the selected card
    const container = containerRef.current
    if (!container || value === score) return
    const idx = SCORES.findIndex((s) => s.score === score)
    const card = container.children[idx] as HTMLElement | undefined
    if (card) {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2
      const scrollTarget = cardCenter - container.clientWidth / 2
      container.scrollTo({ left: scrollTarget, behavior: "smooth" })
    }
  }

  return (
    <div className="relative">
      {/* Fade indicators — only visible when more content in that direction */}
      <div className={cn(
        "pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent transition-opacity duration-200",
        canScrollLeft ? "opacity-100" : "opacity-0",
      )} />
      <div className={cn(
        "pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent transition-opacity duration-200",
        canScrollRight ? "opacity-100" : "opacity-0",
      )} />

      <div
        ref={scrollRef}
        onScroll={(e) => updateScrollState(e.currentTarget)}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2 scrollbar-none"
        role="radiogroup"
        data-vaul-no-drag
        style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-x", overscrollBehaviorX: "contain" }}
      >
        {SCORES.map((s) => {
          const isSelected = value === s.score
          return (
            <button
              key={s.score}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`Score ${s.score}: ${s.label}`}
              onClick={() => handleSelect(s.score)}
              className={cn(
                "flex w-[144px] shrink-0 snap-start flex-col items-start gap-1.5 rounded-lg border p-2 transition-all",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none",
                isSelected
                  ? "bg-item-active"
                  : "border-border bg-background hover:bg-item-hover",
                hasSelection && !isSelected && "opacity-70",
              )}
              style={
                isSelected ? { borderColor: s.color } : undefined
              }
            >
              <div className={cn("flex aspect-[3/2] w-full items-center justify-center overflow-hidden rounded-md p-2", !isSelected && "bg-muted-subtle")}>
                <img
                  src={`/images/fecal-scores/score${s.score}.png`}
                  alt={`Score ${s.score}`}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="flex w-full items-center gap-1.5">
                <span
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ backgroundColor: s.color }}
                >
                  {s.score}
                </span>
                <span className="text-[11px] font-semibold leading-tight">
                  {s.label}
                </span>
              </div>
              <p className="w-full text-left text-[10px] leading-snug text-muted-foreground">
                {s.description}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
