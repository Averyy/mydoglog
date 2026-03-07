"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
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
import { FoodScoreCard } from "@/components/food-score-card"
import { ScoreGrid, poopScoreColor, itchScoreColor } from "@/components/score-grid"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ProductPicker } from "@/components/product-picker"
import { ResponsiveModal } from "@/components/responsive-modal"
import {
  FoodScorecardForm,
  type ScorecardData,
} from "@/components/food-scorecard-form"
import { DateRangePicker } from "@/components/date-range-picker"
import { differenceInDays, eachDayOfInterval, format, parseISO } from "date-fns"
import { toast } from "sonner"
import { ChevronDown, ChevronRight, ExternalLink, Info, Pencil, Plus } from "lucide-react"
import type { FeedingPlanGroup, ProductSummary } from "@/lib/types"
import type { CorrelationResult, IngredientScore, PositionCategory, IngredientProductEntry } from "@/lib/correlation/types"
import { COMMON_SKIN_TRIGGERS } from "@/lib/ingredients"
import { PRODUCT_TYPE_LABELS, SUPPLEMENT_PRODUCT_TYPES, QUANTITY_UNIT_OPTIONS } from "@/lib/labels"
import { getAvailableUnits } from "@/lib/nutrition"
import { cn } from "@/lib/utils"

function formatDateRange(startDate: string, endDate: string | null): string {
  const start = format(parseISO(startDate), "MMM d, yyyy")
  if (!endDate) return `Since ${start}`
  return `${start} - ${format(parseISO(endDate), "MMM d, yyyy")}`
}

function daysInRange(startDate: string, endDate: string | null): number {
  const today = new Date().toISOString().split("T")[0]
  return differenceInDays(parseISO(endDate ?? today), parseISO(startDate)) + 1
}

/** Compute avg from scorecard range array (e.g. poopQuality [2,4] → 3.0) */
function avgFromRange(scores: number[] | null): number | null {
  if (!scores || scores.length === 0) return null
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10
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
  giIngredientProducts?: Record<string, IngredientProductEntry[]>
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
  // Round to match the score color thresholds used in ScoreGrid
  const roundedPoop = poop != null ? Math.round(poop) : null
  const roundedItch = itch != null ? Math.round(itch) : null
  const isCritical =
    (roundedPoop != null && roundedPoop >= 5) || (roundedItch != null && roundedItch >= 4)
  const isFair =
    (roundedPoop != null && roundedPoop >= 4) || (roundedItch != null && roundedItch >= 3)
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
  "animal (ambiguous)": { label: "Unspecified animal protein", hint: "Species not declared — typically beef, pork, or chicken" },
  "mammal (ambiguous)": { label: "Unspecified mammal", hint: "Could be beef, pork, lamb, or other mammal" },
}

function displayIngredientKey(key: string): string {
  return AMBIGUOUS_DISPLAY_NAMES[key]?.label ?? key.replaceAll("_", " ")
}

function ambiguousHint(key: string): string | null {
  return AMBIGUOUS_DISPLAY_NAMES[key]?.hint ?? null
}

function IngredientRow({
  score,
  ingredientProducts,
  totalDistinctProducts,
  signalMode = "both",
}: {
  score: IngredientScore
  ingredientProducts?: IngredientProductEntry[]
  totalDistinctProducts: number
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
          {score.distinctProductCount === 1 && totalDistinctProducts > 1 && (
            <Badge variant="outline" className="text-text-tertiary text-[10px] py-0">
              1 food
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
          {score.distinctProductCount === 1 && totalDistinctProducts > 1 && (
            <p className="text-xs text-muted-foreground">
              Only appeared in one food — score may reflect other ingredients in that food
            </p>
          )}
          {totalDistinctProducts > 2 && score.distinctProductCount / totalDistinctProducts >= 0.75 && (
            <p className="text-xs text-muted-foreground">
              Present in {score.distinctProductCount} of {totalDistinctProducts} foods — limited contrast for scoring
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
                {ingredientProducts.map((entry, idx) => (
                  <div key={`${entry.productId}-${entry.formKey ?? idx}`} className="text-xs text-muted-foreground">
                    <span>{entry.brandName} {entry.productName}</span>
                    {SUPPLEMENT_PRODUCT_TYPES.has(entry.productType) && (
                      <span className="text-text-tertiary"> · {PRODUCT_TYPE_LABELS[entry.productType] ?? entry.productType}</span>
                    )}{" "}
                    <span className="text-text-tertiary">
                      (#{entry.position + 1} — {entry.formKey ? `${entry.formKey.replace(/[()]/g, "")}, ` : ""}{POSITION_LABELS[entry.positionCategory].toLowerCase()})
                    </span>
                    {(entry.avgPoopScore != null || entry.avgItchScore != null || entry.digestiveImpact || entry.itchinessImpact) && (
                      <span className="text-text-tertiary">
                        {" · "}
                        {entry.avgPoopScore != null ? (
                          <span className={entry.avgPoopScore >= 5 ? "text-score-critical" : entry.avgPoopScore >= 4 ? "text-score-fair" : "text-score-good"}>
                            {entry.avgPoopScore} stool
                          </span>
                        ) : entry.digestiveImpact ? (
                          <span className={entry.digestiveImpact === "worse" ? "text-score-critical" : entry.digestiveImpact === "better" ? "text-score-good" : ""}>
                            stool: {entry.digestiveImpact.replace("_", " ")}
                          </span>
                        ) : null}
                        {(entry.avgPoopScore != null || entry.digestiveImpact) && (entry.avgItchScore != null || entry.itchinessImpact) && " · "}
                        {entry.avgItchScore != null ? (
                          <span className={entry.avgItchScore >= 4 ? "text-score-critical" : entry.avgItchScore >= 3 ? "text-score-fair" : "text-score-good"}>
                            {entry.avgItchScore} itch
                          </span>
                        ) : entry.itchinessImpact ? (
                          <span className={entry.itchinessImpact === "worse" ? "text-score-critical" : entry.itchinessImpact === "better" ? "text-score-good" : ""}>
                            itch: {entry.itchinessImpact.replace("_", " ")}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </div>
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
            <span>Stool: {score.badPoopDayCount} bad / {score.goodPoopDayCount} good</span>
            {(score.badItchDayCount > 0 || score.goodItchDayCount > 0) && (
              <span>Itch: {score.badItchDayCount} bad / {score.goodItchDayCount} good</span>
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
  if (!data) {
    return <></>
  }

  const aboveSalt = data.saltPosition != null
    ? data.allIngredients.slice(0, data.saltPosition)
    : data.allIngredients
  const belowSalt = data.saltPosition != null
    ? data.allIngredients.slice(data.saltPosition)
    : []

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2"
        >
          View ingredients
          <ChevronDown className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 max-h-80 overflow-y-auto p-3" align="start">
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
      </PopoverContent>
    </Popover>
  )
}

function IngredientAnalysisSection({
  correlation,
  loading,
}: {
  correlation: ExtendedCorrelationResult | null
  loading: boolean
}): React.ReactElement {
  const [fatsExpanded, setFatsExpanded] = useState(true)
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

  // In stool mode, use GI-merged scores (all forms combined, all GI-relevant)
  const activeScores = signalMode === "stool"
    ? correlation.giMergedScores
    : correlation.scores
  const activeIngredientProducts = signalMode === "stool"
    ? correlation.giIngredientProducts
    : correlation.ingredientProducts

  // Split into allergenically relevant vs fats/oils (no fats section in stool mode)
  const allergenScores = sortBySignal(
    activeScores.filter((s) => s.isAllergenicallyRelevant
      && !(signalMode === "stool" && s.positionCategory === "trace")),
    signalMode,
  )
  const fatOilScores = signalMode === "stool"
    ? []
    : sortBySignal(
        activeScores.filter((s) => !s.isAllergenicallyRelevant),
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
                "px-3.5 py-1.5 text-xs font-medium transition-colors",
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

      {signalMode === "stool" ? (
        <div className="rounded-lg bg-muted px-3 py-2.5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Ingredient forms (e.g. chicken, chicken fat, chicken oil) are merged. Hydrolyzed proteins are separated. Trace ingredients are hidden.
          </p>
        </div>
      ) : (
        <div className="rounded-lg bg-muted px-3 py-2.5">
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
            {" "}
            <a
              href="https://bmcvetres.biomedcentral.com/articles/10.1186/s12917-016-0633-8"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-text-tertiary hover:text-foreground transition-colors align-text-bottom"
            >
              <ExternalLink className="size-3" />
            </a>
          </p>
        </div>
      )}

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
              ingredientProducts={activeIngredientProducts?.[score.key]}
              totalDistinctProducts={correlation.totalDistinctProducts}
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
            <span className="text-text-tertiary ml-1">— not allergenic, but can affect digestion</span>
          </button>
          {fatsExpanded && (
            <Card className="mt-2 overflow-hidden py-0 gap-0">
              <div className="divide-y divide-border">
                {fatOilScores.map((score) => (
                  <IngredientRow
                    key={score.key}
                    score={score}
                    ingredientProducts={activeIngredientProducts?.[score.key]}
                    totalDistinctProducts={correlation.totalDistinctProducts}
                    signalMode={signalMode}
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
}

// ── Backfill modal steps ──

type BackfillStep = "product" | "scorecard"

interface BackfillProduct {
  product: ProductSummary
  startDate: string
  endDate: string
  quantity: string
  quantityUnit: string
}

// ── Page ──

export default function FoodScorecardPage() {
  const params = useParams<{ id: string }>()
  const dogId = params.id
  const { setActiveDogId } = useActiveDog()

  useEffect(() => { setActiveDogId(dogId) }, [dogId, setActiveDogId])

  const [data, setData] = useState<ScorecardPageData | null>(null)
  const [loading, setLoading] = useState(true)

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
      giIngredientProducts: data.giIngredientProducts,
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
      quantity: item.quantity ?? "1",
      quantityUnit: item.quantityUnit ?? (getAvailableUnits(null, item.type)?.[0]?.value ?? "cup"),
    })
    setBackfillStep("product")
    setBackfillOpen(true)
  }

  function handleBackfillProductSelected(product: ProductSummary | null): void {
    if (!product) return
    const units = getAvailableUnits(product.calorieContent ?? null, product.type)
    const defaultUnit = units?.[0]?.value ?? "cup"
    setBackfillProduct((prev) => ({
      product,
      startDate: prev?.startDate ?? "",
      endDate: prev?.endDate ?? "",
      quantity: prev?.quantity ?? "1",
      quantityUnit: prev?.product?.id === product.id ? (prev?.quantityUnit ?? defaultUnit) : defaultUnit,
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
            items: [{
              productId: backfillProduct.product.id,
              quantity: backfillProduct.quantity || "1",
              quantityUnit: backfillProduct.quantityUnit,
            }],
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
          quantity: backfillProduct.quantity || "1",
          quantityUnit: backfillProduct.quantityUnit,
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

  const NON_FOOD_TYPES = new Set(["treat", "supplement", "probiotic", "topper"])

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

  const activeLogOverlap = useMemo((): boolean => {
    if (!backfillProduct?.startDate || !backfillProduct?.endDate) return false
    if (!data) return false
    const s = backfillProduct.startDate
    const e = backfillProduct.endDate
    const allGroups = [...data.past]
    if (data.active) allGroups.push(data.active)
    return allGroups.some((g) => {
      if (g.isBackfill) return false
      const pEnd = g.endDate ?? "9999-12-31"
      return s <= pEnd && g.startDate <= e
    })
  }, [backfillProduct?.startDate, backfillProduct?.endDate, data])

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

  const hasContent = data && (data.active || data.past.length > 0)

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
                  <ScoreGrid
                    avgStool={avgStool}
                    avgItch={avgItch}
                    days={days}
                  />
                </div>
                <div className="pt-3">
                  <ProductIngredientList
                    data={productIngredientDataMap.get(item.productId)}
                    correlationScores={correlation?.scores ?? []}
                  />
                </div>
              </FoodScoreCard>
            )
          })}

          {/* Past food cards — sorted by end date descending (most recent first) */}
          {data && [...data.past]
            .sort((a, b) => (b.endDate ?? "9999-12-31").localeCompare(a.endDate ?? "9999-12-31"))
            .flatMap((group) =>
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
                      <ScoreGrid
                        avgStool={avgStool}
                        avgItch={avgItch}
                        days={days}
                      />
                    </div>
                    <div className="pt-3 flex items-center justify-between gap-2">
                      <ProductIngredientList
                        data={productIngredientDataMap.get(item.productId)}
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

      {/* Ingredient analysis */}
      <IngredientAnalysisSection
        correlation={correlation}
        loading={loading}
      />

      {/* Backfill modal */}
      <ResponsiveModal
        open={backfillOpen}
        onOpenChange={setBackfillOpen}
        title={backfillStep === "product"
          ? (editingGroup ? "Edit feeding period" : "Add past food")
          : "Rate this food"}
        description={backfillStep === "product"
          ? (editingGroup ? "Update the food or date range." : "Add a food your dog has eaten before.")
          : "How did this work out?"}
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
                dogId={dogId}
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
                  {backfillOverlap && (
                    <p className="flex items-center gap-1.5 text-sm text-score-fair">
                      <Info className="size-4 shrink-0" />
                      Overlaps with {backfillOverlap}
                    </p>
                  )}
                  {activeLogOverlap && (
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Info className="size-4 shrink-0" />
                      Overlapping days with your logging period will use daily logs instead of this scorecard
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-medium uppercase tracking-[0.05em] text-muted-foreground">
                    Daily amount
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      step="0.25"
                      min="0"
                      placeholder="Qty"
                      value={backfillProduct.quantity}
                      onChange={(e) =>
                        setBackfillProduct({ ...backfillProduct, quantity: e.target.value })
                      }
                      className="h-9 w-20"
                    />
                    <Select
                      value={backfillProduct.quantityUnit}
                      onValueChange={(v) =>
                        setBackfillProduct({ ...backfillProduct, quantityUnit: v })
                      }
                    >
                      <SelectTrigger size="sm" className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(getAvailableUnits(backfillProduct.product.calorieContent ?? null, backfillProduct.product.type) ??
                          QUANTITY_UNIT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))
                        ).map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="self-center text-xs text-muted-foreground">/day</span>
                  </div>
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
            initialData={editingGroup?.scorecard ?? undefined}
          />
        )}
      </ResponsiveModal>
    </div>
  )
}
