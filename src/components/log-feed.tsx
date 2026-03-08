"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Clipboard, Cookie, Droplets } from "lucide-react"
import { format, parseISO, isToday, isYesterday } from "date-fns"
import { poopScoreColor, itchScoreColor } from "@/components/score-grid"
import { Button } from "@/components/ui/button"
import { FECAL_SCORE_LABELS } from "@/lib/labels"
import type { LogFeedEntry, LogFeedResponse } from "@/lib/types"

function formatTime(datetime: string | null): string | null {
  if (!datetime) return null
  return format(new Date(datetime), "h:mm a")
}

function formatDateHeader(date: string): string {
  const d = parseISO(date)
  if (isToday(d)) return "Today"
  if (isYesterday(d)) return "Yesterday"
  return format(d, "EEEE, MMM d")
}

export function LogFeed({ dogId }: { dogId: string }): React.ReactElement {
  const [entries, setEntries] = useState<LogFeedEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [oldestDate, setOldestDate] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState(false)

  const fetchLogs = useCallback(async (before?: string) => {
    const isMore = !!before
    if (isMore) setLoadingMore(true)
    else {
      setLoading(true)
      setEntries([])
      setError(false)
    }

    try {
      const params = new URLSearchParams({ days: "7" })
      if (before) params.set("before", before)
      const res = await fetch(`/api/dogs/${dogId}/logs/recent?${params}`)
      if (res.ok) {
        const data: LogFeedResponse = await res.json()
        if (isMore) {
          setEntries((prev) => {
            const existingIds = new Set(prev.map((e) => e.id))
            const newEntries = data.entries.filter((e) => !existingIds.has(e.id))
            return [...prev, ...newEntries]
          })
        } else {
          setEntries(data.entries)
        }
        setOldestDate(data.startDate)
        setHasMore(data.entries.length > 0)
      } else {
        if (!isMore) setError(true)
        setHasMore(false)
      }
    } catch {
      if (!isMore) setError(true)
      setHasMore(false)
    } finally {
      if (isMore) setLoadingMore(false)
      else setLoading(false)
    }
  }, [dogId])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  function handleLoadMore(): void {
    if (!oldestDate) return
    // Subtract one day so the next window doesn't re-include the boundary date.
    // Without this, a 7+ day gap in logging returns 0 entries and stops pagination.
    const d = new Date(oldestDate)
    d.setDate(d.getDate() - 1)
    fetchLogs(d.toISOString().split("T")[0])
  }

  // Group entries by date (must be before early returns to satisfy Rules of Hooks)
  const grouped = useMemo(() => {
    const map = new Map<string, LogFeedEntry[]>()
    for (const entry of entries) {
      const list = map.get(entry.date) ?? []
      list.push(entry)
      map.set(entry.date, list)
    }
    return map
  }, [entries])

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center space-y-2 py-4">
        <p className="text-sm text-text-secondary">Couldn&apos;t load recent logs.</p>
        <Button variant="ghost" size="sm" onClick={() => fetchLogs()}>
          Try again
        </Button>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        No recent logs. Tap + to start logging.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {[...grouped.entries()].map(([date, dateEntries]) => (
        <div key={date} className="space-y-1.5">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
            {formatDateHeader(date)}
          </h3>
          <div className="space-y-1">
            {dateEntries.map((entry) => (
              <LogEntryRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      ))}
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="w-full text-xs text-text-secondary"
        >
          {loadingMore ? "Loading..." : "Load more"}
        </Button>
      )}
    </div>
  )
}

function LogEntryRow({ entry }: { entry: LogFeedEntry }): React.ReactElement {
  const time = formatTime(entry.datetime)

  if (entry.type === "poop") {
    const score = entry.data.firmnessScore as number
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
        <Clipboard className="size-4 text-text-tertiary shrink-0" strokeWidth={1.5} />
        <div className="flex-1 min-w-0">
          <span className={`text-sm font-bold tabular-nums ${poopScoreColor(score)}`}>
            {score}
          </span>
          <span className="text-xs text-text-secondary ml-1.5">
            {FECAL_SCORE_LABELS[score]}
          </span>
        </div>
        {time && <span className="text-[11px] text-text-tertiary shrink-0">{time}</span>}
      </div>
    )
  }

  if (entry.type === "itch") {
    const score = entry.data.score as number
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
        <Droplets className="size-4 text-text-tertiary shrink-0" strokeWidth={1.5} />
        <div className="flex-1 min-w-0">
          <span className={`text-sm font-bold tabular-nums ${itchScoreColor(score)}`}>
            {score}
          </span>
          <span className="text-xs text-text-secondary ml-1.5">itch</span>
        </div>
        {time && <span className="text-[11px] text-text-tertiary shrink-0">{time}</span>}
      </div>
    )
  }

  // treat
  const productName = (entry.data.productName as string) ?? "Unknown treat"
  const quantity = entry.data.quantity as number | null
  const quantityUnit = entry.data.quantityUnit as string | null
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
      <Cookie className="size-4 text-text-tertiary shrink-0" strokeWidth={1.5} />
      <div className="flex-1 min-w-0">
        <span className="text-sm text-text-primary truncate">{productName}</span>
        {quantity != null && (
          <span className="text-xs text-text-secondary ml-1.5">
            ×{quantity}{quantityUnit ? ` ${quantityUnit}` : ""}
          </span>
        )}
      </div>
      {time && <span className="text-[11px] text-text-tertiary shrink-0">{time}</span>}
    </div>
  )
}
