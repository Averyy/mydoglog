"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import { useActiveDog } from "@/components/active-dog-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { FoodScoreCard } from "@/components/food-score-card"
import { ProductPicker } from "@/components/product-picker"
import { ResponsiveModal } from "@/components/responsive-modal"
import {
  FoodScorecardForm,
  type ScorecardData,
} from "@/components/food-scorecard-form"
import { format, parseISO } from "date-fns"
import { toast } from "sonner"
import { Info, Pencil, Plus, Star } from "lucide-react"
import type { FeedingPlanGroup, LogStats, ProductSummary, ScorecardSummary } from "@/lib/types"
import type { CorrelationResult, IngredientScore, Confidence } from "@/lib/correlation/types"

// ── Label maps for scorecard display ──

const GAS_LABELS: Record<string, string> = {
  none: "None", mild: "Mild", bad: "Bad", terrible: "Terrible",
}
const VOMITING_LABELS: Record<string, string> = {
  none: "None", occasional: "Occasional", frequent: "Frequent",
}
const PALATABILITY_LABELS: Record<string, string> = {
  loved: "Loved", ate: "Ate", reluctant: "Reluctant", refused: "Refused",
}
const ITCHINESS_IMPACT_LABELS: Record<string, string> = {
  better: "Better", no_change: "No change", worse: "Worse",
}
const POOP_LABELS: Record<number, string> = {
  1: "Hard pellets", 2: "Ideal", 3: "Soft", 4: "Soggy",
  5: "Soft piles", 6: "No shape", 7: "Liquid",
}

const POOP_SCORE_COLORS: Record<number, string> = {
  1: "text-score-excellent", 2: "text-score-excellent",
  3: "text-score-good", 4: "text-score-fair",
  5: "text-score-fair", 6: "text-score-poor",
  7: "text-score-critical",
}

const ITCH_SCORE_COLORS: Record<number, string> = {
  1: "text-score-excellent", 2: "text-score-good",
  3: "text-score-fair", 4: "text-score-poor",
  5: "text-score-critical",
}

function poopScoreColor(avg: number): string {
  return POOP_SCORE_COLORS[Math.round(avg)] ?? "text-foreground"
}

function itchScoreColor(avg: number): string {
  return ITCH_SCORE_COLORS[Math.round(avg)] ?? "text-foreground"
}

// ── Log stats display (computed from actual daily logs) ──

function LogStatsDisplay({ stats }: { stats: LogStats }): React.ReactElement {
  const hasAnyData = stats.daysWithData > 0

  if (!hasAnyData) {
    return (
      <p className="text-xs text-muted-foreground">No daily logs during this period</p>
    )
  }

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5">
      {stats.avgPoopScore != null && (
        <div className="flex items-baseline gap-1.5">
          <span className={`text-lg font-bold tabular-nums ${poopScoreColor(stats.avgPoopScore)}`}>
            {stats.avgPoopScore}
          </span>
          <span className="text-xs text-muted-foreground">
            avg stool <span className="text-text-tertiary">({stats.poopLogCount} {stats.poopLogCount === 1 ? "log" : "logs"})</span>
          </span>
        </div>
      )}
      {stats.avgItchScore != null && (
        <div className="flex items-baseline gap-1.5">
          <span className={`text-lg font-bold tabular-nums ${itchScoreColor(stats.avgItchScore)}`}>
            {stats.avgItchScore}
          </span>
          <span className="text-xs text-muted-foreground">
            avg itch <span className="text-text-tertiary">({stats.itchLogCount} {stats.itchLogCount === 1 ? "log" : "logs"})</span>
          </span>
        </div>
      )}
      {stats.vomitLogCount > 0 && (
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold tabular-nums text-score-critical">
            {stats.vomitLogCount}
          </span>
          <span className="text-xs text-muted-foreground">
            {stats.vomitLogCount === 1 ? "vomit event" : "vomit events"}
          </span>
        </div>
      )}
    </div>
  )
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

function verdictBadgeVariant(verdict: string | null): { bg: string; text: string } {
  switch (verdict) {
    case "up":
      return { bg: "bg-score-excellent-bg", text: "text-score-excellent" }
    case "mixed":
      return { bg: "bg-score-fair-bg", text: "text-score-fair" }
    case "down":
      return { bg: "bg-score-critical-bg", text: "text-score-critical" }
    default:
      return { bg: "bg-muted", text: "text-muted-foreground" }
  }
}

function formatDateRange(startDate: string, endDate: string | null): string {
  const start = format(parseISO(startDate), "MMM d, yyyy")
  if (!endDate) return `Active since ${start}`
  return `${start} — ${format(parseISO(endDate), "MMM d, yyyy")}`
}

// ── Scorecard detail display ──

function ScorecardDetails({ sc }: { sc: ScorecardSummary }): React.ReactElement {
  const verdict = formatVerdict(sc.verdict)
  const badgeStyle = verdictBadgeVariant(sc.verdict)

  const rows: { label: string; value: string | null }[] = [
    { label: "Poop", value: sc.poopQuality != null ? `${sc.poopQuality} — ${POOP_LABELS[sc.poopQuality] ?? ""}` : null },
    { label: "Gas", value: sc.gas ? GAS_LABELS[sc.gas] ?? sc.gas : null },
    { label: "Vomiting", value: sc.vomiting ? VOMITING_LABELS[sc.vomiting] ?? sc.vomiting : null },
    { label: "Palatability", value: sc.palatability ? PALATABILITY_LABELS[sc.palatability] ?? sc.palatability : null },
    { label: "Itch impact", value: sc.itchinessImpact ? ITCHINESS_IMPACT_LABELS[sc.itchinessImpact] ?? sc.itchinessImpact : null },
  ]

  const filledRows = rows.filter((r) => r.value !== null)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${badgeStyle.bg} ${badgeStyle.text}`}>
          {verdict.label}
        </span>
        {sc.primaryReason && (
          <span className="text-xs text-muted-foreground">
            {sc.primaryReason.replace(/_/g, " ")}
          </span>
        )}
      </div>
      {filledRows.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {filledRows.map((r) => (
            <p key={r.label} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{r.label}:</span> {r.value}
            </p>
          ))}
        </div>
      )}
      {sc.notes && (
        <p className="text-xs italic text-muted-foreground">{sc.notes}</p>
      )}
    </div>
  )
}

// ── Confidence badge styling ──

const CONFIDENCE_STYLES: Record<Confidence, { bg: string; text: string }> = {
  high: { bg: "bg-score-excellent-bg", text: "text-score-excellent" },
  medium: { bg: "bg-score-fair-bg", text: "text-score-fair" },
  low: { bg: "bg-score-critical-bg", text: "text-score-critical" },
  insufficient: { bg: "bg-muted", text: "text-muted-foreground" },
}

// ── Ingredient analysis components ──

function IngredientRow({ score }: { score: IngredientScore }): React.ReactElement {
  const conf = CONFIDENCE_STYLES[score.confidence]

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 py-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground capitalize">
            {score.key}
          </span>
          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium ${conf.bg} ${conf.text}`}>
            {score.confidence}
          </span>
          <span className="text-xs text-muted-foreground">
            {score.dayCount} {score.dayCount === 1 ? "day" : "days"}
          </span>
          {score.appearedInTreats && (
            <span className="text-[10px] text-muted-foreground">(from treats)</span>
          )}
          {score.crossReactivityGroup && (
            <Badge variant="outline" className="text-score-fair text-[10px]">
              Cross-reactive: {score.crossReactivityGroup}
            </Badge>
          )}
        </div>
        <div className="flex items-baseline gap-4 shrink-0">
          {score.avgPoopScore != null && (
            <div className="flex items-baseline gap-1">
              <span className={`text-lg font-bold tabular-nums ${poopScoreColor(score.avgPoopScore)}`}>
                {score.avgPoopScore.toFixed(1)}
              </span>
              <span className="text-[10px] text-muted-foreground">stool</span>
            </div>
          )}
          {score.avgItchScore != null && (
            <div className="flex items-baseline gap-1">
              <span className={`text-lg font-bold tabular-nums ${itchScoreColor(score.avgItchScore)}`}>
                {score.avgItchScore.toFixed(1)}
              </span>
              <span className="text-[10px] text-muted-foreground">itch</span>
            </div>
          )}
          {score.avgPoopScore == null && score.avgItchScore == null && (
            <span className="text-xs text-muted-foreground">No data</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function IngredientAnalysisSection({
  correlation,
  loading,
}: {
  correlation: CorrelationResult | null
  loading: boolean
}): React.ReactElement {
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-3 w-56 animate-pulse rounded bg-muted" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    )
  }

  if (!correlation || correlation.totalDays === 0) {
    return (
      <div className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-[0.05em] text-muted-foreground">
          Ingredient Analysis
        </h2>
        <Card>
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Add food plans to see ingredient analysis
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (correlation.scores.length === 0) {
    return (
      <div className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-[0.05em] text-muted-foreground">
          Ingredient Analysis
        </h2>
        <Card>
          <CardContent className="py-6 text-center space-y-1">
            <p className="text-sm text-foreground">
              {correlation.scoreableDays} of 3 scoreable days logged
            </p>
            <p className="text-xs text-muted-foreground">
              Log daily check-ins with poop or itch scores to unlock ingredient analysis.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Sort by avgPoopScore descending (worst first), nulls last
  const sorted = [...correlation.scores].sort((a, b) => {
    if (a.avgPoopScore == null && b.avgPoopScore == null) return 0
    if (a.avgPoopScore == null) return 1
    if (b.avgPoopScore == null) return -1
    return b.avgPoopScore - a.avgPoopScore
  })

  // Low-variance detection: all poop scores within 0.5 of each other
  const poopScores = sorted
    .map((s) => s.avgPoopScore)
    .filter((v): v is number => v != null)
  const isLowVariance =
    poopScores.length >= 2 &&
    Math.max(...poopScores) - Math.min(...poopScores) < 0.5

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xs font-medium uppercase tracking-[0.05em] text-muted-foreground">
          Ingredient Analysis
        </h2>
        <p className="text-[11px] text-text-tertiary mt-0.5">
          Last {correlation.totalDays} days · {correlation.scoreableDays} scoreable
        </p>
      </div>
      {isLowVariance && (
        <div className="flex items-start gap-2 rounded-lg bg-score-fair-bg px-3 py-2">
          <Info className="size-4 shrink-0 text-score-fair mt-0.5" />
          <p className="text-xs text-score-fair">
            All ingredients show similar scores — likely a stable single-diet period.
          </p>
        </div>
      )}
      <div className="space-y-2">
        {sorted.map((score) => (
          <IngredientRow key={score.key} score={score} />
        ))}
      </div>
    </div>
  )
}

// ── Types ──

interface ScorecardPageData {
  scored: FeedingPlanGroup[]
  needsScoring: FeedingPlanGroup[]
  active: FeedingPlanGroup | null
}

// ── Backfill modal steps ──

type BackfillStep = "product" | "scorecard"

interface BackfillProduct {
  product: ProductSummary
  durationValue: string
  durationUnit: string
}

// ── Page ──

export default function FoodScorecardPage() {
  const params = useParams<{ id: string }>()
  const dogId = params.id
  const { setActiveDogId } = useActiveDog()

  useEffect(() => { setActiveDogId(dogId) }, [dogId, setActiveDogId])

  const [data, setData] = useState<ScorecardPageData | null>(null)
  const [loading, setLoading] = useState(true)

  // Correlation
  const [correlation, setCorrelation] = useState<CorrelationResult | null>(null)
  const [correlationLoading, setCorrelationLoading] = useState(true)

  // Score existing plan modal
  const [scoreModalOpen, setScoreModalOpen] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<FeedingPlanGroup | null>(null)

  // Backfill modal
  const [backfillOpen, setBackfillOpen] = useState(false)
  const [backfillStep, setBackfillStep] = useState<BackfillStep>("product")
  const [backfillProduct, setBackfillProduct] = useState<BackfillProduct | null>(null)
  const [backfillSaving, setBackfillSaving] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/dogs/${dogId}/food-scorecard`)
      if (res.ok) {
        const result: ScorecardPageData = await res.json()
        setData(result)
      }
    } finally {
      setLoading(false)
    }
  }, [dogId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const fetchCorrelation = useCallback(async () => {
    try {
      const res = await fetch(`/api/dogs/${dogId}/correlation`)
      if (res.ok) {
        const result: CorrelationResult = await res.json()
        setCorrelation(result)
      }
    } finally {
      setCorrelationLoading(false)
    }
  }, [dogId])

  useEffect(() => {
    fetchCorrelation()
  }, [fetchCorrelation])

  // ── Score existing plan ──

  function openScorecard(group: FeedingPlanGroup): void {
    setSelectedGroup(group)
    setScoreModalOpen(true)
  }

  async function handleScoreSave(scorecardData: ScorecardData): Promise<void> {
    if (!selectedGroup) return

    try {
      const res = await fetch(
        `/api/feeding/groups/${selectedGroup.planGroupId}/scorecard`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scorecardData),
        },
      )

      if (!res.ok) {
        toast.error("Failed to save scorecard")
        return
      }

      toast.success("Scorecard saved")
      setScoreModalOpen(false)
      setSelectedGroup(null)
      fetchData()
    } catch {
      toast.error("Something went wrong")
    }
  }

  function handleScoreSkip(): void {
    setScoreModalOpen(false)
    setSelectedGroup(null)
  }

  // ── Backfill flow ──

  function openBackfill(): void {
    setBackfillProduct(null)
    setBackfillStep("product")
    setBackfillOpen(true)
  }

  function handleBackfillProductSelected(product: ProductSummary | null): void {
    if (!product) return
    setBackfillProduct({
      product,
      durationValue: "",
      durationUnit: "weeks",
    })
  }

  function handleBackfillNext(): void {
    if (!backfillProduct || !backfillProduct.durationValue) {
      toast.error("Enter how long you fed this food")
      return
    }
    setBackfillStep("scorecard")
  }

  async function handleBackfillSave(scorecardData: ScorecardData): Promise<void> {
    if (!backfillProduct) return
    setBackfillSaving(true)

    const duration = `${backfillProduct.durationValue} ${backfillProduct.durationUnit}`

    try {
      const res = await fetch(`/api/dogs/${dogId}/feeding/backfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: backfillProduct.product.id }],
          approximateDuration: duration,
          scorecard: scorecardData,
        }),
      })

      if (!res.ok) {
        toast.error("Failed to save")
        return
      }

      toast.success("Past food scored")
      setBackfillOpen(false)
      setBackfillProduct(null)
      fetchData()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setBackfillSaving(false)
    }
  }

  function handleBackfillSkip(): void {
    if (!backfillProduct) return
    handleBackfillSaveWithoutScorecard()
  }

  async function handleBackfillSaveWithoutScorecard(): Promise<void> {
    if (!backfillProduct || !backfillProduct.durationValue) return
    setBackfillSaving(true)

    const duration = `${backfillProduct.durationValue} ${backfillProduct.durationUnit}`

    try {
      const res = await fetch(`/api/dogs/${dogId}/feeding/backfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: backfillProduct.product.id }],
          approximateDuration: duration,
        }),
      })

      if (!res.ok) {
        toast.error("Failed to save")
        return
      }

      toast.success("Past food added")
      setBackfillOpen(false)
      setBackfillProduct(null)
      fetchData()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setBackfillSaving(false)
    }
  }

  // ── Render ──

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  const hasContent = data && (data.active || data.needsScoring.length > 0 || data.scored.length > 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold text-foreground">Food Scorecard</h1>
        <Button size="sm" variant="outline" onClick={openBackfill}>
          <Plus className="size-4" />
          Add past food
        </Button>
      </div>

      {!hasContent && (
        <Card>
          <CardContent className="py-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              No food plans to score yet.
            </p>
            <Button variant="outline" onClick={openBackfill}>
              <Plus className="size-4" />
              Add a past food
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Active plan — one card per product */}
      {data?.active && (
        <div className="flex flex-wrap gap-4">
          {data.active.items.map((item) => (
            <FoodScoreCard
              key={item.id}
              brandName={item.brandName}
              productName={item.productName}
              imageUrl={item.imageUrl}
              quantity={item.quantity}
              quantityUnit={item.quantityUnit}
              className="max-w-[380px] flex-1 basis-[300px] border-dashed"
            >
              <div className="flex flex-1 flex-col gap-3">
                {data.active!.logStats && (
                  <LogStatsDisplay stats={data.active!.logStats} />
                )}
                <div className="mt-auto flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {formatDateRange(data.active!.startDate, null)}
                  </p>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    Current
                  </Badge>
                </div>
              </div>
            </FoodScoreCard>
          ))}
        </div>
      )}

      {/* Needs scoring — one card per product */}
      {data && data.needsScoring.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-[0.05em] text-muted-foreground">
            Needs Scoring
          </h2>
          <div className="flex flex-wrap gap-4">
            {data.needsScoring.flatMap((group) =>
              group.items.map((item) => (
                <FoodScoreCard
                  key={item.id}
                  brandName={item.brandName}
                  productName={item.productName}
                  imageUrl={item.imageUrl}
                  quantity={item.quantity}
                  quantityUnit={item.quantityUnit}
                  className="max-w-[380px] flex-1 basis-[300px]"
                >
                  <div className="space-y-3">
                    {group.logStats && (
                      <LogStatsDisplay stats={group.logStats} />
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatDateRange(group.startDate, group.endDate)}
                    </p>
                    <Button
                      size="sm"
                      onClick={() => openScorecard(group)}
                      className="w-full"
                    >
                      <Star className="size-4" />
                      Rate this food
                    </Button>
                  </div>
                </FoodScoreCard>
              )),
            )}
          </div>
        </div>
      )}

      {/* Scored — one card per product */}
      {data && data.scored.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-[0.05em] text-muted-foreground">
            Scored
          </h2>
          <div className="flex flex-wrap gap-4">
            {data.scored.flatMap((group) =>
              group.items.map((item) => (
                <FoodScoreCard
                  key={item.id}
                  brandName={item.brandName}
                  productName={item.productName}
                  imageUrl={item.imageUrl}
                  quantity={item.quantity}
                  quantityUnit={item.quantityUnit}
                  className="max-w-[380px] flex-1 basis-[300px]"
                >
                  <div className="space-y-3">
                    {group.logStats && (
                      <LogStatsDisplay stats={group.logStats} />
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {formatDateRange(group.startDate, group.endDate)}
                        {group.isBackfill && " · Backfill"}
                      </p>
                      <button
                        type="button"
                        onClick={() => openScorecard(group)}
                        className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline underline-offset-2"
                      >
                        <Pencil className="size-3" />
                        Edit
                      </button>
                    </div>
                    <Separator />
                    {group.scorecard && (
                      <ScorecardDetails sc={group.scorecard} />
                    )}
                  </div>
                </FoodScoreCard>
              )),
            )}
          </div>
        </div>
      )}

      {/* Ingredient analysis */}
      <IngredientAnalysisSection
        correlation={correlation}
        loading={correlationLoading}
      />

      {/* Score existing plan modal */}
      <ResponsiveModal
        open={scoreModalOpen}
        onOpenChange={setScoreModalOpen}
        title={selectedGroup?.scorecard ? "Edit scorecard" : "Rate this food"}
        description="How did this food work out?"
        size="lg"
      >
        <FoodScorecardForm
          key={selectedGroup?.planGroupId}
          onSave={handleScoreSave}
          onSkip={handleScoreSkip}
          initialData={selectedGroup?.scorecard ?? undefined}
        />
      </ResponsiveModal>

      {/* Backfill modal */}
      <ResponsiveModal
        open={backfillOpen}
        onOpenChange={setBackfillOpen}
        title={backfillStep === "product" ? "Add past food" : "Rate this food"}
        description={backfillStep === "product"
          ? "Add a food your dog has eaten before."
          : "How did this food work out?"}
        size="lg"
      >
        {backfillStep === "product" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium uppercase tracking-[0.05em] text-muted-foreground">
                Product
              </Label>
              <ProductPicker
                value={backfillProduct?.product ?? null}
                onChange={handleBackfillProductSelected}
                placeholder="Search foods..."
                inline
              />
            </div>

            {backfillProduct && (
              <>
                <div className="space-y-2">
                  <Label className="text-xs font-medium uppercase tracking-[0.05em] text-muted-foreground">
                    How long did you feed this?
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="1"
                      placeholder="e.g. 3"
                      value={backfillProduct.durationValue}
                      onChange={(e) =>
                        setBackfillProduct({ ...backfillProduct, durationValue: e.target.value })
                      }
                      className="w-24"
                    />
                    <Select
                      value={backfillProduct.durationUnit}
                      onValueChange={(v) =>
                        setBackfillProduct({ ...backfillProduct, durationUnit: v })
                      }
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="days">Days</SelectItem>
                        <SelectItem value="weeks">Weeks</SelectItem>
                        <SelectItem value="months">Months</SelectItem>
                        <SelectItem value="years">Years</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  onClick={handleBackfillNext}
                  disabled={!backfillProduct.durationValue || backfillSaving}
                  className="mt-2 w-full"
                >
                  Next — Rate this food
                </Button>
              </>
            )}
          </div>
        ) : (
          <FoodScorecardForm
            onSave={handleBackfillSave}
            onSkip={handleBackfillSkip}
          />
        )}
      </ResponsiveModal>
    </div>
  )
}
