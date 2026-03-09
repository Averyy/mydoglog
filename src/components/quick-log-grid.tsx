"use client"

import { useState, useEffect, useCallback } from "react"
import {
  LiaCalendarCheckSolid,
  LiaCalendarTimesSolid,
  LiaCookieBiteSolid,
  LiaPoopSolid,
  LiaPawSolid,
} from "react-icons/lia"
import type { LogMode } from "@/components/active-dog-provider"

interface TodayCounts {
  poop: number
  itch: number
  treat: number
}

interface QuickLogGridProps {
  dogId: string
  onSelect: (mode: LogMode) => void
}

export function QuickLogGrid({ dogId, onSelect }: QuickLogGridProps): React.ReactElement {
  const [counts, setCounts] = useState<TodayCounts>({ poop: 0, itch: 0, treat: 0 })

  const fetchCounts = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/dogs/${dogId}/logs/today`)
      if (res.ok) {
        const data: TodayCounts = await res.json()
        setCounts(data)
      }
    } catch {
      // Non-critical
    }
  }, [dogId])

  useEffect(() => {
    fetchCounts()
  }, [fetchCounts])

  // Re-fetch on window focus or after a log is saved
  useEffect(() => {
    function refresh(): void {
      fetchCounts()
    }
    window.addEventListener("focus", refresh)
    window.addEventListener("log-saved", refresh)
    return () => {
      window.removeEventListener("focus", refresh)
      window.removeEventListener("log-saved", refresh)
    }
  }, [fetchCounts])

  const totalToday = counts.poop + counts.itch + counts.treat
  const hasCheckin = totalToday > 0

  const items: {
    mode: LogMode
    label: string
    icon: React.ComponentType<{ className?: string }>
    count: number | null
  }[] = [
    { mode: "checkin", label: hasCheckin ? "Manage Check-in" : "Daily Check-in", icon: hasCheckin ? LiaCalendarCheckSolid : LiaCalendarTimesSolid, count: totalToday > 0 ? totalToday : null },
    { mode: "poop", label: "Log Stool", icon: LiaPoopSolid, count: counts.poop },
    { mode: "itch", label: "Log Itch", icon: LiaPawSolid, count: counts.itch },
    { mode: "treat", label: "Log Treat", icon: LiaCookieBiteSolid, count: counts.treat },
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.mode}
            type="button"
            onClick={() => onSelect(item.mode)}
            className="relative flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-bg-primary px-4 py-3 text-text-secondary transition-colors hover:border-primary hover:bg-item-active hover:text-primary"
          >
            <Icon className="size-6" />
            <span className="text-[13px] font-medium">{item.label}</span>
            {item.count != null && item.count > 0 && (
              <div className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1">
                <span className="text-[10px] font-bold text-background">{item.count}</span>
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
