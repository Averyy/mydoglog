"use client"

import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ResponsivePopover } from "@/components/responsive-popover"
import { ProductIngredientList, type ProductIngredientListData } from "@/components/product-ingredient-list"
import { NutritionLabel } from "@/components/nutrition-label"
import { computeNutrition, type NutritionItem } from "@/lib/nutrition"
import { formatDateRange, daysInRange, avgFromRange } from "@/lib/food-helpers"
import { smallImageUrl, largeImageUrl } from "@/lib/utils"
import { poopScoreColor, itchScoreColor } from "@/components/score-grid"
import { LiaPenSolid } from "react-icons/lia"
import type { FeedingPlanGroup } from "@/lib/types"
import type { IngredientScore } from "@/lib/correlation/types"

/** Singularize "1 weeks" -> "1 week", leave "2 weeks" as-is. */
function formatApproximateDuration(raw: string): string {
  return raw.replace(/^1\s+(\w+)s$/i, "1 $1")
}

interface ProductNutritionData {
  guaranteedAnalysis: Record<string, number> | null
  calorieContent: string | null
  type: string | null
  format: string | null
}

export interface PlanGroupCardProps {
  group: FeedingPlanGroup
  isCurrent?: boolean
  onEditBackfill?: (group: FeedingPlanGroup) => void
  productIngredientDataMap: Map<string, ProductIngredientListData>
  productNutritionMap: Map<string, ProductNutritionData>
  correlationScores: IngredientScore[]
}

export function PlanGroupCard({
  group,
  isCurrent,
  onEditBackfill,
  productIngredientDataMap,
  productNutritionMap,
  correlationScores,
}: PlanGroupCardProps): React.ReactElement {
  const stats = group.logStats
  const sc = group.scorecard
  const days = daysInRange(group.startDate, isCurrent ? null : group.endDate)
  const avgStool = stats?.avgPoopScore ?? avgFromRange(sc?.poopQuality ?? null)
  const avgItch = stats?.avgItchScore ?? avgFromRange(sc?.itchSeverity ?? null)
  const dateLabel = formatDateRange(group.startDate, isCurrent ? null : group.endDate)

  // Combined nutrition for the full routine
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
    <Card className={`overflow-hidden gap-0 py-0 ${isCurrent ? "border-dashed" : ""}`}>
      {/* Header: label + date | scores | edit */}
      <div className="flex flex-col gap-2 px-4 pt-4 pb-3 sm:flex-row sm:items-center sm:gap-3">
        {/* Left: label + date */}
        <div className="min-w-0 sm:flex-1">
          {isCurrent ? (
            <p className="text-sm font-semibold text-foreground">
              Current Daily Routine <span className="font-normal text-muted-foreground">({dateLabel})</span>
            </p>
          ) : (
            <p className="text-[11px] text-text-tertiary">
              {dateLabel}
              {group.isBackfill && group.approximateDuration && (
                <span className="text-text-tertiary">
                  {" "}({formatApproximateDuration(group.approximateDuration)})
                </span>
              )}
            </p>
          )}
        </div>

        {/* Score chips — full width on mobile */}
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

        {/* Transition badge */}
        {isCurrent && group.transitionDays != null && group.transitionDays > 0 && (
          <Badge variant="outline" className="shrink-0 text-[10px] border-primary text-primary">
            Transitioning
          </Badge>
        )}

        {/* Badges + edit (non-current backfills only) */}
        {!isCurrent && group.isBackfill && (
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className="text-[10px]">
              Backfill
            </Badge>
            {onEditBackfill && (
              <button
                type="button"
                onClick={() => onEditBackfill(group)}
                className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline underline-offset-2"
              >
                <LiaPenSolid className="size-3" />
                Edit
              </button>
            )}
          </div>
        )}
      </div>

      {/* Products — side by side, largest portion first */}
      <CardContent className="px-4 pt-0 pb-4">
        <div className="flex flex-wrap gap-3">
          {[...group.items].sort((a, b) => parseFloat(b.quantity ?? "0") - parseFloat(a.quantity ?? "0")).map((item) => (
            <div
              key={item.id}
              className="min-w-0 flex-1 basis-40 rounded-md border border-border-light overflow-hidden"
            >
              {/* Product image */}
              <div className="relative flex items-center justify-center bg-score-strip px-3 py-2">
                {item.imageUrl ? (
                  <img
                    src={largeImageUrl(item.imageUrl)}
                    alt=""
                    className="h-24 w-auto object-contain rounded-md mix-blend-multiply dark:mix-blend-normal"
                  />
                ) : (
                  <div className="h-24 flex items-center justify-center">
                    <span className="text-[10px] text-muted-foreground">No img</span>
                  </div>
                )}
                {item.quantity && (
                  <Badge variant="secondary" className="absolute top-2 right-2 text-[10px]">
                    {item.quantity}{item.quantityUnit === "g" ? "g" : ` ${item.quantityUnit ?? ""}`} daily
                  </Badge>
                )}
              </div>

              {/* Product info + nutrition */}
              <div className="p-3">
                <p className="text-[11px] text-muted-foreground">{item.brandName}</p>
                <p className="text-sm font-medium text-foreground line-clamp-2">{item.productName}</p>
                <div className="mt-1.5">
                  <ProductIngredientList
                    data={productIngredientDataMap.get(item.productId)}
                    nutrition={productNutritionMap.get(item.productId)}
                    correlationScores={correlationScores}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Treats sub-section */}
        {group.treats.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Treats</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.treats.map((treat) => (
                <div key={treat.productId} className="flex items-center gap-2.5 rounded-md border border-border-light px-2.5 py-2">
                  <div className="size-8 shrink-0 rounded bg-muted-subtle flex items-center justify-center">
                    {treat.imageUrl ? (
                      <img
                        src={smallImageUrl(treat.imageUrl)}
                        alt=""
                        className="size-full rounded object-contain mix-blend-multiply dark:mix-blend-normal"
                      />
                    ) : (
                      <span className="text-[8px] text-muted-foreground">No img</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-muted-foreground">
                      {treat.brandName} {treat.productName}
                    </p>
                    <div className="mt-0.5 [&_button]:text-[10px]">
                      <ProductIngredientList
                        data={productIngredientDataMap.get(treat.productId)}
                        nutrition={productNutritionMap.get(treat.productId)}
                        correlationScores={correlationScores}
                      />
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {treat.logCount}x total
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
