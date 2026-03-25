"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { LiaPlusSolid, LiaPenSolid } from "react-icons/lia"
import { format, parseISO } from "date-fns"
import { EditPlanDates } from "@/components/edit-plan-dates"
import type { ActivePlan } from "@/lib/types"
import { ProductItem } from "@/components/product-item"

interface ActivePlanCardProps {
  plan: ActivePlan | null
  onEditRoutine: () => void
  onDatesChanged?: () => void
}

export function ActivePlanCard({
  plan,
  onEditRoutine,
  onDatesChanged,
}: ActivePlanCardProps): React.ReactElement {
  if (!plan) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No active routine
          </p>
          <Button onClick={onEditRoutine} size="sm">
            <LiaPlusSolid className="size-4" />
            Set up routine
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Current routine
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground flex items-center gap-1">
              Since {format(parseISO(plan.startDate), "MMM d, yyyy")}
              {plan.endDate && (
                <>
                  {" "}
                  - {format(parseISO(plan.endDate), "MMM d, yyyy")}
                </>
              )}
              {onDatesChanged && (
                <EditPlanDates
                  planGroupId={plan.planGroupId}
                  startDate={plan.startDate}
                  startDatetime={plan.startDatetime}
                  endDate={plan.endDate}
                  endDatetime={plan.endDatetime}
                  onSaved={onDatesChanged}
                />
              )}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onEditRoutine}
            className="shrink-0"
          >
            <LiaPenSolid className="size-4" />
            Edit routine
          </Button>
        </div>

        {/* Food & supplement items */}
        {plan.items.length > 0 && (
          <div className="space-y-2">
            {plan.items.map((item) => (
              <ProductItem
                key={item.id}
                brandName={item.brandName}
                productName={item.productName}
                imageUrl={item.imageUrl}
                quantity={item.quantity}
                quantityUnit={item.quantityUnit}
                mealSlot={item.mealSlot}
              />
            ))}
          </div>
        )}

      </CardContent>
    </Card>
  )
}
