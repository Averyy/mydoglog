"use client"

import { useState, useMemo, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ProductPicker } from "@/components/product-picker"
import { ResponsiveModal } from "@/components/responsive-modal"
import {
  FoodScorecardForm,
  type ScorecardData,
} from "@/components/food-scorecard-form"
import { DateRangePicker } from "@/components/date-range-picker"
import { eachDayOfInterval, parseISO } from "date-fns"
import { toast } from "sonner"
import { Info } from "lucide-react"
import type { FeedingPlanGroup, ProductSummary } from "@/lib/types"
import { QUANTITY_UNIT_OPTIONS, SUPPLEMENT_PRODUCT_TYPES } from "@/lib/labels"
import { getAvailableUnits } from "@/lib/nutrition"

type BackfillStep = "product" | "scorecard"

interface BackfillProduct {
  product: ProductSummary
  startDate: string
  endDate: string
  quantity: string
  quantityUnit: string
}

interface ExistingPeriod {
  planGroupId: string
  start: string
  end: string | null
  label: string
}

interface BackfillModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dogId: string
  editingGroup: FeedingPlanGroup | null
  existingPeriods: ExistingPeriod[]
  allGroups: FeedingPlanGroup[]
  onSaved: () => void
}

export function BackfillModal({
  open,
  onOpenChange,
  dogId,
  editingGroup,
  existingPeriods,
  allGroups,
  onSaved,
}: BackfillModalProps): React.ReactElement {
  const [step, setStep] = useState<BackfillStep>("product")
  const [product, setProduct] = useState<BackfillProduct | null>(null)
  const [saving, setSaving] = useState(false)

  // Reset state when modal opens/closes or editingGroup changes
  useEffect(() => {
    if (!open) return
    setStep("product")
    setSaving(false)
    if (editingGroup) {
      const item = editingGroup.items[0]
      setProduct({
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
        startDate: editingGroup.startDate,
        endDate: editingGroup.endDate ?? "",
        quantity: item.quantity ?? "1",
        quantityUnit: item.quantityUnit ?? (getAvailableUnits(null, item.type)?.[0]?.value ?? "cup"),
      })
    } else {
      setProduct(null)
    }
  }, [open, editingGroup])

  // Calendar highlights
  const yesterday = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d
  }, [])

  const existingFoodDates = useMemo((): Date[] => {
    return existingPeriods.flatMap((p) => {
      const end = p.end ? parseISO(p.end) : new Date()
      return eachDayOfInterval({ start: parseISO(p.start), end })
    })
  }, [existingPeriods])

  const backfillOverlap = useMemo((): string | null => {
    if (!product?.startDate || !product?.endDate) return null
    if (SUPPLEMENT_PRODUCT_TYPES.has(product.product.type ?? "")) return null
    const s = product.startDate
    const e = product.endDate
    const match = existingPeriods.find((p) => {
      if (editingGroup && p.planGroupId === editingGroup.planGroupId) return false
      const pEnd = p.end ?? "9999-12-31"
      return s <= pEnd && p.start <= e
    })
    return match?.label ?? null
  }, [product?.startDate, product?.endDate, product?.product.type, editingGroup, existingPeriods])

  const activeLogOverlap = useMemo((): boolean => {
    if (!product?.startDate || !product?.endDate) return false
    const s = product.startDate
    const e = product.endDate
    return allGroups.some((g) => {
      if (g.isBackfill) return false
      const pEnd = g.endDate ?? "9999-12-31"
      return s <= pEnd && g.startDate <= e
    })
  }, [product?.startDate, product?.endDate, allGroups])

  function handleProductSelected(p: ProductSummary | null): void {
    if (!p) return
    const units = getAvailableUnits(p.calorieContent ?? null, p.type)
    const defaultUnit = units?.[0]?.value ?? "cup"
    setProduct((prev) => ({
      product: p,
      startDate: prev?.startDate ?? "",
      endDate: prev?.endDate ?? "",
      quantity: prev?.quantity ?? "1",
      quantityUnit: prev?.product?.id === p.id ? (prev?.quantityUnit ?? defaultUnit) : defaultUnit,
    }))
  }

  async function handleNext(): Promise<void> {
    if (!product || !product.startDate || !product.endDate) {
      toast.error("Select a date range")
      return
    }
    if (editingGroup) {
      const ok = await handleEditSave()
      if (ok) setStep("scorecard")
      return
    }
    setStep("scorecard")
  }

  async function handleScorecardSave(scorecardData: ScorecardData): Promise<void> {
    if (!product) return
    setSaving(true)
    try {
      if (editingGroup) {
        const res = await fetch(
          `/api/food/groups/${editingGroup.planGroupId}/scorecard`,
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
        const res = await fetch(`/api/dogs/${dogId}/food/backfill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [{
              productId: product.product.id,
              quantity: product.quantity || "1",
              quantityUnit: product.quantityUnit,
            }],
            startDate: product.startDate,
            endDate: product.endDate,
            scorecard: scorecardData,
          }),
        })
        if (!res.ok) {
          toast.error("Failed to save")
          return
        }
      }
      toast.success(editingGroup ? "Updated" : "Past food scored")
      onOpenChange(false)
      onSaved()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  async function handleEditSave(): Promise<boolean> {
    if (!editingGroup || !product || !product.startDate || !product.endDate) return false
    setSaving(true)
    try {
      const res = await fetch(`/api/food/groups/${editingGroup.planGroupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: product.startDate,
          endDate: product.endDate,
          productId: product.product.id,
          quantity: product.quantity || "1",
          quantityUnit: product.quantityUnit,
        }),
      })
      if (!res.ok) {
        toast.error("Failed to update")
        return false
      }
      onSaved()
      return true
    } catch {
      toast.error("Something went wrong")
      return false
    } finally {
      setSaving(false)
    }
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={step === "product"
        ? (editingGroup ? "Edit feeding period" : "Add past food")
        : "Rate this food"}
      description={step === "product"
        ? (editingGroup ? "Update the food or date range." : "Add a food your dog has eaten before.")
        : "How did this work out?"}
      size="lg"
    >
      {step === "product" ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-[0.05em] text-muted-foreground">
              Product
            </Label>
            <ProductPicker
              value={product?.product ?? null}
              onChange={handleProductSelected}
              placeholder="Search foods..."
              inline
              dogId={dogId}
            />
          </div>

          {product && (
            <>
              <div className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-[0.05em] text-muted-foreground">
                  When did you feed this?
                </Label>
                <DateRangePicker
                  from={product.startDate}
                  to={product.endDate}
                  onChange={(from, to) =>
                    setProduct({ ...product, startDate: from, endDate: to })
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
                    value={product.quantity}
                    onChange={(e) =>
                      setProduct({ ...product, quantity: e.target.value })
                    }
                    className="h-9 w-20"
                  />
                  <Select
                    value={product.quantityUnit}
                    onValueChange={(v) =>
                      setProduct({ ...product, quantityUnit: v })
                    }
                  >
                    <SelectTrigger size="sm" className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(getAvailableUnits(product.product.calorieContent ?? null, product.product.type) ??
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
                onClick={handleNext}
                disabled={!product.startDate || !product.endDate || saving}
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
          onSave={handleScorecardSave}
          initialData={editingGroup?.scorecard ?? undefined}
        />
      )}
    </ResponsiveModal>
  )
}
