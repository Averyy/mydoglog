"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useParams } from "next/navigation"
import { useActiveDog } from "@/components/active-dog-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FoodScoreCard } from "@/components/food-score-card"
import { ScoreGrid } from "@/components/score-grid"
import { ActivePlanCard } from "@/components/active-plan-card"
import { PlanGroupCard } from "@/components/plan-group-card"
import { PastRoutineCard } from "@/components/past-routine-card"
import { RoutineEditor } from "@/components/routine-editor"
import { BackfillModal } from "@/components/backfill-modal"
import { ProductIngredientList, type ClassifiedIngredient, type ProductIngredientListData } from "@/components/product-ingredient-list"
import { formatDateRange, daysInRange, avgFromRange } from "@/lib/food-helpers"
import { Plus } from "lucide-react"
import { LiaPenSolid } from "react-icons/lia"
import type { ActivePlan, FeedingPlanGroup, MedicationSummary, RoutineData } from "@/lib/types"
import type { CorrelationResult, IngredientProductEntry } from "@/lib/correlation/types"
import { NON_FOOD_TYPES } from "@/lib/labels"

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

  // Skeleton counts from previous visit — defaults used for SSR, updated after mount
  const skeletonDefaults = { planItems: 3, foodCards: 4 }
  const [skeletonCounts, setSkeletonCounts] = useState(skeletonDefaults)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`food-skeleton-${dogId}`)
      if (raw) {
        const parsed = JSON.parse(raw) as { planItems: number; foodCards: number }
        setSkeletonCounts({ planItems: parsed.planItems || 3, foodCards: parsed.foodCards || 4 })
      }
    } catch { /* ignore */ }
  }, [dogId])

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

  // Persist skeleton counts for next visit
  useEffect(() => {
    if (!data) return
    const activeItems = data.active?.items.length ?? 0
    const pastItems = data.past.reduce((sum, g) => sum + g.items.length, 0)
    const planItems = data.active?.items.length ?? 0
    try {
      localStorage.setItem(`food-skeleton-${dogId}`, JSON.stringify({
        planItems: Math.max(planItems, 1),
        foodCards: Math.max(activeItems + pastItems, 1),
      }))
    } catch { /* ignore */ }
  }, [data, dogId])

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

  const pastRoutines = useMemo(() => sortedPast.filter((g) => !g.isBackfill), [sortedPast])
  const backfillGroups = useMemo(() => sortedPast.filter((g) => g.isBackfill), [sortedPast])

  function openBackfill(): void {
    setEditingGroup(null)
    setBackfillOpen(true)
  }

  function openEditBackfill(group: FeedingPlanGroup): void {
    setEditingGroup(group)
    setBackfillOpen(true)
  }

  // ── Render ──

  const hasContent = !loading && data && (data.active || data.past.length > 0)
  const showError = !loading && fetchError && !hasContent

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        {loading ? (
          <>
            <div className="h-8 w-24 animate-pulse rounded bg-muted" />
            <div className="flex-1" />
            <div className="h-8 w-28 animate-pulse rounded-md bg-muted" />
          </>
        ) : (
          <>
            <h1 className="flex-1 text-2xl font-bold text-foreground">Food</h1>
            <Button size="sm" variant="outline" onClick={() => setRoutineEditorOpen(true)}>
              <LiaPenSolid className="size-4" />
              Edit routine
            </Button>
          </>
        )}
      </div>

      {/* Active plan card */}
      {loading ? (
        <div className="rounded-lg border border-dashed border-border bg-card overflow-hidden py-0">
          {/* Header skeleton: title + score chips */}
          <div className="flex items-center gap-3 px-4 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <div className="h-4 w-56 animate-pulse rounded bg-muted" />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {["Stool", "Itch", "Days", "Cal"].map((label) => (
                <div key={label} className="flex items-center gap-1.5 rounded-md bg-score-strip px-2.5 py-1.5">
                  <div className="h-4 w-6 animate-pulse rounded bg-muted" />
                  <span className="text-xs leading-none font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Product cards skeleton */}
          <div className="px-4 pb-4 flex flex-wrap gap-3">
            {Array.from({ length: skeletonCounts.planItems }).map((_, i) => (
              <div key={i} className="min-w-0 flex-1 basis-40 rounded-md border border-border-light overflow-hidden">
                <div className="flex items-center justify-center bg-score-strip px-3 py-2">
                  <div className="h-24 w-20 animate-pulse rounded bg-muted" />
                </div>
                <div className="p-3 space-y-1.5">
                  <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
                  <div className="h-3.5 w-full animate-pulse rounded bg-muted" />
                  <div className="h-3 w-24 animate-pulse rounded bg-muted mt-1" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : data?.active ? (
        <PlanGroupCard
          group={data.active}
          isCurrent
          productIngredientDataMap={productIngredientDataMap}
          productNutritionMap={productNutritionMap}
          correlationScores={correlation?.scores ?? []}
        />
      ) : (
        <ActivePlanCard
          plan={activePlan}
          medications={activeMedications}
          onEditRoutine={() => setRoutineEditorOpen(true)}
        />
      )}

      {/* Past foods heading */}
      {loading ? (
        <div className="flex items-center gap-3">
          <div className="h-8 w-32 animate-pulse rounded bg-muted" />
          <div className="flex-1" />
          <div className="h-8 w-28 animate-pulse rounded-md bg-muted" />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <h2 className="flex-1 text-2xl font-bold text-foreground">Past Foods</h2>
          <Button size="sm" variant="outline" onClick={openBackfill}>
            <Plus className="size-4" />
            Add past food
          </Button>
        </div>
      )}

      {/* Past routines (non-backfill) */}
      {!loading && pastRoutines.length > 0 && (
        <div className="space-y-3 animate-in fade-in duration-300">
          {pastRoutines.map((group) => (
            <PastRoutineCard
              key={group.planGroupId}
              group={group}
              productIngredientDataMap={productIngredientDataMap}
              productNutritionMap={productNutritionMap}
              correlationScores={correlation?.scores ?? []}
            />
          ))}
        </div>
      )}

      {/* Backfilled food cards */}
      {loading ? (
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: skeletonCounts.foodCards }).map((_, i) => (
            <div key={i} className="min-w-0 basis-72 grow max-w-[calc(33.333%-0.5rem)] overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex items-center justify-center bg-muted px-3 py-3">
                <div className="h-28 w-24 animate-pulse rounded bg-muted-foreground/10" />
              </div>
              <div className="px-4 pt-3 pb-3 space-y-1">
                <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
                <div className="h-3.5 w-44 animate-pulse rounded bg-muted" />
                <div className="h-2.5 w-28 animate-pulse rounded bg-muted mt-1" />
              </div>
              <div className="bg-score-strip px-4 py-2">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {["Stool", "Itch", "Days"].map((label) => (
                    <div key={label}>
                      <p className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">{label}</p>
                      <div className="mx-auto mt-1 h-5 w-6 animate-pulse rounded bg-muted" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-4 pt-3 pb-3 space-y-1.5">
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : showError ? (
        <div className="text-center space-y-2 py-8">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load food data.</p>
          <Button variant="ghost" size="sm" onClick={() => fetchData()}>
            Try again
          </Button>
        </div>
      ) : backfillGroups.length > 0 ? (
        <div className="flex flex-wrap gap-3 animate-in fade-in duration-300">
          {backfillGroups.flatMap((group) => {
            const stats = group.logStats
            const sc = group.scorecard
            const days = daysInRange(group.startDate, group.endDate)
            const avgStool = stats?.avgPoopScore ?? avgFromRange(sc?.poopQuality ?? null)
            const avgItch = stats?.avgItchScore ?? avgFromRange(sc?.itchSeverity ?? null)
            const cards = group.items.map((item) => (
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
                  <button
                    type="button"
                    onClick={() => openEditBackfill(group)}
                    className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline underline-offset-2"
                  >
                    <LiaPenSolid className="size-3" />
                    Edit
                  </button>
                </div>
              </FoodScoreCard>
            ))
            if (group.treats.length > 0) {
              cards.push(
                <div key={`treats-${group.planGroupId}`} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
                  <span className="text-[11px] font-medium uppercase tracking-wider">Treats:</span>
                  {group.treats.map((treat) => (
                    <span key={treat.productId}>
                      {treat.brandName} {treat.productName} <span className="text-text-tertiary">({treat.logCount}x)</span>
                    </span>
                  ))}
                </div>
              )
            }
            return cards
          })}
        </div>
      ) : !hasContent ? (
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
      ) : null}

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
