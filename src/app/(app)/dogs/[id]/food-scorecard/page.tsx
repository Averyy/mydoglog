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
import { ChevronDown, ChevronRight, Info, Pencil, Plus, Star } from "lucide-react"
import type { FeedingPlanGroup, LogStats, ProductSummary, ScorecardSummary } from "@/lib/types"
import type { CorrelationResult, IngredientScore, PositionCategory, IngredientProductEntry } from "@/lib/correlation/types"
import { COMMON_TRIGGERS, splitIngredients } from "@/lib/ingredients"

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

function formatPoopQualityRange(scores: number[] | null): string | null {
  if (!scores || scores.length === 0) return null
  if (scores.length === 1) {
    return `${scores[0]} \u2014 ${POOP_LABELS[scores[0]] ?? ""}`
  }
  const first = scores[0]
  const last = scores[scores.length - 1]
  return `${first}\u2013${last} \u00b7 ${POOP_LABELS[first] ?? ""} to ${POOP_LABELS[last] ?? ""}`
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

/** Singularize "1 weeks" → "1 week", leave "2 weeks" as-is. */
function formatApproximateDuration(raw: string): string {
  return raw.replace(/^1\s+(\w+)s$/i, "1 $1")
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
    { label: "Poop", value: formatPoopQualityRange(sc.poopQuality) },
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

// ── Position category styling ──

const POSITION_LABELS: Record<PositionCategory, string> = {
  primary: "Primary",
  secondary: "Secondary",
  minor: "Minor",
  trace: "Trace",
}

// ── Extended correlation result type (includes ingredient-product map from API) ──

interface ExtendedCorrelationResult extends CorrelationResult {
  ingredientProducts?: Record<string, IngredientProductEntry[]>
}

// ── Ingredient analysis components ──

function isSuspect(score: IngredientScore): boolean {
  return score.weightedPoopScore != null && score.weightedPoopScore >= 4.5
}

/** Left border color based on score quality, not position. */
function scoreBorderColor(score: IngredientScore): string {
  const poop = score.weightedPoopScore
  if (poop == null) return "border-l-text-tertiary"
  if (poop >= 4.5) return "border-l-score-critical"
  if (poop >= 3.5) return "border-l-score-fair"
  return "border-l-score-excellent"
}

/** Human-readable display name for ingredient keys. */
const AMBIGUOUS_DISPLAY_NAMES: Record<string, { label: string; hint: string }> = {
  "poultry (ambiguous)": { label: "Unspecified poultry", hint: "Could be chicken, turkey, or duck" },
  "red_meat (ambiguous)": { label: "Unspecified red meat", hint: "Could be beef, pork, lamb, bison, or venison" },
  "fish (ambiguous)": { label: "Unspecified fish", hint: "Could be salmon, whitefish, herring, etc." },
  "animal (ambiguous)": { label: "Unspecified animal protein", hint: "Species not declared — could be any animal" },
  "other (ambiguous)": { label: "Unspecified animal protein", hint: "Species not declared — could be any animal" },
  "mammal (ambiguous)": { label: "Unspecified mammal", hint: "Could be beef, pork, lamb, or other mammal" },
}

function displayIngredientKey(key: string): string {
  return AMBIGUOUS_DISPLAY_NAMES[key]?.label ?? key
}

function ambiguousHint(key: string): string | null {
  return AMBIGUOUS_DISPLAY_NAMES[key]?.hint ?? null
}

function IngredientRow({
  score,
  ingredientProducts,
}: {
  score: IngredientScore
  ingredientProducts?: IngredientProductEntry[]
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const suspect = isSuspect(score)
  const trigger = COMMON_TRIGGERS.find((t) => score.key === t.family || score.key.startsWith(t.family + " "))

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={`flex w-full items-center gap-2 border-l-[3px] px-3 py-2.5 text-left transition-colors hover:bg-item-hover ${scoreBorderColor(score)}`}
      >
        <div className="flex flex-1 items-center gap-2 min-w-0 flex-wrap">
          <span className="text-sm font-medium text-foreground capitalize">
            {displayIngredientKey(score.key)}
          </span>
          {ambiguousHint(score.key) ? (
            <span className="text-[11px] text-text-tertiary">
              · {ambiguousHint(score.key)}
            </span>
          ) : score.positionCategory !== "primary" ? (
            <span className="text-[11px] text-text-tertiary">
              · {POSITION_LABELS[score.positionCategory]}
            </span>
          ) : null}
          {score.appearedInTreats && (
            <span className="text-[10px] text-muted-foreground">(treat)</span>
          )}
          {score.crossReactivityGroup && (
            <Badge variant="outline" className="text-score-fair text-[10px] py-0">
              {score.crossReactivityGroup}
            </Badge>
          )}
          {score.crossReactivityWarning && !score.crossReactivityGroup && (
            <Badge variant="outline" className="text-score-fair text-[10px] py-0">
              Warning
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums">
            {score.dayCount}d
          </span>
          {score.weightedPoopScore != null && (
            <span className={`text-sm font-bold tabular-nums ${poopScoreColor(score.weightedPoopScore)}`}>
              {score.weightedPoopScore.toFixed(1)}
            </span>
          )}
          {score.weightedItchScore != null && (
            <span className={`text-sm font-bold tabular-nums ${itchScoreColor(score.weightedItchScore)}`}>
              {score.weightedItchScore.toFixed(1)}
              <span className="text-[10px] font-normal text-muted-foreground ml-0.5">itch</span>
            </span>
          )}
          {score.weightedPoopScore == null && score.weightedItchScore == null && (
            <span className="text-xs text-muted-foreground">—</span>
          )}
          <ChevronRight className={`size-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
        </div>
      </button>
      {expanded && (
        <div className="border-l-[3px] border-l-transparent bg-muted-subtle px-4 py-2.5 space-y-2">
          {score.crossReactivityWarning && (
            <p className="text-xs text-score-fair">
              {score.crossReactivityWarning}
            </p>
          )}
          {score.crossReactivityGroup && (
            <p className="text-xs text-score-fair">
              Part of the {score.crossReactivityGroup} cross-reactivity group — multiple proteins in this group show elevated scores
            </p>
          )}
          {trigger && suspect && (
            <p className="text-xs text-muted-foreground">
              {capitalize(trigger.family)} is the #{COMMON_TRIGGERS.indexOf(trigger) + 1} most common food sensitivity in dogs ({trigger.percentage}% of cases)
              {trigger.note ? ` — ${trigger.note.toLowerCase()}` : ""}
            </p>
          )}
          {ingredientProducts && ingredientProducts.length > 0 && (
            <div>
              <p className="text-[11px] text-text-tertiary font-medium mb-1">Found in:</p>
              <div className="space-y-0.5">
                {ingredientProducts.map((entry) => (
                  <p key={entry.productId} className="text-xs text-muted-foreground">
                    {entry.brandName} {entry.productName}{" "}
                    <span className="text-text-tertiary">
                      (#{entry.position} — {POSITION_LABELS[entry.positionCategory].toLowerCase()})
                    </span>
                  </p>
                ))}
              </div>
            </div>
          )}
          {score.vomitCount > 0 && (
            <p className="text-xs text-score-critical">
              {score.vomitCount} vomit {score.vomitCount === 1 ? "event" : "events"} during exposure
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 text-[11px] text-text-tertiary">
            <span>{score.badDayCount} bad / {score.goodDayCount} good days</span>
            {score.daysWithBackfill > 0 && <span>{score.daysWithBackfill}d backfill</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function sortByWeightedPoop(scores: IngredientScore[]): IngredientScore[] {
  return [...scores].sort((a, b) => {
    if (a.weightedPoopScore == null && b.weightedPoopScore == null) return 0
    if (a.weightedPoopScore == null) return 1
    if (b.weightedPoopScore == null) return -1
    return b.weightedPoopScore - a.weightedPoopScore
  })
}

// ── Product ingredient list (expandable per food card) ──

/** Classified ingredient from DB (position is 1-indexed from the raw string). */
interface ClassifiedIngredient {
  position: number
  normalizedName: string
  family: string | null
  sourceGroup: string | null
  formType: string | null
  isHydrolyzed: boolean
}

interface ProductIngredientListData {
  /** All ingredients from the raw string, split in order. */
  allIngredients: string[]
  /** Classified ingredients from DB, keyed by 1-indexed position. */
  classifiedByPosition: Map<number, ClassifiedIngredient>
  saltPosition: number | null
}

/**
 * Find the correlation score matching a classified ingredient.
 * Handles both family-based keys (chicken, chicken (fat)) and
 * ambiguous keys (fish (ambiguous), poultry (ambiguous)).
 */
function findScoreForIngredient(
  classified: ClassifiedIngredient | undefined,
  correlationScores: IngredientScore[],
): IngredientScore | null {
  if (!classified) return null

  // Try family-based match first
  if (classified.family) {
    const match = correlationScores.find((s) => {
      if (s.key === classified.family) return true
      if (classified.isHydrolyzed && s.key === `${classified.family} (hydrolyzed)`) return true
      if (classified.formType === "fat" && s.key === `${classified.family} (fat)`) return true
      if (classified.formType === "oil" && s.key === `${classified.family} (oil)`) return true
      return false
    })
    if (match) return match
  }

  // Try ambiguous match: sourceGroup (ambiguous)
  if (!classified.family && classified.sourceGroup) {
    const ambiguousKey = `${classified.sourceGroup} (ambiguous)`
    const match = correlationScores.find((s) => s.key === ambiguousKey)
    if (match) return match
  }

  return null
}

function ProductIngredientList({
  productId,
  correlationScores,
}: {
  productId: string
  correlationScores: IngredientScore[]
}): React.ReactElement {
  const [data, setData] = useState<ProductIngredientListData | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const fetchIngredients = useCallback(async () => {
    if (data) return
    setLoading(true)
    try {
      const res = await fetch(`/api/products/${productId}`)
      if (res.ok) {
        const result = await res.json()
        const rawString: string = result.rawIngredientString ?? ""
        const allIngredients = splitIngredients(rawString)

        // Build lookup from position → classified ingredient
        const classifiedByPosition = new Map<number, ClassifiedIngredient>()
        for (const ing of (result.ingredients ?? []) as ClassifiedIngredient[]) {
          classifiedByPosition.set(ing.position, ing)
        }

        setData({
          allIngredients,
          classifiedByPosition,
          saltPosition: result.saltPosition ?? null,
        })
      }
    } finally {
      setLoading(false)
    }
  }, [productId, data])

  function handleToggle(): void {
    if (!expanded) fetchIngredients()
    setExpanded(!expanded)
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2"
      >
        <ChevronDown className={`size-3 transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`} />
        {expanded ? "Hide" : "View"} ingredients
      </button>
      {expanded && (
        <div className="mt-2">
          {loading && (
            <div className="space-y-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-4 w-48 animate-pulse rounded bg-muted" />
              ))}
            </div>
          )}
          {data && (() => {
            const aboveSalt = data.saltPosition != null
              ? data.allIngredients.slice(0, data.saltPosition)
              : data.allIngredients
            const belowSalt = data.saltPosition != null
              ? data.allIngredients.slice(data.saltPosition)
              : []

            return (
              <div className="space-y-1">
                <ol className="space-y-0.5">
                  {aboveSalt.map((rawName, idx) => {
                    const position = idx + 1
                    const classified = data.classifiedByPosition.get(position)
                    const matchedScore = findScoreForIngredient(classified, correlationScores)
                    const isBad = matchedScore?.weightedPoopScore != null && matchedScore.weightedPoopScore >= 4.5

                    return (
                      <li key={position}>
                        <div className="flex items-baseline gap-1.5 text-xs text-foreground">
                          <span className="tabular-nums text-text-tertiary w-5 text-right shrink-0">{position}.</span>
                          <span className={isBad ? "font-medium text-score-critical" : ""}>
                            {rawName}
                          </span>
                          {matchedScore?.weightedPoopScore != null && (
                            <span className={`inline-block size-1.5 rounded-full ${poopScoreColor(matchedScore.weightedPoopScore).replace("text-", "bg-")}`} />
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
                {belowSalt.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 my-1.5">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-[10px] text-text-tertiary">Below 1%</span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                    <p className="text-[10px] leading-snug text-text-tertiary">
                      {belowSalt.join(", ")}
                    </p>
                  </>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

function IngredientAnalysisSection({
  correlation,
  loading,
}: {
  correlation: ExtendedCorrelationResult | null
  loading: boolean
}): React.ReactElement {
  const [fatsExpanded, setFatsExpanded] = useState(false)

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-3 w-56 animate-pulse rounded bg-muted" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
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
              Keep logging — patterns emerge after a few days of data.
            </p>
            <p className="text-xs text-muted-foreground">
              Log daily check-ins with poop or itch scores to unlock ingredient analysis.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Split into allergenically relevant vs fats/oils
  const allergenScores = sortByWeightedPoop(
    correlation.scores.filter((s) => s.isAllergenicallyRelevant),
  )
  const fatOilScores = sortByWeightedPoop(
    correlation.scores.filter((s) => !s.isAllergenicallyRelevant),
  )

  // Low-variance detection on allergen scores
  const poopScores = allergenScores
    .map((s) => s.weightedPoopScore)
    .filter((v): v is number => v != null)
  const isLowVariance =
    poopScores.length >= 2 &&
    Math.max(...poopScores) - Math.min(...poopScores) < 0.5

  // Check if all scores have insufficient confidence (<5 effective days)
  const allInsufficient = correlation.scores.every(
    (s) => s.confidence === "insufficient",
  )

  // Find scored common triggers present in user's data
  const triggersInData = COMMON_TRIGGERS.filter((t) =>
    allergenScores.some((s) => s.key === t.family || s.key.startsWith(t.family + " ")),
  )

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

      {/* Common triggers reference — at the top */}
      <div className="rounded-lg bg-muted px-3 py-2.5">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Common triggers in dogs:</span>{" "}
          {COMMON_TRIGGERS.map((t, i) => (
            <span key={t.family}>
              {i > 0 && ", "}
              <span className={
                triggersInData.some((ti) => ti.family === t.family) &&
                allergenScores.some(
                  (s) => (s.key === t.family || s.key.startsWith(t.family + " ")) && isSuspect(s),
                )
                  ? "font-medium text-score-critical"
                  : ""
              }>
                {t.family} ({t.percentage}%)
              </span>
            </span>
          ))}
          <span className="text-text-tertiary"> — Mueller et al. 2016</span>
        </p>
      </div>

      {allInsufficient && (
        <div className="flex items-start gap-2 rounded-lg bg-score-fair-bg px-3 py-2">
          <Info className="size-4 shrink-0 text-score-fair mt-0.5" />
          <p className="text-xs text-score-fair">
            Just getting started — keep logging to see patterns
          </p>
        </div>
      )}

      {isLowVariance && !allInsufficient && (
        <div className="flex items-start gap-2 rounded-lg bg-score-fair-bg px-3 py-2">
          <Info className="size-4 shrink-0 text-score-fair mt-0.5" />
          <p className="text-xs text-score-fair">
            All ingredients show similar scores — likely a stable single-diet period.
          </p>
        </div>
      )}

      {/* Allergenically relevant ingredients — single card, compact rows */}
      <Card className="overflow-hidden py-0 gap-0">
        <div className="divide-y divide-border">
          {allergenScores.map((score) => (
            <IngredientRow
              key={score.key}
              score={score}
              ingredientProducts={correlation.ingredientProducts?.[score.key]}
            />
          ))}
        </div>
      </Card>

      {/* Fats & oils — collapsed by default */}
      {fatOilScores.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setFatsExpanded(!fatsExpanded)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={`size-3.5 transition-transform ${fatsExpanded ? "rotate-0" : "-rotate-90"}`}
            />
            Fats & oils ({fatOilScores.length})
            <span className="text-text-tertiary ml-1">— not allergenic</span>
          </button>
          {fatsExpanded && (
            <Card className="mt-2 overflow-hidden py-0 gap-0">
              <div className="divide-y divide-border">
                {fatOilScores.map((score) => (
                  <IngredientRow
                    key={score.key}
                    score={score}
                    ingredientProducts={correlation.ingredientProducts?.[score.key]}
                  />
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
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
  const [correlation, setCorrelation] = useState<ExtendedCorrelationResult | null>(null)
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
        const result: ExtendedCorrelationResult = await res.json()
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

      {/* All food cards in one container so they flow together */}
      {hasContent && (
        <div className="flex flex-wrap gap-3">
          {/* Active plan cards */}
          {data?.active?.items.map((item) => (
            <FoodScoreCard
              key={item.id}
              brandName={item.brandName}
              productName={item.productName}
              imageUrl={item.imageUrl}
              quantity={item.quantity}
              quantityUnit={item.quantityUnit}
              className="basis-72 border-dashed"
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
                <ProductIngredientList
                  productId={item.productId}
                  correlationScores={correlation?.scores ?? []}
                />
              </div>
            </FoodScoreCard>
          ))}

          {/* Needs scoring cards */}
          {data?.needsScoring.flatMap((group) =>
            group.items.map((item) => (
              <FoodScoreCard
                key={item.id}
                brandName={item.brandName}
                productName={item.productName}
                imageUrl={item.imageUrl}
                quantity={item.quantity}
                quantityUnit={item.quantityUnit}
                className="basis-72"
              >
                <div className="space-y-3">
                  {group.logStats && (
                    <LogStatsDisplay stats={group.logStats} />
                  )}
                  <p className="text-xs text-muted-foreground">
                    {group.isBackfill && group.approximateDuration
                      ? `~${group.approximateDuration} · Backfill`
                      : formatDateRange(group.startDate, group.endDate)}
                  </p>
                  <ProductIngredientList
                    productId={item.productId}
                    correlationScores={correlation?.scores ?? []}
                  />
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

          {/* Scored cards */}
          {data?.scored.flatMap((group) =>
            group.items.map((item) => (
              <FoodScoreCard
                key={item.id}
                brandName={item.brandName}
                productName={item.productName}
                imageUrl={item.imageUrl}
                quantity={item.quantity}
                quantityUnit={item.quantityUnit}
                className="basis-72"
              >
                <div className="space-y-3">
                  {group.logStats && (
                    <LogStatsDisplay stats={group.logStats} />
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {group.isBackfill && group.approximateDuration
                        ? `~${formatApproximateDuration(group.approximateDuration)} · Backfill`
                        : formatDateRange(group.startDate, group.endDate)}
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
                  <ProductIngredientList
                    productId={item.productId}
                    correlationScores={correlation?.scores ?? []}
                  />
                </div>
              </FoodScoreCard>
            )),
          )}
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
            hideSkip
          />
        )}
      </ResponsiveModal>
    </div>
  )
}
