"use client"

import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ResponsivePopover } from "@/components/responsive-popover"
import { ProductIngredientList, type ProductIngredientListData } from "@/components/product-ingredient-list"
import { NutritionLabel } from "@/components/nutrition-label"
import { computeNutrition, type NutritionItem } from "@/lib/nutrition"
import { formatDateRange, daysInRange, avgFromRange } from "@/lib/food-helpers"
import { smallImageUrl } from "@/lib/utils"
import { poopScoreColor, itchScoreColor } from "@/components/score-grid"
import { LiaPenSolid } from "react-icons/lia"
import type { FeedingPlanGroup } from "@/lib/types"
import type { IngredientScore } from "@/lib/correlation/types"

interface ProductNutritionData {
  guaranteedAnalysis: Record<string, number> | null
  calorieContent: string | null
  type: string | null
  format: string | null
}

export interface PastRoutineCardProps {
  group: FeedingPlanGroup
  productIngredientDataMap: Map<string, ProductIngredientListData>
  productNutritionMap: Map<string, ProductNutritionData>
  correlationScores: IngredientScore[]
  onEditBackfill?: (group: FeedingPlanGroup) => void
}

export function PastRoutineCard({
  group,
  productIngredientDataMap,
  productNutritionMap,
  correlationScores,
  onEditBackfill,
}: PastRoutineCardProps): React.ReactElement {
  const stats = group.logStats
  const sc = group.scorecard
  const days = daysInRange(group.startDate, group.endDate)
  const avgStool = stats?.avgPoopScore ?? avgFromRange(sc?.poopQuality ?? null)
  const avgItch = stats?.avgItchScore ?? avgFromRange(sc?.itchSeverity ?? null)

  const combinedNutrition = useMemo(() => {
    const items: NutritionItem[] = group.items.map((item) => {
      const nutrition = productNutritionMap.get(item.productId)
      return {
        guaranteedAnalysis: nutrition?.guaranteedAnalysis ?? null,
        calorieContent: nutrition?.calorieContent ?? null,
        quantity: item.quantity ? parseFloat(item.quantity) : null,
        quantityUnit: item.quantityUnit,
      }
    })
    return computeNutrition(items)
  }, [group.items, productNutritionMap])

  const ingredientLists = useMemo(() => {
    return group.items.map((item) => {
      const data = productIngredientDataMap.get(item.productId)
      return {
        name: `${item.brandName} ${item.productName}`,
        ingredients: data?.allIngredients.join(", ") ?? "",
      }
    }).filter((item) => item.ingredients.length > 0)
  }, [group.items, productIngredientDataMap])

  return (
    <Card className="overflow-hidden gap-0 py-0">
      {/* Header: date + scores */}
      <div className="flex flex-col gap-2 px-4 pt-4 pb-3 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 sm:flex-1">
          <p className="text-sm font-semibold text-foreground">
            {formatDateRange(group.startDate, group.endDate)}
          </p>
          {group.transitionDays != null && group.transitionDays > 0 && (
            <p className="text-xs text-muted-foreground">
              {group.transitionDays}-day transition{group.transitionFromFoodName ? ` from ${group.transitionFromFoodName}` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 w-full xs:flex-nowrap sm:w-auto sm:gap-2 sm:shrink-0">
          <div className="flex basis-[calc(50%-0.1875rem)] flex-1 items-center gap-1.5 rounded-md bg-score-strip px-2 py-1.5 xs:basis-auto">
            <span className={`text-base leading-none font-bold tabular-nums ${avgStool != null ? poopScoreColor(avgStool) : "text-muted-foreground"}`}>
              {avgStool ?? "-"}
            </span>
            <span className="text-xs leading-none font-medium uppercase tracking-wider text-muted-foreground">Stool</span>
          </div>
          <div className="flex basis-[calc(50%-0.1875rem)] flex-1 items-center gap-1.5 rounded-md bg-score-strip px-2 py-1.5 xs:basis-auto">
            <span className={`text-base leading-none font-bold tabular-nums ${avgItch != null ? itchScoreColor(avgItch) : "text-muted-foreground"}`}>
              {avgItch ?? "-"}
            </span>
            <span className="text-xs leading-none font-medium uppercase tracking-wider text-muted-foreground">Itch</span>
          </div>
          <div className="flex basis-[calc(50%-0.1875rem)] flex-1 items-center gap-1.5 rounded-md bg-score-strip px-2 py-1.5 xs:basis-auto">
            <span className="text-base leading-none font-bold tabular-nums text-muted-foreground">{days}</span>
            <span className="text-xs leading-none font-medium uppercase tracking-wider text-muted-foreground">Days</span>
          </div>
          <ResponsivePopover
            title="Combined Nutrition"
            align="end"
            contentClassName="p-4"
            trigger={
              <button
                type="button"
                className="flex basis-[calc(50%-0.1875rem)] flex-1 items-center gap-1.5 rounded-md bg-score-strip px-2 py-1.5 hover:bg-item-hover transition-colors xs:basis-auto"
              >
                <span className="text-base leading-none font-bold tabular-nums text-muted-foreground">
                  {combinedNutrition.caloriesPerDay ?? "-"}
                </span>
                <span className="text-xs leading-none font-medium uppercase tracking-wider text-muted-foreground">Cal</span>
              </button>
            }
          >
            <NutritionLabel
              data={combinedNutrition}
              ingredientLists={ingredientLists}
              compact
            />
          </ResponsivePopover>
        </div>
      </div>

      {/* Products as compact rows */}
      <CardContent className="px-4 pt-0 pb-4">
        <div className="space-y-1.5">
          {[...group.items].sort((a, b) => parseFloat(b.quantity ?? "0") - parseFloat(a.quantity ?? "0")).map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-md border border-border-light px-3 py-2">
              <div className="size-9 shrink-0 rounded-md bg-score-strip flex items-center justify-center">
                {item.imageUrl ? (
                  <img
                    src={smallImageUrl(item.imageUrl)}
                    alt=""
                    className="size-full rounded-md object-contain mix-blend-multiply dark:mix-blend-normal"
                  />
                ) : (
                  <span className="text-[8px] text-muted-foreground">No img</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-muted-foreground">{item.brandName}</p>
                <p className="truncate text-sm font-medium text-foreground">{item.productName}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ProductIngredientList
                  data={productIngredientDataMap.get(item.productId)}
                  nutrition={productNutritionMap.get(item.productId)}
                  correlationScores={correlationScores}
                />
                {item.quantity && (
                  <Badge variant="secondary" className="text-[10px]">
                    {item.quantity}{item.quantityUnit === "g" ? "g" : ` ${item.quantityUnit ?? ""}`} daily
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Treats */}
        {group.treats.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">Treats</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              {group.treats.map((treat) => (
                <div key={treat.productId}>
                  <span>{treat.brandName} {treat.productName} <span className="text-text-tertiary">({treat.logCount}x total)</span></span>
                  <div className="mt-0.5 [&_button]:text-[10px]">
                    <ProductIngredientList
                      data={productIngredientDataMap.get(treat.productId)}
                      nutrition={productNutritionMap.get(treat.productId)}
                      correlationScores={correlationScores}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Edit backfill */}
        {group.isBackfill && onEditBackfill && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => onEditBackfill(group)}
              className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline underline-offset-2"
            >
              <LiaPenSolid className="size-3" />
              Edit
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
