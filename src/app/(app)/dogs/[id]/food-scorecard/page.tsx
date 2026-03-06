"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useParams } from "next/navigation"
import { useActiveDog } from "@/components/active-dog-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { FoodScoreCard } from "@/components/food-score-card"
import { ProductPicker } from "@/components/product-picker"
import { ResponsiveModal } from "@/components/responsive-modal"
import {
  FoodScorecardForm,
  type ScorecardData,
  type ScorecardFormMode,
} from "@/components/food-scorecard-form"
import { DateRangePicker } from "@/components/date-range-picker"
import { durationFromRange } from "@/lib/feeding"
import { eachDayOfInterval, format, parseISO } from "date-fns"
import { toast } from "sonner"
import { ChevronDown, ChevronRight, Info, Pencil, Plus, Star } from "lucide-react"
import type { FeedingPlanGroup, LogStats, ProductSummary, ScorecardSummary } from "@/lib/types"
import type { CorrelationResult, IngredientScore, PositionCategory, IngredientProductEntry } from "@/lib/correlation/types"
import { COMMON_SKIN_TRIGGERS } from "@/lib/ingredients"
import { cn } from "@/lib/utils"

// ── Label maps for scorecard display ──

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

const ITCH_LABELS: Record<number, string> = {
  0: "None", 1: "Very mild", 2: "Mild", 3: "Moderate",
  4: "Severe", 5: "Extreme",
}

function formatItchSeverityRange(scores: number[] | null): string | null {
  if (!scores || scores.length === 0) return null
  if (scores.length === 1) {
    return `${scores[0]} \u2014 ${ITCH_LABELS[scores[0]] ?? ""}`
  }
  const first = scores[0]
  const last = scores[scores.length - 1]
  return `${first}\u2013${last} \u00b7 ${ITCH_LABELS[first] ?? ""} to ${ITCH_LABELS[last] ?? ""}`
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
    { label: "Itch", value: formatItchSeverityRange(sc.itchSeverity) },
    { label: "Vomiting", value: sc.vomiting ? VOMITING_LABELS[sc.vomiting] ?? sc.vomiting : null },
    { label: "Palatability", value: sc.palatability ? PALATABILITY_LABELS[sc.palatability] ?? sc.palatability : null },
    { label: "Digestive impact", value: sc.digestiveImpact ? ITCHINESS_IMPACT_LABELS[sc.digestiveImpact] ?? sc.digestiveImpact : null },
    { label: "Itch impact", value: sc.itchinessImpact ? ITCHINESS_IMPACT_LABELS[sc.itchinessImpact] ?? sc.itchinessImpact : null },
  ]

  const filledRows = rows.filter((r) => r.value !== null)

  return (
    <div className="space-y-2">
      {sc.verdict && (
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
      )}
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

// ── Per-product ingredient data (inlined from API, no lazy fetch) ──

interface ProductIngredientListData {
  /** All ingredients from the raw string, split in order. */
  allIngredients: string[]
  /** Classified ingredients from DB, keyed by 1-indexed position. */
  classifiedByPosition: Map<number, ClassifiedIngredient>
  saltPosition: number | null
}

// ── Ingredient analysis components ──

function isSuspect(score: IngredientScore): boolean {
  return (
    (score.weightedPoopScore != null && score.weightedPoopScore >= 4.5) ||
    (score.weightedItchScore != null && score.weightedItchScore >= 4.0)
  )
}

function isSuspectItch(score: IngredientScore): boolean {
  return score.weightedItchScore != null && score.weightedItchScore >= 4.0
}

/** Good scores with insufficient data — bad signals need no minimum, good signals need time. */
function needsMoreData(score: IngredientScore): boolean {
  const poopGood = score.weightedPoopScore != null && score.weightedPoopScore < 3.0
  const itchGood = score.weightedItchScore != null && score.weightedItchScore < 2.5
  if (!poopGood && !itchGood) return false
  // GI: need ~14 days, Skin: need ~56 days (8 weeks)
  if (poopGood && score.dayCount < 14) return true
  if (itchGood && score.dayCount < 56) return true
  return false
}

/** Left border color based on selected signal tracks. */
function scoreBorderColor(score: IngredientScore, mode: SignalMode = "both"): string {
  const poop = mode !== "itch" ? score.weightedPoopScore : null
  const itch = mode !== "stool" ? score.weightedItchScore : null
  const isCritical =
    (poop != null && poop >= 4.5) || (itch != null && itch >= 4.0)
  const isFair =
    (poop != null && poop >= 3.5) || (itch != null && itch >= 3.0)
  if (isCritical) return "border-l-score-critical"
  if (isFair) return "border-l-score-fair"
  if (poop == null && itch == null) return "border-l-text-tertiary"
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
  signalMode = "both",
}: {
  score: IngredientScore
  ingredientProducts?: IngredientProductEntry[]
  signalMode?: SignalMode
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const suspectItch = isSuspectItch(score)
  const trigger = COMMON_SKIN_TRIGGERS.find((t) => score.key === t.family || score.key.startsWith(t.family + " "))

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={`flex w-full items-center gap-2 border-l-[3px] px-3 py-2.5 text-left transition-colors hover:bg-item-hover ${scoreBorderColor(score, signalMode)}`}
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
          {signalMode !== "itch" && (
            <span className={`w-[50px] text-right text-sm tabular-nums ${score.weightedPoopScore != null ? `font-bold ${poopScoreColor(score.weightedPoopScore)}` : "text-muted-foreground"}`}>
              {score.weightedPoopScore != null ? score.weightedPoopScore.toFixed(1) : "—"}
              <span className="text-[10px] font-normal text-muted-foreground ml-0.5">stool</span>
            </span>
          )}
          {signalMode !== "stool" && (
            <span className={`w-[50px] text-right text-sm tabular-nums ${score.weightedItchScore != null ? `font-bold ${itchScoreColor(score.weightedItchScore)}` : "text-muted-foreground"}`}>
              {score.weightedItchScore != null ? score.weightedItchScore.toFixed(1) : "—"}
              <span className="text-[10px] font-normal text-muted-foreground ml-0.5">itch</span>
            </span>
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
          {score.isSplit && (
            <p className="text-xs text-score-fair">
              This ingredient appears split across 3+ positions in some products, suggesting higher total content than any single position implies
            </p>
          )}
          {trigger && suspectItch && (
            <p className="text-xs text-muted-foreground">
              {capitalize(trigger.family)} is the #{COMMON_SKIN_TRIGGERS.indexOf(trigger) + 1} most common skin allergen in dogs ({trigger.percentage}% of cases)
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
            <span>GI: {score.badPoopDayCount} bad / {score.goodPoopDayCount} good</span>
            {(score.badItchDayCount > 0 || score.goodItchDayCount > 0) && (
              <span>Skin: {score.badItchDayCount} bad / {score.goodItchDayCount} good</span>
            )}
            {score.daysWithBackfill > 0 && <span>{score.daysWithBackfill}d backfill</span>}
          </div>
          {needsMoreData(score) && (
            <p className="text-[11px] text-score-fair">
              Looks OK so far — keep logging to confirm ({score.dayCount < 14 ? "need 2+ weeks for GI" : "need 8+ weeks for skin"})
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

type SignalMode = "both" | "stool" | "itch"

/** Sort by selected signal score, descending. */
function sortBySignal(scores: IngredientScore[], mode: SignalMode): IngredientScore[] {
  const sortKey = (s: IngredientScore): number | null => {
    const p = s.weightedPoopScore
    const i = s.weightedItchScore
    if (mode === "stool") return p
    if (mode === "itch") return i
    // both — use the worse
    if (p == null && i == null) return null
    if (p == null) return i
    if (i == null) return p
    return Math.max(p, i)
  }
  return [...scores].sort((a, b) => {
    const wa = sortKey(a)
    const wb = sortKey(b)
    if (wa == null && wb == null) return 0
    if (wa == null) return 1
    if (wb == null) return -1
    return wb - wa
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
  data,
  correlationScores,
}: {
  data: ProductIngredientListData | undefined
  correlationScores: IngredientScore[]
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false)

  if (!data) {
    return <></>
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2"
      >
        <ChevronDown className={`size-3 transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`} />
        {expanded ? "Hide" : "View"} ingredients
      </button>
      {expanded && (
        <div className="mt-2">
          {(() => {
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
                    const isBad = matchedScore != null && isSuspect(matchedScore)

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
  const [signalMode, setSignalMode] = useState<SignalMode>("both")

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
  const allergenScores = sortBySignal(
    correlation.scores.filter((s) => s.isAllergenicallyRelevant),
    signalMode,
  )
  const fatOilScores = sortBySignal(
    correlation.scores.filter((s) => !s.isAllergenicallyRelevant),
    signalMode,
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

  // Find scored common skin triggers present in user's data
  const triggersInData = COMMON_SKIN_TRIGGERS.filter((t) =>
    allergenScores.some((s) => s.key === t.family || s.key.startsWith(t.family + " ")),
  )

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-[0.05em] text-muted-foreground">
            Ingredient Analysis
          </h2>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            Last {correlation.totalDays} days · {correlation.scoreableDays} scoreable
          </p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
          {([
            { value: "both", label: "Both" },
            { value: "stool", label: "Stool" },
            { value: "itch", label: "Itch" },
          ] as const).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setSignalMode(value)}
              className={cn(
                "px-2.5 py-1 text-[11px] font-medium transition-colors",
                signalMode === value
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-item-hover text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Common triggers reference — hidden in stool-only mode */}
      {signalMode !== "stool" && <div className="rounded-lg bg-muted px-3 py-2.5">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Common skin allergens:</span>{" "}
          {COMMON_SKIN_TRIGGERS.map((t, i) => (
            <span key={t.family}>
              {i > 0 && ", "}
              <span className={
                triggersInData.some((ti) => ti.family === t.family) &&
                allergenScores.some(
                  (s) => (s.key === t.family || s.key.startsWith(t.family + " ")) && isSuspectItch(s),
                )
                  ? "font-medium text-score-critical"
                  : ""
              }>
                {t.family} ({t.percentage}%)
              </span>
            </span>
          ))}
          <span className="text-text-tertiary"> — Mueller et al. 2016 (skin only)</span>
        </p>
      </div>}

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
              signalMode={signalMode}
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
  correlation: CorrelationResult | null
  ingredientProducts: Record<string, IngredientProductEntry[]>
  productIngredients: Record<string, {
    allIngredients: string[]
    classifiedByPosition: { position: number; normalizedName: string; family: string | null; sourceGroup: string | null; formType: string | null; isHydrolyzed: boolean }[]
    saltPosition: number | null
  }>
}

// ── Backfill modal steps ──

type BackfillStep = "product" | "scorecard"

interface BackfillProduct {
  product: ProductSummary
  startDate: string
  endDate: string
}

// ── Page ──

export default function FoodScorecardPage() {
  const params = useParams<{ id: string }>()
  const dogId = params.id
  const { setActiveDogId } = useActiveDog()

  useEffect(() => { setActiveDogId(dogId) }, [dogId, setActiveDogId])

  const [data, setData] = useState<ScorecardPageData | null>(null)
  const [loading, setLoading] = useState(true)

  // Score existing plan modal
  const [scoreModalOpen, setScoreModalOpen] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<FeedingPlanGroup | null>(null)

  // Backfill modal
  const [backfillOpen, setBackfillOpen] = useState(false)
  const [backfillStep, setBackfillStep] = useState<BackfillStep>("product")
  const [backfillProduct, setBackfillProduct] = useState<BackfillProduct | null>(null)
  const [backfillSaving, setBackfillSaving] = useState(false)
  const [editingGroup, setEditingGroup] = useState<FeedingPlanGroup | null>(null)

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

  // Derive correlation from data
  const correlation: ExtendedCorrelationResult | null = useMemo(() => {
    if (!data?.correlation) return null
    return {
      ...data.correlation,
      ingredientProducts: data.ingredientProducts,
    }
  }, [data])

  // Build ProductIngredientListData maps from server data
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
    setEditingGroup(null)
    setBackfillProduct(null)
    setBackfillStep("product")
    setBackfillOpen(true)
  }

  function openEditBackfill(group: FeedingPlanGroup): void {
    const item = group.items[0]
    setEditingGroup(group)
    setBackfillProduct({
      product: {
        id: item.productId,
        name: item.productName,
        brandName: item.brandName,
        brandId: "",
        type: item.type,
        channel: null,
        lifestage: null,
        imageUrl: item.imageUrl,
        isDiscontinued: false,
        calorieContent: null,
      },
      startDate: group.startDate,
      endDate: group.endDate ?? "",
    })
    setBackfillStep("product")
    setBackfillOpen(true)
  }

  function handleBackfillProductSelected(product: ProductSummary | null): void {
    if (!product) return
    setBackfillProduct((prev) => ({
      product,
      startDate: prev?.startDate ?? "",
      endDate: prev?.endDate ?? "",
    }))
  }

  async function handleBackfillNext(): Promise<void> {
    if (!backfillProduct || !backfillProduct.startDate || !backfillProduct.endDate) {
      toast.error("Select a date range")
      return
    }

    if (editingGroup) {
      // Save product/dates first, then show scorecard
      const ok = await handleEditBackfillSave()
      if (ok) setBackfillStep("scorecard")
      return
    }

    setBackfillStep("scorecard")
  }

  async function handleBackfillSave(scorecardData: ScorecardData): Promise<void> {
    if (!backfillProduct) return
    setBackfillSaving(true)

    try {
      if (editingGroup) {
        // Editing: save scorecard via PUT
        const res = await fetch(
          `/api/feeding/groups/${editingGroup.planGroupId}/scorecard`,
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
      } else {
        // Creating: save everything via backfill POST
        const res = await fetch(`/api/dogs/${dogId}/feeding/backfill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [{ productId: backfillProduct.product.id }],
            startDate: backfillProduct.startDate,
            endDate: backfillProduct.endDate,
            scorecard: scorecardData,
          }),
        })
        if (!res.ok) {
          toast.error("Failed to save")
          return
        }
      }

      toast.success(editingGroup ? "Updated" : "Past food scored")
      setBackfillOpen(false)
      setBackfillProduct(null)
      setEditingGroup(null)
      fetchData()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setBackfillSaving(false)
    }
  }

  function handleBackfillSkip(): void {
    if (editingGroup) {
      // Already saved product/dates in handleBackfillNext, just close
      setBackfillOpen(false)
      setBackfillProduct(null)
      setEditingGroup(null)
      return
    }
    if (!backfillProduct) return
    handleBackfillSaveWithoutScorecard()
  }

  async function handleBackfillSaveWithoutScorecard(): Promise<void> {
    if (!backfillProduct || !backfillProduct.startDate || !backfillProduct.endDate) return
    setBackfillSaving(true)

    try {
      const res = await fetch(`/api/dogs/${dogId}/feeding/backfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: backfillProduct.product.id }],
          startDate: backfillProduct.startDate,
          endDate: backfillProduct.endDate,
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

  async function handleEditBackfillSave(): Promise<boolean> {
    if (!editingGroup || !backfillProduct || !backfillProduct.startDate || !backfillProduct.endDate) return false
    setBackfillSaving(true)

    try {
      const res = await fetch(`/api/feeding/groups/${editingGroup.planGroupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: backfillProduct.startDate,
          endDate: backfillProduct.endDate,
          productId: backfillProduct.product.id,
        }),
      })

      if (!res.ok) {
        toast.error("Failed to update")
        return false
      }

      fetchData()
      return true
    } catch {
      toast.error("Something went wrong")
      return false
    } finally {
      setBackfillSaving(false)
    }
  }

  // ── Calendar highlights for existing feeding periods ──

  const yesterday = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d
  }, [])

  const NON_FOOD_TYPES = new Set(["treat", "supplement", "probiotic"])
  const SUPPLEMENT_TYPES = new Set(["supplement", "probiotic"])

  function scorecardModeForGroup(group: FeedingPlanGroup | null): ScorecardFormMode {
    if (!group) return "food"
    return group.items.every((item) => SUPPLEMENT_TYPES.has(item.type ?? "")) ? "supplement" : "food"
  }

  const existingPeriods = useMemo(() => {
    if (!data) return []
    const groups = [...data.scored, ...data.needsScoring]
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const existingFoodDates = useMemo((): Date[] => {
    return existingPeriods.flatMap((p) => {
      const end = p.end ? parseISO(p.end) : new Date()
      return eachDayOfInterval({ start: parseISO(p.start), end })
    })
  }, [existingPeriods])

  const backfillOverlap = useMemo((): string | null => {
    if (!backfillProduct?.startDate || !backfillProduct?.endDate) return null
    if (NON_FOOD_TYPES.has(backfillProduct.product.type ?? "")) return null
    const s = backfillProduct.startDate
    const e = backfillProduct.endDate
    const match = existingPeriods.find((p) => {
      if (editingGroup && p.planGroupId === editingGroup.planGroupId) return false
      const pEnd = p.end ?? "9999-12-31"
      return s <= pEnd && p.start <= e
    })
    return match?.label ?? null
  }, [backfillProduct?.startDate, backfillProduct?.endDate, backfillProduct?.product.type, editingGroup, existingPeriods])

  const backfillDuration = useMemo(() => {
    if (!backfillProduct?.startDate || !backfillProduct?.endDate) return null
    return durationFromRange(backfillProduct.startDate, backfillProduct.endDate)
  }, [backfillProduct?.startDate, backfillProduct?.endDate])

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
                  data={productIngredientDataMap.get(item.productId)}
                  correlationScores={correlation?.scores ?? []}
                />
              </div>
            </FoodScoreCard>
          ))}

          {/* Past food cards — sorted by end date descending (most recent first) */}
          {data && [...data.needsScoring, ...data.scored]
            .sort((a, b) => (b.endDate ?? "9999-12-31").localeCompare(a.endDate ?? "9999-12-31"))
            .flatMap((group) =>
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
                  {group.scorecard ? (
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
                          onClick={() => group.isBackfill ? openEditBackfill(group) : openScorecard(group)}
                          className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline underline-offset-2"
                        >
                          <Pencil className="size-3" />
                          Edit
                        </button>
                      </div>
                      <Separator />
                      <ScorecardDetails sc={group.scorecard} />
                      <ProductIngredientList
                        data={productIngredientDataMap.get(item.productId)}
                        correlationScores={correlation?.scores ?? []}
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {group.logStats && (
                        <LogStatsDisplay stats={group.logStats} />
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          {formatDateRange(group.startDate, group.endDate)}
                          {group.isBackfill && " · Backfill"}
                        </p>
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
                      <ProductIngredientList
                        data={productIngredientDataMap.get(item.productId)}
                        correlationScores={correlation?.scores ?? []}
                      />
                      <Button
                        size="sm"
                        onClick={() => group.isBackfill ? openEditBackfill(group) : openScorecard(group)}
                        className="w-full"
                      >
                        <Star className="size-4" />
                        Rate this food
                      </Button>
                    </div>
                  )}
                </FoodScoreCard>
              )),
            )}
        </div>
      )}

      {/* Ingredient analysis */}
      <IngredientAnalysisSection
        correlation={correlation}
        loading={loading}
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
          skipLabel={selectedGroup?.scorecard ? "Cancel" : "Skip"}
          mode={scorecardModeForGroup(selectedGroup)}
        />
      </ResponsiveModal>

      {/* Backfill modal */}
      <ResponsiveModal
        open={backfillOpen}
        onOpenChange={setBackfillOpen}
        title={backfillStep === "product"
          ? (editingGroup ? "Edit feeding period" : "Add past food")
          : "Rate this food"}
        description={backfillStep === "product"
          ? (editingGroup ? "Update the food or date range." : "Add a food your dog has eaten before.")
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
                    When did you feed this?
                  </Label>
                  <DateRangePicker
                    from={backfillProduct.startDate}
                    to={backfillProduct.endDate}
                    onChange={(from, to) =>
                      setBackfillProduct({ ...backfillProduct, startDate: from, endDate: to })
                    }
                    disabled={{ after: yesterday }}
                    defaultMonth={editingGroup ? parseISO(editingGroup.startDate) : undefined}
                    placeholder="Select date range"
                    modifiers={{ hasFood: existingFoodDates }}
                    modifiersClassNames={{ hasFood: "day-has-food" }}
                  />
                  {backfillDuration && (
                    <p className="text-sm text-muted-foreground">{backfillDuration}</p>
                  )}
                  {backfillOverlap && (
                    <p className="flex items-center gap-1.5 text-sm text-score-fair">
                      <Info className="size-4 shrink-0" />
                      Overlaps with {backfillOverlap}
                    </p>
                  )}
                </div>

                <Button
                  onClick={handleBackfillNext}
                  disabled={!backfillProduct.startDate || !backfillProduct.endDate || backfillSaving}
                  className="mt-2 w-full"
                >
                  Next — {editingGroup ? "Edit scorecard" : "Rate this food"}
                </Button>
              </>
            )}
          </div>
        ) : (
          <FoodScorecardForm
            key={editingGroup?.planGroupId ?? "new"}
            onSave={handleBackfillSave}
            onSkip={handleBackfillSkip}
            initialData={editingGroup?.scorecard ?? undefined}
            hideSkip={!editingGroup}
            skipLabel="Cancel"
            mode="backfill"
          />
        )}
      </ResponsiveModal>
    </div>
  )
}
