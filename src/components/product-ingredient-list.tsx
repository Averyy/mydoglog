"use client"

import { useMemo } from "react"
import { ResponsivePopover } from "@/components/responsive-popover"
import { NutritionLabel } from "@/components/nutrition-label"
import { computeProductNutrition } from "@/lib/nutrition"
import { ChevronDown } from "lucide-react"
import { useIsMobile } from "@/hooks/use-is-mobile"

const INGREDIENT_SCORE_COLORS: Record<number, string> = {
  1: "text-score-excellent-text", 2: "text-score-excellent-text",
  3: "text-score-good-text", 4: "text-score-fair-text",
  5: "text-score-fair-text", 6: "text-score-poor-text",
  7: "text-score-critical-text",
}

function ingredientScoreColor(avg: number): string {
  return INGREDIENT_SCORE_COLORS[Math.round(avg)] ?? ""
}

import type { IngredientScore } from "@/lib/correlation/types"

export interface ClassifiedIngredient {
  position: number
  normalizedName: string
  family: string | null
  sourceGroup: string | null
  formType: string | null
  isHydrolyzed: boolean
}

export interface ProductIngredientListData {
  allIngredients: string[]
  classifiedByPosition: Map<number, ClassifiedIngredient>
  saltPosition: number | null
}

export function findScoreForIngredient(
  classified: ClassifiedIngredient | undefined,
  correlationScores: IngredientScore[],
): IngredientScore | null {
  if (!classified) return null

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

  if (!classified.family && classified.sourceGroup) {
    const ambiguousKey = `${classified.sourceGroup} (ambiguous)`
    const match = correlationScores.find((s) => s.key === ambiguousKey)
    if (match) return match
  }

  return null
}

interface ProductNutritionData {
  guaranteedAnalysis: Record<string, number> | null
  calorieContent: string | null
  type: string | null
  format: string | null
}

export function ProductIngredientList({
  data,
  nutrition,
  correlationScores,
}: {
  data: ProductIngredientListData | undefined
  nutrition?: ProductNutritionData
  correlationScores: IngredientScore[]
}): React.ReactElement {
  const isMobile = useIsMobile()

  if (!data) {
    return <></>
  }

  const aboveSalt = data.saltPosition != null
    ? data.allIngredients.slice(0, data.saltPosition)
    : data.allIngredients
  const belowSalt = data.saltPosition != null
    ? data.allIngredients.slice(data.saltPosition)
    : []

  const nutritionData = useMemo(() => {
    if (!nutrition) return null
    return computeProductNutrition(nutrition.guaranteedAnalysis, nutrition.calorieContent, nutrition.type, nutrition.format)
  }, [nutrition])

  const hasNutrition = nutritionData && (
    nutritionData.primaryAnalysis.some((r) => r.value !== null) ||
    nutritionData.caloriesPerDay !== null
  )

  return (
    <ResponsivePopover
      title="Nutrition"
      trigger={
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2"
        >
          {isMobile ? "Nutrition" : "View nutrition"}
          <ChevronDown className="size-3" />
        </button>
      }
    >
      <div className="flex flex-col sm:flex-row">
        {/* Ingredients list */}
        <div className="flex-1 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
            Ingredients
          </p>
          <div className="space-y-1">
            <ol className="space-y-0.5">
              {aboveSalt.map((rawName, idx) => {
                const position = idx + 1
                const classified = data.classifiedByPosition.get(position)
                const matchedScore = findScoreForIngredient(classified, correlationScores)
                const scoreColor = matchedScore?.weightedPoopScore != null
                  ? ingredientScoreColor(matchedScore.weightedPoopScore)
                  : ""

                return (
                  <li key={position}>
                    <div className="flex items-baseline gap-1.5 text-xs text-foreground">
                      <span className="tabular-nums text-text-tertiary w-5 text-right shrink-0">{position}.</span>
                      <span className={scoreColor}>
                        {rawName}
                      </span>
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
                <p className="text-[9px] leading-tight text-text-tertiary">
                  {belowSalt.join(", ")}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Nutrition label */}
        {hasNutrition && (
          <div className="shrink-0 border-t border-border bg-secondary p-4 sm:flex sm:w-[232px] sm:items-center sm:border-t-0 sm:border-l">
            <NutritionLabel
              variant="product"
              data={nutritionData}
              calorieContentRaw={nutrition?.calorieContent}
            />
          </div>
        )}
      </div>
    </ResponsivePopover>
  )
}
