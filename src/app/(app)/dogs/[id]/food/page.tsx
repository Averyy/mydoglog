"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useParams } from "next/navigation"
import { useActiveDog } from "@/components/active-dog-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { FoodScoreCard } from "@/components/food-score-card"
import { ScoreGrid } from "@/components/score-grid"
import { ActivePlanCard } from "@/components/active-plan-card"
import { RoutineEditor } from "@/components/routine-editor"
import { BackfillModal } from "@/components/backfill-modal"
import { ProductIngredientList, type ClassifiedIngredient, type ProductIngredientListData } from "@/components/product-ingredient-list"
import { formatDateRange, daysInRange, avgFromRange } from "@/lib/food-helpers"
import { format, parseISO } from "date-fns"
import { Pencil, Plus } from "lucide-react"
import type { ActivePlan, FeedingPlanGroup, MedicationSummary, RoutineData } from "@/lib/types"
import type { CorrelationResult, IngredientProductEntry } from "@/lib/correlation/types"
import { NON_FOOD_TYPES } from "@/lib/labels"

/** Singularize "1 weeks" → "1 week", leave "2 weeks" as-is. */
function formatApproximateDuration(raw: string): string {
  return raw.replace(/^1\s+(\w+)s$/i, "1 $1")
}

interface ScorecardPageData {
  past: FeedingPlanGroup[]
  active: FeedingPlanGroup | null
  correlation: CorrelationResult | null
  ingredientProducts: Record<string, IngredientProductEntry[]>
  giIngredientProducts: Record<string, IngredientProductEntry[]>
  productIngredients: Record<string, {
    allIngredients: string[]
    classifiedByPosition: { position: number; normalizedName: string; family: string | null; sourceGroup: string | null; formType: string | null; isHydrolyzed: boolean }[]
    saltPosition: number | null
  }>
  productNutrition: Record<string, {
    guaranteedAnalysis: Record<string, number> | null
    calorieContent: string | null
    type: string | null
    format: string | null
  }>
}

export default function FoodPage(): React.ReactElement {
  const params = useParams<{ id: string }>()
  const dogId = params.id
  const { setActiveDogId } = useActiveDog()

  useEffect(() => { setActiveDogId(dogId) }, [dogId, setActiveDogId])

  // Routine data
  const [activePlan, setActivePlan] = useState<ActivePlan | null>(null)
  const [activeMedications, setActiveMedications] = useState<MedicationSummary[]>([])
  const [routineEditorOpen, setRoutineEditorOpen] = useState(false)

  // Scorecard data
  const [data, setData] = useState<ScorecardPageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  // Backfill modal
  const [backfillOpen, setBackfillOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<FeedingPlanGroup | null>(null)

  const fetchData = useCallback(async () => {
    setFetchError(false)
    try {
      const [routineRes, scorecardRes] = await Promise.all([
        fetch(`/api/dogs/${dogId}/food/routine`),
        fetch(`/api/dogs/${dogId}/food/scorecard`),
      ])

      let anyFailed = false
      if (routineRes.ok) {
        const routineData: RoutineData = await routineRes.json()
        setActivePlan(routineData.plan)
        setActiveMedications(routineData.medications)
      } else {
        anyFailed = true
      }
      if (scorecardRes.ok) {
        const result: ScorecardPageData = await scorecardRes.json()
        setData(result)
      } else {
        anyFailed = true
      }
      if (anyFailed) setFetchError(true)
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [dogId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const correlation = useMemo(() => {
    if (!data?.correlation) return null
    return {
      ...data.correlation,
      ingredientProducts: data.ingredientProducts,
      giIngredientProducts: data.giIngredientProducts,
    }
  }, [data])

  const productIngredientDataMap = useMemo(() => {
    const map = new Map<string, ProductIngredientListData>()
    if (!data?.productIngredients) return map
    for (const [pid, pdata] of Object.entries(data.productIngredients)) {
      const classifiedByPosition = new Map<number, ClassifiedIngredient>()
      for (const ing of pdata.classifiedByPosition) {
        classifiedByPosition.set(ing.position, ing)
      }
      map.set(pid, {
        allIngredients: pdata.allIngredients,
        classifiedByPosition,
        saltPosition: pdata.saltPosition,
      })
    }
    return map
  }, [data])

  const productNutritionMap = useMemo(() => {
    const map = new Map<string, { guaranteedAnalysis: Record<string, number> | null; calorieContent: string | null; type: string | null; format: string | null }>()
    if (!data?.productNutrition) return map
    for (const [pid, ndata] of Object.entries(data.productNutrition)) {
      map.set(pid, ndata)
    }
    return map
  }, [data])

  // Existing food periods for backfill overlap detection
  const existingPeriods = useMemo(() => {
    if (!data) return []
    const groups = [...data.past]
    if (data.active) groups.push(data.active)
    return groups
      .filter((g) => !g.items.every((item) => NON_FOOD_TYPES.has(item.type ?? "")))
      .map((g) => ({
        planGroupId: g.planGroupId,
        start: g.startDate,
        end: g.endDate,
        label: g.items
          .filter((item) => !NON_FOOD_TYPES.has(item.type ?? ""))
          .map((item) => [item.brandName, item.productName].filter(Boolean).join(" "))
          .join(", "),
      }))
  }, [data])

  const allGroups = useMemo((): FeedingPlanGroup[] => {
    if (!data) return []
    const groups = [...data.past]
    if (data.active) groups.push(data.active)
    return groups
  }, [data])

  const sortedPast = useMemo(() => {
    if (!data) return []
    return [...data.past]
      .sort((a, b) => (b.endDate ?? "9999-12-31").localeCompare(a.endDate ?? "9999-12-31"))
  }, [data])

  // Plan history (non-backfill entries)
  const planHistory = useMemo((): FeedingPlanGroup[] => {
    return sortedPast.filter((g) => !g.isBackfill)
  }, [sortedPast])

  function openBackfill(): void {
    setEditingGroup(null)
    setBackfillOpen(true)
  }

  function openEditBackfill(group: FeedingPlanGroup): void {
    setEditingGroup(group)
    setBackfillOpen(true)
  }

  // ── Render ──

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-xl border bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  const hasContent = data && (data.active || data.past.length > 0)

  if (fetchError && !hasContent) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Food</h1>
        <div className="text-center space-y-2 py-8">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load food data.</p>
          <Button variant="ghost" size="sm" onClick={() => fetchData()}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold text-foreground">Food</h1>
        <Button size="sm" variant="outline" onClick={openBackfill}>
          <Plus className="size-4" />
          Add past food
        </Button>
      </div>

      {/* Active routine */}
      <ActivePlanCard
        plan={activePlan}
        medications={activeMedications}
        onEditRoutine={() => setRoutineEditorOpen(true)}
      />

      {/* Food cards */}
      {hasContent && (
        <div className="flex flex-wrap gap-3">
          {data?.active?.items.map((item) => {
            const stats = data.active!.logStats
            const sc = data.active!.scorecard
            const days = daysInRange(data.active!.startDate, null)
            const avgStool = stats?.avgPoopScore ?? avgFromRange(sc?.poopQuality ?? null)
            const avgItch = stats?.avgItchScore ?? avgFromRange(sc?.itchSeverity ?? null)
            return (
              <FoodScoreCard
                key={item.id}
                brandName={item.brandName}
                productName={item.productName}
                imageUrl={item.imageUrl}
                isCurrent
                dateLabel={formatDateRange(data.active!.startDate, null)}
                className="min-w-0 basis-72 grow max-w-[calc(33.333%-0.5rem)] border-dashed"
              >
                <div className="-mx-4 bg-score-strip px-4 py-2">
                  <ScoreGrid avgStool={avgStool} avgItch={avgItch} days={days} />
                </div>
                <div className="pt-3">
                  <ProductIngredientList
                    data={productIngredientDataMap.get(item.productId)}
                    nutrition={productNutritionMap.get(item.productId)}
                    correlationScores={correlation?.scores ?? []}
                  />
                </div>
              </FoodScoreCard>
            )
          })}

          {sortedPast.flatMap((group) =>
            group.items.map((item) => {
              const stats = group.logStats
              const sc = group.scorecard
              const days = daysInRange(group.startDate, group.endDate)
              const avgStool = stats?.avgPoopScore ?? avgFromRange(sc?.poopQuality ?? null)
              const avgItch = stats?.avgItchScore ?? avgFromRange(sc?.itchSeverity ?? null)
              return (
                <FoodScoreCard
                  key={item.id}
                  brandName={item.brandName}
                  productName={item.productName}
                  imageUrl={item.imageUrl}
                  dateLabel={formatDateRange(group.startDate, group.endDate)}
                  className="min-w-0 basis-72 grow max-w-[calc(33.333%-0.5rem)]"
                >
                  <div className="-mx-4 bg-score-strip px-4 py-2">
                    <ScoreGrid avgStool={avgStool} avgItch={avgItch} days={days} />
                  </div>
                  <div className="pt-3 flex items-center justify-between gap-2">
                    <ProductIngredientList
                      data={productIngredientDataMap.get(item.productId)}
                      nutrition={productNutritionMap.get(item.productId)}
                      correlationScores={correlation?.scores ?? []}
                    />
                    {group.isBackfill && (
                      <button
                        type="button"
                        onClick={() => openEditBackfill(group)}
                        className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline underline-offset-2"
                      >
                        <Pencil className="size-3" />
                        Edit
                      </button>
                    )}
                  </div>
                </FoodScoreCard>
              )
            }),
          )}
        </div>
      )}

      {!hasContent && (
        <Card>
          <CardContent className="py-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              No food plans yet.
            </p>
            <Button variant="outline" onClick={openBackfill}>
              <Plus className="size-4" />
              Add a past food
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Plan history */}
      {planHistory.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Plan history
          </h2>
          <div className="space-y-2">
            {planHistory.map((group) => (
              <Card key={group.planGroupId} className="py-0">
                <CardContent className="py-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {format(parseISO(group.startDate), "MMM d, yyyy")}
                        {group.endDate
                          ? ` — ${format(parseISO(group.endDate), "MMM d, yyyy")}`
                          : " — Ongoing"}
                        {group.isBackfill && group.approximateDuration && (
                          <span className="text-muted-foreground font-normal">
                            {" "}({formatApproximateDuration(group.approximateDuration)})
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {group.isBackfill && (
                        <Badge variant="outline" className="text-[10px]">
                          Backfill
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-1">
                    {group.items.map((item) => (
                      <p key={item.id} className="text-xs text-muted-foreground">
                        {item.productName}
                        {item.quantity && ` — ${item.quantity} ${item.quantityUnit ?? ""}`}
                      </p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Routine editor */}
      <RoutineEditor
        open={routineEditorOpen}
        onOpenChange={setRoutineEditorOpen}
        dogId={dogId}
        currentPlan={activePlan}
        currentMedications={activeMedications}
        onSaved={fetchData}
      />

      {/* Backfill modal */}
      <BackfillModal
        open={backfillOpen}
        onOpenChange={setBackfillOpen}
        dogId={dogId}
        editingGroup={editingGroup}
        existingPeriods={existingPeriods}
        allGroups={allGroups}
        onSaved={fetchData}
      />
    </div>
  )
}
