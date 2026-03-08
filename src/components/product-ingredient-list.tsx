"use client"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ChevronDown } from "lucide-react"
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

export function ProductIngredientList({
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
