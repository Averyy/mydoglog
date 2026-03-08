"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useParams } from "next/navigation"
import { useActiveDog } from "@/components/active-dog-provider"
import { IngredientAnalysisSection, type ExtendedCorrelationResult } from "@/components/ingredient-analysis-section"
import { Button } from "@/components/ui/button"
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const fetchData = useCallback(async () => {
    setError(false)
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

  useEffect(() => {
    fetchData()
  }, [fetchData])

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
          <Button variant="ghost" size="sm" onClick={() => fetchData()}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Insights</h1>
      <IngredientAnalysisSection correlation={correlation} loading={loading} />
    </div>
  )
}
