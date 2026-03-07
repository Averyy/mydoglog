"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import { useActiveDog } from "@/components/active-dog-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { ActivePlanCard } from "@/components/active-plan-card"
import { RoutineEditor } from "@/components/routine-editor"
import {
  FoodScorecardForm,
  type ScorecardData,
} from "@/components/food-scorecard-form"
import { format, parseISO } from "date-fns"
import { toast } from "sonner"
import type { ActivePlan, FeedingPlanGroup, MedicationSummary, RoutineData } from "@/lib/types"

/** Singularize "1 weeks" → "1 week", leave "2 weeks" as-is. */
function formatApproximateDuration(raw: string): string {
  return raw.replace(/^1\s+(\w+)s$/i, "1 $1")
}

function formatVerdict(verdict: string | null): { label: string; className: string } {
  switch (verdict) {
    case "up":
      return { label: "Good", className: "text-score-excellent" }
    case "mixed":
      return { label: "Mixed", className: "text-score-fair" }
    case "down":
      return { label: "Bad", className: "text-score-critical" }
    default:
      return { label: "No verdict", className: "text-muted-foreground" }
  }
}

export default function FeedingPage() {
  const params = useParams<{ id: string }>()
  const dogId = params.id
  const { setActiveDogId } = useActiveDog()

  useEffect(() => { setActiveDogId(dogId) }, [dogId, setActiveDogId])

  const [activePlan, setActivePlan] = useState<ActivePlan | null>(null)
  const [activeMedications, setActiveMedications] = useState<MedicationSummary[]>([])
  const [planHistory, setPlanHistory] = useState<FeedingPlanGroup[]>([])
  const [loading, setLoading] = useState(true)

  // Dialog state
  const [routineEditorOpen, setRoutineEditorOpen] = useState(false)
  const [scorecardOpen, setScorecardOpen] = useState(false)
  const [scorecardPlanGroupId, setScorecardPlanGroupId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [routineRes, historyRes] = await Promise.all([
        fetch(`/api/dogs/${dogId}/routine`),
        fetch(`/api/dogs/${dogId}/feeding`),
      ])

      if (routineRes.ok) {
        const data: RoutineData = await routineRes.json()
        setActivePlan(data.plan)
        setActiveMedications(data.medications)
      }
      if (historyRes.ok) {
        const data = await historyRes.json()
        setPlanHistory(data)
      }
    } finally {
      setLoading(false)
    }
  }, [dogId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  function handleScorecardNeeded(planGroupId: string): void {
    setRoutineEditorOpen(false)
    setScorecardPlanGroupId(planGroupId)
    setScorecardOpen(true)
  }

  async function handleScorecardSave(data: ScorecardData): Promise<void> {
    if (!scorecardPlanGroupId) return

    try {
      const res = await fetch(
        `/api/feeding/groups/${scorecardPlanGroupId}/scorecard`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      )

      if (!res.ok) {
        toast.error("Failed to save scorecard")
        return
      }

      toast.success("Scorecard saved")
      setScorecardOpen(false)
      setRoutineEditorOpen(true)
    } catch {
      toast.error("Something went wrong")
    }
  }

  function handleScorecardSkip(): void {
    setScorecardOpen(false)
    setRoutineEditorOpen(true)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-xl border bg-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Routine</h1>
        <Button onClick={() => setRoutineEditorOpen(true)}>
          {activePlan || activeMedications.length > 0 ? "Edit routine" : "Set up routine"}
        </Button>
      </div>

      {/* Active routine */}
      <ActivePlanCard
        plan={activePlan}
        medications={activeMedications}
        onEditRoutine={() => setRoutineEditorOpen(true)}
      />

      {/* Plan history */}
      {planHistory.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Plan history
          </h2>
          <div className="space-y-2">
            {[...planHistory].sort((a, b) => (b.endDate ?? "9999-12-31").localeCompare(a.endDate ?? "9999-12-31")).map((group) => {
              const verdict = formatVerdict(group.scorecard?.verdict ?? null)
              return (
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
                        {group.scorecard?.verdict && (
                          <span className={`text-xs font-medium ${verdict.className}`}>
                            {verdict.label}
                          </span>
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
              )
            })}
          </div>
        </div>
      )}

      {/* Routine editor (edit current routine — food + medications) */}
      <RoutineEditor
        open={routineEditorOpen}
        onOpenChange={setRoutineEditorOpen}
        dogId={dogId}
        currentPlan={activePlan}
        currentMedications={activeMedications}
        onSaved={fetchData}
        onScorecardNeeded={handleScorecardNeeded}
      />

      {/* Scorecard dialog */}
      <Dialog open={scorecardOpen} onOpenChange={setScorecardOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Rate previous food</DialogTitle>
            <DialogDescription>
              How did the previous food work out?
            </DialogDescription>
          </DialogHeader>
          <FoodScorecardForm
            onSave={handleScorecardSave}
            onSkip={handleScorecardSkip}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
