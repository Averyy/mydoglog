"use client"

import { useState, useCallback, useRef } from "react"
import { WhenInput } from "@/components/when-input"
import { CollapsibleNotes } from "@/components/collapsible-notes"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { format } from "date-fns"
import { cn } from "@/lib/utils"

// Based on Pruritus Visual Analog Scale (PVAS) — veterinary standard
// Simplified from 0-10 to 1-5 for quick logging
// Key differentiator: whether itching stops during activities (eating/playing/sleeping)
export const ITCH_SCORES = [
  { score: 0, label: "None", description: "Normal grooming only, no signs of itchiness", color: "#8A7A69" },
  { score: 1, label: "Very mild", description: "Occasional episodes, slightly more than normal", color: "#6B8C6F" },
  { score: 2, label: "Mild", description: "Slightly increased, stops when distracted", color: "#8FB896" },
  { score: 3, label: "Moderate", description: "Regular episodes, stops when eating or playing", color: "#D4A944" },
  { score: 4, label: "Severe", description: "Prolonged, itches even when eating, playing, or sleeping", color: "#C97C5D" },
  { score: 5, label: "Extreme", description: "Nearly continuous, must be physically restrained", color: "#B84A3A" },
] as const

// Body areas from CADESI-4 + Merck Vet Manual atopic dermatitis assessment sites
export const BODY_AREAS = [
  { value: "ears", label: "Ears" },
  { value: "paws", label: "Paws" },
  { value: "face", label: "Face" },
  { value: "belly", label: "Belly" },
  { value: "armpits", label: "Armpits" },
  { value: "groin", label: "Groin" },
  { value: "back", label: "Back / Rump" },
  { value: "legs", label: "Legs" },
  { value: "nails", label: "Nails" },
  { value: "perianal", label: "Perianal" },
  { value: "general", label: "General" },
] as const

// ── Horizontal scroll itch picker (mirrors FecalScorePickerHorizontal) ──

export function ItchScorePicker({
  value,
  onChange,
  showNone = false,
}: {
  value: number | null
  onChange: (score: number | null) => void
  showNone?: boolean
}): React.ReactElement {
  const scores = showNone ? ITCH_SCORES : ITCH_SCORES.filter((s) => s.score !== 0)
  const hasSelection = value !== null
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  const updateScrollState = useCallback((el: HTMLDivElement) => {
    setCanScrollLeft(el.scrollLeft > 2)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  const scrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el
      if (!el) return
      // Auto-scroll to pre-selected value on mount
      if (valueRef.current !== null) {
        const idx = scores.findIndex((s) => s.score === valueRef.current)
        const card = el.children[idx] as HTMLElement | undefined
        if (card) {
          const cardCenter = card.offsetLeft + card.offsetWidth / 2
          const scrollTarget = cardCenter - el.clientWidth / 2
          el.scrollTo({ left: scrollTarget, behavior: "instant" })
        }
      }
      updateScrollState(el)
      const ro = new ResizeObserver(() => updateScrollState(el))
      ro.observe(el)
      return () => ro.disconnect()
    },
    [updateScrollState, scores],
  )

  function handleSelect(score: number): void {
    onChange(value === score ? null : score)
    const container = containerRef.current
    if (!container || value === score) return
    const idx = scores.findIndex((s) => s.score === score)
    const card = container.children[idx] as HTMLElement | undefined
    if (card) {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2
      const scrollTarget = cardCenter - container.clientWidth / 2
      container.scrollTo({ left: scrollTarget, behavior: "smooth" })
    }
  }

  return (
    <div className="relative">
      <div
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent transition-opacity duration-200",
          canScrollLeft ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent transition-opacity duration-200",
          canScrollRight ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={scrollRef}
        onScroll={(e) => updateScrollState(e.currentTarget)}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2 scrollbar-none"
        role="radiogroup"
        data-vaul-no-drag
        style={{
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-x",
          overscrollBehaviorX: "contain",
        }}
      >
        {scores.map((s) => {
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
                "flex w-[120px] shrink-0 snap-start flex-col items-start gap-1.5 rounded-lg border p-2 transition-all",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none",
                isSelected
                  ? "bg-item-active"
                  : "border-border bg-background hover:bg-item-hover",
                hasSelection && !isSelected && "opacity-70",
              )}
              style={isSelected ? { borderColor: s.color } : undefined}
            >
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

// ── Multi-select itch picker (mirrors FecalScorePickerMulti) ──────────

export function ItchScorePickerMulti({
  value,
  onChange,
}: {
  value: number[] | null
  onChange: (scores: number[] | null) => void
}): React.ReactElement {
  const hasSelection = value != null && value.length > 0
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const updateScrollState = useCallback((el: HTMLDivElement) => {
    setCanScrollLeft(el.scrollLeft > 2)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  const scrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el
      if (!el) return
      updateScrollState(el)
      const ro = new ResizeObserver(() => updateScrollState(el))
      ro.observe(el)
      return () => ro.disconnect()
    },
    [updateScrollState],
  )

  function handleToggle(score: number): void {
    const current = value ?? []
    const idx = current.indexOf(score)
    let next: number[]
    if (idx >= 0) {
      next = current.filter((s) => s !== score)
    } else {
      next = [...current, score].sort((a, b) => a - b)
    }
    onChange(next.length > 0 ? next : null)
  }

  return (
    <div className="relative">
      <div
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent transition-opacity duration-200",
          canScrollLeft ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent transition-opacity duration-200",
          canScrollRight ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={scrollRef}
        onScroll={(e) => updateScrollState(e.currentTarget)}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2 scrollbar-none"
        role="group"
        aria-label="Itch severity scores"
        data-vaul-no-drag
        style={{
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-x",
          overscrollBehaviorX: "contain",
        }}
      >
        {ITCH_SCORES.map((s) => {
          const isSelected = value?.includes(s.score) ?? false
          return (
            <button
              key={s.score}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              aria-label={`Score ${s.score}: ${s.label}`}
              onClick={() => handleToggle(s.score)}
              className={cn(
                "flex w-[120px] shrink-0 snap-start flex-col items-start gap-1.5 rounded-lg border p-2 transition-all",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none",
                isSelected
                  ? "bg-item-active"
                  : "border-border bg-background hover:bg-item-hover",
                hasSelection && !isSelected && "opacity-70",
              )}
              style={isSelected ? { borderColor: s.color } : undefined}
            >
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

interface ItchinessLoggerProps {
  dogId: string
  onSaved: () => void
}

export function ItchinessLogger({ dogId, onSaved }: ItchinessLoggerProps) {
  const [score, setScore] = useState<number | null>(null)
  const [bodyAreas, setBodyAreas] = useState<string[]>([])
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [time, setTime] = useState<string | null>(format(new Date(), "HH:mm"))
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  function toggleBodyArea(area: string): void {
    setBodyAreas((prev) =>
      prev.includes(area)
        ? prev.filter((a) => a !== area)
        : [...prev, area],
    )
  }

  async function handleSave(): Promise<void> {
    if (score === null) {
      toast.error("Select an itchiness level")
      return
    }

    setSaving(true)
    try {
      const datetime =
        date && time ? new Date(`${date}T${time}`).toISOString() : undefined

      const body = {
        score,
        bodyAreas: bodyAreas.length > 0 ? bodyAreas : undefined,
        date,
        datetime,
        notes: notes.trim() || undefined,
      }

      const res = await fetch(`/api/dogs/${dogId}/itchiness`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "Failed to save")
        return
      }

      toast.success("Itchiness logged")
      onSaved()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Score — horizontal scroll picker */}
      <ItchScorePicker value={score} onChange={setScore} />

      {/* Body areas */}
      <div className="space-y-2">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Affected areas
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {BODY_AREAS.map((area) => (
            <button
              key={area.value}
              type="button"
              onClick={() => toggleBodyArea(area.value)}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none",
                bodyAreas.includes(area.value)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-secondary",
              )}
            >
              {area.label}
            </button>
          ))}
        </div>
      </div>

      {/* Date/time */}
      <WhenInput date={date} onDateChange={setDate} time={time} onTimeChange={setTime} />

      {/* Notes */}
      <CollapsibleNotes value={notes} onChange={setNotes} label="Add itchiness note" placeholder="Optional observations..." />

      {/* Save */}
      <Button
        onClick={handleSave}
        disabled={saving || score === null}
        className="mt-2 w-full"
      >
        {saving ? "Saving..." : "Save"}
      </Button>
    </div>
  )
}
