"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface TimeInputProps {
  value: string | null
  onChange: (time: string | null) => void
  className?: string
}

function generateTimeOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = String(h).padStart(2, "0")
      const mm = String(m).padStart(2, "0")
      const value = `${hh}:${mm}`

      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
      const period = h < 12 ? "AM" : "PM"
      const label = `${hour12}:${mm} ${period}`

      options.push({ value, label })
    }
  }
  return options
}

const TIME_OPTIONS = generateTimeOptions()

function snapToNearest30(time: string): string {
  const [h, m] = time.split(":").map(Number)
  const snapped = Math.round(m / 30) * 30
  const finalH = snapped === 60 ? (h + 1) % 24 : h
  const finalM = snapped === 60 ? 0 : snapped
  return `${String(finalH).padStart(2, "0")}:${String(finalM).padStart(2, "0")}`
}

export function TimeInput({
  value,
  onChange,
  className,
}: TimeInputProps): React.ReactElement {
  const displayValue = value ? snapToNearest30(value) : "none"

  return (
    <Select
      value={displayValue}
      onValueChange={(v) => onChange(v === "none" ? null : (v || null))}
    >
      <SelectTrigger className={cn("bg-background", className)}>
        <SelectValue placeholder="Time" />
      </SelectTrigger>
      <SelectContent className="max-h-60">
        <SelectItem value="none" className="text-muted-foreground">No time</SelectItem>
        {TIME_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
