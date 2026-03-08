"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { ChevronDown, ExternalLink, Info } from "lucide-react"
import { COMMON_SKIN_TRIGGERS } from "@/lib/ingredients"
import { cn } from "@/lib/utils"
import { IngredientRow, isSuspectItch, type SignalMode } from "@/components/ingredient-row"
import type { CorrelationResult, IngredientScore, IngredientProductEntry } from "@/lib/correlation/types"

export interface ExtendedCorrelationResult extends CorrelationResult {
  ingredientProducts?: Record<string, IngredientProductEntry[]>
  giIngredientProducts?: Record<string, IngredientProductEntry[]>
}

/** Sort by selected signal score, descending. */
export function sortBySignal(scores: IngredientScore[], mode: SignalMode): IngredientScore[] {
  const sortKey = (s: IngredientScore): number | null => {
    const p = s.weightedPoopScore
    const i = s.weightedItchScore
    if (mode === "stool") return p
    if (mode === "itch") return i
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

export function IngredientAnalysisSection({
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

  const activeScores = signalMode === "stool"
    ? correlation.giMergedScores
    : correlation.scores
  const activeIngredientProducts = signalMode === "stool"
    ? correlation.giIngredientProducts
    : correlation.ingredientProducts

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

  const poopScores = allergenScores
    .map((s) => s.weightedPoopScore)
    .filter((v): v is number => v != null)
  const isLowVariance =
    poopScores.length >= 2 &&
    Math.max(...poopScores) - Math.min(...poopScores) < 0.5

  const allInsufficient = correlation.scores.every(
    (s) => s.confidence === "insufficient",
  )

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
