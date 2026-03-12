"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useParams } from "next/navigation"
import { useActiveDog } from "@/components/active-dog-provider"
import { IngredientAnalysisSection, type ExtendedCorrelationResult } from "@/components/ingredient-analysis-section"
import { InsightsTimeline } from "@/components/insights-timeline"
import { Button } from "@/components/ui/button"
import type { TimelineRange, TimelineData } from "@/lib/timeline-types"
import type { CorrelationResult, IngredientProductEntry } from "@/lib/correlation/types"

interface InsightsData extends CorrelationResult {
  ingredientProducts: Record<string, IngredientProductEntry[]>
  giIngredientProducts: Record<string, IngredientProductEntry[]>
}

export default function InsightsPage(): React.ReactElement {
  const params = useParams<{ id: string }>()
  const dogId = params.id
  const { setActiveDogId } = useActiveDog()

  useEffect(() => { setActiveDogId(dogId) }, [dogId, setActiveDogId])

  const [data, setData] = useState<InsightsData | null>(null)
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [timelineLoading, setTimelineLoading] = useState(true)
  const [error, setError] = useState(false)
  const [timelineError, setTimelineError] = useState(false)
  const [timelineRange, setTimelineRange] = useState<TimelineRange>("30d")

  // Cache timeline responses by range to avoid re-fetching
  const timelineCacheRef = useRef<Map<TimelineRange, TimelineData>>(new Map())

  // Fetch correlation data once on mount
  const fetchCorrelation = useCallback(async () => {
    setError(false)
    setLoading(true)
    try {
      const res = await fetch(`/api/dogs/${dogId}/insights/correlation`)
      if (res.ok) {
        setData(await res.json())
      } else {
        setError(true)
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [dogId])

  // Fetch timeline data — uses cache if available
  const fetchTimeline = useCallback(async (range: TimelineRange, signal?: AbortSignal) => {
    const cached = timelineCacheRef.current.get(range)
    if (cached) {
      setTimelineData(cached)
      setTimelineLoading(false)
      setTimelineError(false)
      return
    }

    setTimelineLoading(true)
    setTimelineError(false)
    try {
      const res = await fetch(`/api/dogs/${dogId}/insights/timeline?range=${range}`, { signal })
      if (signal?.aborted) return
      if (res.ok) {
        const data = await res.json()
        timelineCacheRef.current.set(range, data)
        setTimelineData(data)
      } else {
        setTimelineError(true)
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return
      console.error("Failed to fetch timeline:", e)
      setTimelineError(true)
    } finally {
      if (!signal?.aborted) {
        setTimelineLoading(false)
      }
    }
  }, [dogId])

  // Clear timeline cache when dog changes
  useEffect(() => {
    timelineCacheRef.current.clear()
  }, [dogId])

  useEffect(() => {
    fetchCorrelation()
  }, [fetchCorrelation])

  useEffect(() => {
    const controller = new AbortController()
    fetchTimeline(timelineRange, controller.signal)
    return () => controller.abort()
  }, [fetchTimeline, timelineRange])

  const correlation: ExtendedCorrelationResult | null = useMemo(() => {
    if (!data) return null
    return {
      ...data,
      ingredientProducts: data.ingredientProducts,
      giIngredientProducts: data.giIngredientProducts,
    }
  }, [data])

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Insights</h1>
        <div className="text-center space-y-2 py-8">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load insights data.</p>
          <Button variant="ghost" size="sm" onClick={() => fetchCorrelation()}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-16">
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Insights</h1>
        <InsightsTimeline
          data={timelineData}
          loading={timelineLoading}
          error={timelineError}
          range={timelineRange}
          onRangeChange={setTimelineRange}
          onRetry={() => {
            timelineCacheRef.current.delete(timelineRange)
            fetchTimeline(timelineRange)
          }}
        />
      </div>
      <IngredientAnalysisSection correlation={correlation} loading={loading} />
    </div>
  )
}
