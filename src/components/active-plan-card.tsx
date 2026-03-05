"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus, Settings } from "lucide-react"
import { format, parseISO } from "date-fns"
import type { ActivePlan, MedicationSummary } from "@/lib/types"
import { MedicationItem } from "@/components/medication-item"
import { ProductItem } from "@/components/product-item"

interface ActivePlanCardProps {
  plan: ActivePlan | null
  medications: MedicationSummary[]
  onEditRoutine: () => void
}

export function ActivePlanCard({
  plan,
  medications,
  onEditRoutine,
}: ActivePlanCardProps) {
  const hasContent = plan || medications.length > 0

  if (!hasContent) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No active routine
          </p>
          <Button onClick={onEditRoutine} size="sm">
            <Plus className="size-4" />
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
            {plan ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Since {format(parseISO(plan.startDate), "MMM d, yyyy")}
                {plan.endDate && (
                  <>
                    {" "}
                    &mdash; {format(parseISO(plan.endDate), "MMM d, yyyy")}
                  </>
                )}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">
                No food plan &mdash; {medications.length} medication{medications.length !== 1 ? "s" : ""} active
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onEditRoutine}
            className="shrink-0"
          >
            <Settings className="size-4" />
            Edit
          </Button>
        </div>

        {/* Food & supplement items */}
        {plan && plan.items.length > 0 && (
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

        {/* Medications section */}
        {medications.length > 0 && (
          <div className="space-y-2">
            {medications.map((med) => (
              <MedicationItem
                key={med.id}
                name={med.name}
                dosage={med.dosage}
                reason={med.reason}
              />
            ))}
          </div>
        )}

      </CardContent>
    </Card>
  )
}
