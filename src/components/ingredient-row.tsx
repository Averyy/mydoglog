"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { ChevronRight } from "lucide-react"
import { poopScoreColor, itchScoreColor } from "@/components/score-grid"
import { COMMON_SKIN_TRIGGERS } from "@/lib/ingredients"
import { PRODUCT_TYPE_LABELS, NON_FOOD_TYPES } from "@/lib/labels"
import { POSITION_LABELS } from "@/lib/food-helpers"
import type { IngredientScore, IngredientProductEntry } from "@/lib/correlation/types"

export type SignalMode = "both" | "stool" | "itch"

export function isSuspect(score: IngredientScore): boolean {
  return (
    (score.weightedPoopScore != null && score.weightedPoopScore >= 4.5) ||
    (score.weightedItchScore != null && score.weightedItchScore >= 4.0)
  )
}

export function isSuspectItch(score: IngredientScore): boolean {
  return score.weightedItchScore != null && score.weightedItchScore >= 4.0
}

/** Good scores with insufficient data — bad signals need no minimum, good signals need time. */
export function needsMoreData(score: IngredientScore): boolean {
  const poopGood = score.weightedPoopScore != null && score.weightedPoopScore < 3.0
  const itchGood = score.weightedItchScore != null && score.weightedItchScore < 2.5
  if (!poopGood && !itchGood) return false
  if (poopGood && score.dayCount < 14) return true
  if (itchGood && score.dayCount < 56) return true
  return false
}

/** Left border color based on selected signal tracks. */
export function scoreBorderColor(score: IngredientScore, mode: SignalMode = "both"): string {
  const poop = mode !== "itch" ? score.weightedPoopScore : null
  const itch = mode !== "stool" ? score.weightedItchScore : null
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

export const AMBIGUOUS_DISPLAY_NAMES: Record<string, { label: string; hint: string }> = {
  "poultry (ambiguous)": { label: "Unspecified poultry", hint: "Could be chicken, turkey, or duck" },
  "red_meat (ambiguous)": { label: "Unspecified red meat", hint: "Could be beef, pork, lamb, bison, or venison" },
  "fish (ambiguous)": { label: "Unspecified fish", hint: "Could be salmon, whitefish, herring, etc." },
  "animal (ambiguous)": { label: "Unspecified animal protein", hint: "Species not declared — typically beef, pork, or chicken" },
  "mammal (ambiguous)": { label: "Unspecified mammal", hint: "Could be beef, pork, lamb, or other mammal" },
}

export function displayIngredientKey(key: string): string {
  return AMBIGUOUS_DISPLAY_NAMES[key]?.label ?? key.replaceAll("_", " ")
}

export function ambiguousHint(key: string): string | null {
  return AMBIGUOUS_DISPLAY_NAMES[key]?.hint ?? null
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function IngredientRow({
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
          {score.formBreakdown && score.formBreakdown.length > 1 && (
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              {score.formBreakdown.map((form) => (
                <span key={form.key}>
                  <span className="capitalize">{form.key.replaceAll("_", " ")}</span>
                  {": "}
                  {form.weightedPoopScore != null ? (
                    <span className={`font-medium ${poopScoreColor(form.weightedPoopScore)}`}>
                      {form.weightedPoopScore.toFixed(1)}
                    </span>
                  ) : "—"}
                  <span className="text-text-tertiary"> · {form.dayCount}d</span>
                </span>
              ))}
            </div>
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
                    {NON_FOOD_TYPES.has(entry.productType) && (
                      <span className="text-text-tertiary"> · {PRODUCT_TYPE_LABELS[entry.productType] ?? entry.productType}</span>
                    )}{" "}
                    <span className="text-text-tertiary">
                      (#{entry.position + 1} — {entry.formKey ? `${entry.formKey.replace(/[()]/g, "")}, ` : ""}{POSITION_LABELS[entry.positionCategory].toLowerCase()})
                    </span>
                    {(entry.avgPoopScore != null || entry.avgItchScore != null) && (
                      <span className="text-text-tertiary">
                        {" · "}
                        {entry.avgPoopScore != null && (
                          <span className={entry.avgPoopScore >= 5 ? "text-score-critical" : entry.avgPoopScore >= 4 ? "text-score-fair" : "text-score-good"}>
                            {entry.avgPoopScore} stool
                          </span>
                        )}
                        {entry.avgPoopScore != null && entry.avgItchScore != null && " · "}
                        {entry.avgItchScore != null && (
                          <span className={entry.avgItchScore >= 4 ? "text-score-critical" : entry.avgItchScore >= 3 ? "text-score-fair" : "text-score-good"}>
                            {entry.avgItchScore} itch
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
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
