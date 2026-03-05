"use client"

import { cn } from "@/lib/utils"

interface ScorePickerProps {
  min: number
  max: number
  labels: string[]
  colors: string[]
  value: number | null
  onChange: (value: number) => void
}

export function ScorePicker({
  min,
  max,
  labels,
  colors,
  value,
  onChange,
}: ScorePickerProps) {
  const count = max - min + 1

  return (
    <div className="flex w-full gap-1.5" role="radiogroup">
      {Array.from({ length: count }, (_, i) => {
        const score = min + i
        const isSelected = value === score
        const color = colors[i] ?? "var(--color-muted-foreground)"
        const label = labels[i] ?? String(score)

        return (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`${score} — ${label}`}
            onClick={() => onChange(score)}
            className={cn(
              "relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-2 text-center transition-all",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none",
              isSelected
                ? "border-transparent shadow-sm"
                : "border-border bg-background hover:bg-item-hover hover:border-border-hover",
            )}
            style={
              isSelected
                ? {
                    backgroundColor: color,
                    color: shouldUseDarkText(color) ? "#1A1A1A" : "#FFFFFF",
                  }
                : undefined
            }
          >
            <span className="text-base font-semibold leading-none tabular-nums">
              {score}
            </span>
            <span
              className={cn(
                "text-[10px] font-medium leading-tight",
                isSelected ? "opacity-90" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Determines if dark text should be used on a given background color
 * for accessibility. Uses relative luminance approximation.
 */
function shouldUseDarkText(color: string): boolean {
  // Parse hex
  const hex = color.replace("#", "")
  if (hex.length !== 6) return false
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 0.6
}
