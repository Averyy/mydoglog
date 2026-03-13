"use client"

import { useState, useEffect, useRef, useMemo } from "react"
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
import { NutritionLabel } from "@/components/nutrition-label"
import { LiaPlusSolid, LiaTrashAltSolid } from "react-icons/lia"
import { format, parseISO } from "date-fns"
import { toast } from "sonner"
import type { ActivePlan, FeedingPlanItem, ProductSummary } from "@/lib/types"
import { QUANTITY_UNIT_OPTIONS } from "@/lib/labels"
import { computeNutrition, getAvailableUnits, type NutritionItem, type AvailableUnit } from "@/lib/nutrition"
import { computeTransitionSchedule, isMainFoodType, type TransitionItem } from "@/lib/transition"
import { getToday } from "@/lib/utils"
import { shiftDate } from "@/lib/date-utils"
import { useDogPage } from "@/components/dog-page-provider"

// ─── Local types ─────────────────────────────────────────────────────────────

interface PlanItem {
  key: string
  product: ProductSummary | null
  quantity: string
  quantityUnit: string
  /** Original feeding period id (if editing existing item) */
  originalId?: string
}

interface ProductDetail {
  guaranteedAnalysis: Record<string, number> | null
  calorieContent: string | null
  rawIngredientString: string | null
}

type EditorView = "edit" | "transition"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createPlanItem(from?: FeedingPlanItem): PlanItem {
  if (from) {
    return {
      key: crypto.randomUUID(),
      product: {
        id: from.productId,
        name: from.productName,
        brandName: from.brandName,
        brandId: "",
        type: from.type,
        format: from.format ?? null,
        channel: null,
        lifestage: null,
        imageUrl: from.imageUrl,
        isDiscontinued: false,
        calorieContent: null,
      },
      quantity: from.quantity ?? "",
      quantityUnit: from.quantityUnit ?? "cup",
      originalId: from.id,
    }
  }
  return {
    key: crypto.randomUUID(),
    product: null,
    quantity: "",
    quantityUnit: "cup",
  }
}

/** Returns true if products were added, removed, or swapped (structural change). */
function productsChanged(
  items: PlanItem[],
  original: FeedingPlanItem[],
): boolean {
  const validItems = items.filter((i) => i.product)
  if (validItems.length !== original.length) return true

  for (const item of validItems) {
    const orig = original.find((o) => o.id === item.originalId)
    if (!orig) return true
    if (item.product!.id !== orig.productId) return true
  }
  return false
}

/** Returns true if same products but quantities/units differ. */
function quantitiesChanged(
  items: PlanItem[],
  original: FeedingPlanItem[],
): boolean {
  const validItems = items.filter((i) => i.product)
  for (const item of validItems) {
    const orig = original.find((o) => o.id === item.originalId)
    if (!orig) continue
    if ((item.quantity || null) !== (orig.quantity || null)) return true
    if (item.quantity && item.quantityUnit !== (orig.quantityUnit ?? "cup")) return true
  }
  return false
}

/** Check if any main food product changed (not just supplements). */
function mainFoodChanged(
  items: PlanItem[],
  original: FeedingPlanItem[],
): boolean {
  const validItems = items.filter((i) => i.product && isMainFoodType(i.product.type))
  const origMainItems = original.filter((o) => isMainFoodType(o.type))

  if (validItems.length !== origMainItems.length) return true

  const newFoodIds = new Set(validItems.map((i) => i.product!.id))
  const oldFoodIds = new Set(origMainItems.map((o) => o.productId))

  if (newFoodIds.size !== oldFoodIds.size) return true
  for (const id of newFoodIds) {
    if (!oldFoodIds.has(id)) return true
  }
  return false
}

// ─── Content component ───────────────────────────────────────────────────────

interface RoutineEditorContentProps {
  dogId: string
  currentPlan: ActivePlan | null
  onSaved: () => void
  onCancel?: () => void
}

export function RoutineEditorContent({
  dogId,
  currentPlan,
  onSaved,
  onCancel,
}: RoutineEditorContentProps): React.ReactElement {
  // If currently transitioning, pre-fill from target items (ongoing rows)
  const initialItems = currentPlan?.isTransitioning && currentPlan.targetItems
    ? currentPlan.targetItems
    : currentPlan?.items

  const [planItems, setPlanItems] = useState<PlanItem[]>(() =>
    initialItems && initialItems.length > 0
      ? initialItems.map((item) => createPlanItem(item))
      : [createPlanItem()],
  )
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<EditorView>("edit")
  const [transitionDays, setTransitionDays] = useState(3)
  const { mealsPerDay } = useDogPage()

  // ── Product detail fetching for nutrition label ─────────────────────

  const [productDetails, setProductDetails] = useState<Map<string, ProductDetail>>(new Map())
  const fetchedRef = useRef<Set<string>>(new Set())

  // Stable dependency: only re-run when the set of selected product IDs changes
  const selectedProductIds = useMemo(
    () =>
      planItems
        .map((i) => i.product?.id)
        .filter((id): id is string => !!id)
        .sort()
        .join(","),
    [planItems],
  )

  useEffect(() => {
    const ids = selectedProductIds
      .split(",")
      .filter((id) => id && !fetchedRef.current.has(id))

    if (ids.length === 0) return

    for (const id of ids) fetchedRef.current.add(id)

    Promise.all(
      ids.map((id) =>
        fetch(`/api/products/${id}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((results) => {
      setProductDetails((prev) => {
        const next = new Map(prev)
        for (const detail of results) {
          if (detail) {
            next.set(detail.id, {
              guaranteedAnalysis: detail.guaranteedAnalysis,
              calorieContent: detail.calorieContent,
              rawIngredientString: detail.rawIngredientString,
            })
          }
        }
        return next
      })
    })
  }, [selectedProductIds])

  // Auto-select the natural unit when product details arrive
  useEffect(() => {
    setPlanItems((prev) => {
      let changed = false
      const next = prev.map((item) => {
        if (!item.product) return item
        const detail = productDetails.get(item.product.id)
        const calContent = detail?.calorieContent ?? item.product.calorieContent ?? null
        const available = getAvailableUnits(calContent, item.product.type, item.product.format)
        if (!available) return item
        const validValues = available.map((u) => u.value)
        if (validValues.includes(item.quantityUnit)) return item
        // Current unit isn't available for this product — switch to natural unit
        changed = true
        return { ...item, quantityUnit: available[0].value }
      })
      return changed ? next : prev
    })
  }, [productDetails])

  const nutrition = useMemo(() => {
    const items: NutritionItem[] = planItems
      .filter((i) => i.product && i.quantity && productDetails.has(i.product.id))
      .map((i) => {
        const detail = productDetails.get(i.product!.id)!
        return {
          guaranteedAnalysis: detail.guaranteedAnalysis,
          calorieContent: detail.calorieContent,
          quantity: parseFloat(i.quantity),
          quantityUnit: i.quantityUnit,
        }
      })
    return computeNutrition(items)
  }, [planItems, productDetails])

  const ingredientsByProduct = useMemo(() => {
    const result: { name: string; ingredients: string }[] = []
    for (const item of planItems) {
      if (!item.product) continue
      const detail = productDetails.get(item.product.id)
      if (!detail?.rawIngredientString) continue
      result.push({
        name: `${item.product.brandName} ${item.product.name}`,
        ingredients: detail.rawIngredientString,
      })
    }
    return result
  }, [planItems, productDetails])

  // ── Transition preview ──────────────────────────────────────────────

  const transitionPreview = useMemo(() => {
    if (view !== "transition" || !currentPlan) return []

    // When editing during an active transition, use targetItems (ongoing rows = current food)
    // as the "old" baseline, not the mixed transition-day items
    const oldSource = currentPlan.isTransitioning && currentPlan.targetItems
      ? currentPlan.targetItems
      : (currentPlan.items ?? [])
    const oldItems: TransitionItem[] = oldSource.map((item) => ({
      productId: item.productId,
      quantity: item.quantity ?? "0",
      quantityUnit: item.quantityUnit ?? "cup",
      mealSlot: item.mealSlot ?? undefined,
      type: item.type,
    }))

    const newItems: TransitionItem[] = planItems
      .filter((i) => i.product)
      .map((i) => ({
        productId: i.product!.id,
        quantity: i.quantity || "1",
        quantityUnit: i.quantityUnit,
        type: i.product!.type,
      }))

    return computeTransitionSchedule(oldItems, newItems, transitionDays, getToday())
  }, [view, currentPlan, planItems, transitionDays])

  // ── Plan item handlers ────────────────────────────────────────────────

  function updatePlanItem(key: string, updates: Partial<PlanItem>): void {
    setPlanItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...updates } : item)),
    )
  }

  function removePlanItem(key: string): void {
    setPlanItems((prev) => {
      const next = prev.filter((item) => item.key !== key)
      return next.length === 0 ? [createPlanItem()] : next
    })
  }

  // ── Save logic ────────────────────────────────────────────────────────

  async function handleSave(withTransition: boolean = false): Promise<void> {
    const validPlanItems = planItems.filter((i) => i.product)

    if (validPlanItems.length === 0) {
      toast.error("Add at least one food item")
      return
    }

    setSaving(true)
    try {
      const isStructural = currentPlan
        ? productsChanged(planItems, currentPlan.isTransitioning && currentPlan.targetItems ? currentPlan.targetItems : currentPlan.items)
        : validPlanItems.length > 0
      const isQuantityOnly = !isStructural && currentPlan
        ? quantitiesChanged(planItems, currentPlan.isTransitioning && currentPlan.targetItems ? currentPlan.targetItems : currentPlan.items)
        : false

      // Force POST when actively transitioning (replace transition)
      const forcePost = currentPlan?.isTransitioning ?? false

      if ((isStructural || forcePost) && validPlanItems.length > 0) {
        const body: Record<string, unknown> = {
          mode: "starting_today",
          startDate: getToday(),
          items: validPlanItems.map((item) => ({
            productId: item.product!.id,
            quantity: item.quantity || "1",
            quantityUnit: item.quantityUnit,
          })),
        }

        if (withTransition && transitionDays > 0) {
          body.transitionDays = transitionDays
        }

        const res = await fetch(`/api/dogs/${dogId}/food`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const data = await res.json()
          toast.error(data.error ?? "Failed to save plan")
          return
        }
      } else if (isQuantityOnly && currentPlan) {
        const items = validPlanItems
          .filter((i) => i.originalId)
          .map((item) => ({
            id: item.originalId!,
            quantity: item.quantity || "1",
            quantityUnit: item.quantityUnit,
          }))

        const res = await fetch(`/api/food/groups/${currentPlan.planGroupId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        })

        if (!res.ok) {
          const data = await res.json()
          toast.error(data.error ?? "Failed to update quantities")
          return
        }
      }

      toast.success("Routine saved")
      onSaved()
    } catch (err) {
      console.error("Failed to save routine:", err)
      toast.error("Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  async function handleEndTransition(): Promise<void> {
    if (!currentPlan) return
    setSaving(true)
    try {
      const res = await fetch(`/api/food/groups/${currentPlan.planGroupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end_transition" }),
      })
      if (!res.ok) {
        toast.error("Failed to end transition")
        return
      }
      toast.success("Transition ended")
      onSaved()
    } catch (err) {
      console.error("Failed to end transition:", err)
      toast.error("Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  // Check if main food changed for showing transition step
  const showTransitionOption = currentPlan
    ? mainFoodChanged(planItems, currentPlan.isTransitioning && currentPlan.targetItems ? currentPlan.targetItems : currentPlan.items)
    : false

  // ── Transition step view ────────────────────────────────────────────

  if (view === "transition") {
    // Build product name lookup
    const productNames = new Map<string, string>()
    for (const item of planItems) {
      if (item.product) {
        productNames.set(item.product.id, `${item.product.brandName} ${item.product.name}`)
      }
    }
    if (currentPlan) {
      for (const item of currentPlan.items) {
        productNames.set(item.productId, `${item.brandName} ${item.productName}`)
      }
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 pt-6">
        <h2 className="text-lg font-semibold">Food Transition</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Gradually mix old and new food to ease the switch.
        </p>

        {/* Transition options */}
        <div className="mt-4">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Transition Length
          </Label>
          <Select
            value={String(transitionDays)}
            onValueChange={(v) => setTransitionDays(Number(v))}
          >
            <SelectTrigger className="mt-1.5 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d} day{d > 1 ? "s" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Daily breakdown table */}
        {transitionPreview.length > 0 && (
          <div className="mt-4 space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Daily Breakdown
            </Label>
            <div className="rounded-lg border divide-y text-sm">
              {transitionPreview.map((day, idx) => (
                <div key={day.date} className="px-3 py-2.5">
                  <div className="text-xs font-medium text-muted-foreground mb-1.5">
                    Day {idx + 1} — {format(parseISO(day.date), "EEE, MMM d")}
                  </div>
                  <div className="space-y-1">
                    {day.items.map((item, i) => {
                      const perMeal = Math.round((parseFloat(item.quantity) / mealsPerDay) * 100) / 100
                      return (
                        <div key={`${item.productId}-${i}`} className="flex items-center justify-between gap-2">
                          <span className="truncate text-foreground">
                            {productNames.get(item.productId) ?? item.productId}
                          </span>
                          <span className="shrink-0 text-muted-foreground tabular-nums">
                            {item.quantity} {item.quantityUnit}
                            {mealsPerDay > 1 && (
                              <span className="text-xs ml-1">({perMeal}/meal)</span>
                            )}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              {/* Day after transition — full new quantities */}
              {transitionPreview.length > 0 && (() => {
                const afterDate = shiftDate(transitionPreview[transitionPreview.length - 1].date, 1)
                const newMainItems = planItems.filter((i) => i.product && isMainFoodType(i.product.type))
                const newNonMainItems = planItems.filter((i) => i.product && !isMainFoodType(i.product.type))
                const allNewItems = [...newMainItems, ...newNonMainItems]
                return (
                  <div className="px-3 py-2.5 bg-item-hover">
                    <div className="text-xs font-medium text-muted-foreground mb-1.5">
                      Day {transitionPreview.length + 1} — {format(parseISO(afterDate), "EEE, MMM d")} onwards
                    </div>
                    <div className="space-y-1">
                      {allNewItems.map((item, i) => {
                        const dailyQty = item.quantity || "1"
                        const perMeal = Math.round((parseFloat(dailyQty) / mealsPerDay) * 100) / 100
                        return (
                          <div key={`after-${item.product!.id}-${i}`} className="flex items-center justify-between gap-2">
                            <span className="truncate text-foreground">
                              {productNames.get(item.product!.id) ?? item.product!.name}
                            </span>
                            <span className="shrink-0 text-muted-foreground tabular-nums">
                              {dailyQty} {item.quantityUnit}
                              {mealsPerDay > 1 && (
                                <span className="text-xs ml-1">({perMeal}/meal)</span>
                              )}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        )}

        {/* Save buttons */}
        <div className="mt-6 flex gap-2">
          <Button
            variant="outline"
            onClick={() => setView("edit")}
            className="flex-1"
          >
            Back
          </Button>
          <Button
            onClick={() => handleSave(true)}
            disabled={saving || transitionDays <= 0}
            className="flex-1"
          >
            {saving ? "Saving..." : "Setup transition"}
          </Button>
        </div>
      </div>
    )
  }

  // ── Edit view ───────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1">
      {/* ── Form ───────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden md:pr-6">
      <div className="flex-1 space-y-5 overflow-y-auto px-6 pt-6 pb-4">
      {/* Header (inside scrollable form column) */}
      <div>
        <h2 className="text-lg font-semibold">Edit routine</h2>
        <p className="text-sm text-muted-foreground">Set your dog&apos;s daily food and supplements.</p>
      </div>

      {/* Active transition banner */}
      {currentPlan?.isTransitioning && (
        <div className="rounded-lg border border-dashed border-primary bg-score-excellent-bg px-3 py-2.5">
          <p className="text-sm font-medium text-foreground">
            Transition in progress ({currentPlan.transitionDays}-day)
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Editing will replace the current transition plan.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleEndTransition}
            disabled={saving}
            className="mt-2"
          >
            End transition now
          </Button>
        </div>
      )}

      {/* ── Food & Supplements ──────────────────────────────────────────── */}
      <div className="space-y-3">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Food & Supplements
        </Label>
        {planItems.map((item) => {
          const detail = item.product ? productDetails.get(item.product.id) : undefined
          const calorieContent = detail?.calorieContent ?? item.product?.calorieContent ?? null
          const unitOptions: AvailableUnit[] =
            getAvailableUnits(calorieContent, item.product?.type, item.product?.format) ||
            QUANTITY_UNIT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))

          return (
          <div key={item.key} className="space-y-2 rounded-lg border p-3">
            <ProductPicker
              value={item.product}
              onChange={(product) => updatePlanItem(item.key, { product })}
              dogId={dogId}
            />
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.25"
                min="0"
                placeholder="Qty"
                value={item.quantity}
                onChange={(e) => updatePlanItem(item.key, { quantity: e.target.value })}
                className="h-9 w-20"
              />
              <Select
                value={item.quantityUnit}
                onValueChange={(v) => updatePlanItem(item.key, { quantityUnit: v })}
              >
                <SelectTrigger size="sm" className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {unitOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">/day</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => removePlanItem(item.key)}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                aria-label="Remove item"
              >
                <LiaTrashAltSolid className="size-4" />
              </Button>
            </div>
          </div>
          )
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPlanItems((prev) => [...prev, createPlanItem()])}
          className="w-full"
        >
          <LiaPlusSolid className="size-4" />
          Add item
        </Button>
      </div>

      </div>

      {/* ── Save (pinned bottom) ─────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border px-3 py-3">
      {showTransitionOption ? (
        <div className="flex gap-4">
          {onCancel && (
            <Button variant="outline" onClick={onCancel} className="flex-1">
              Cancel
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => handleSave(false)}
            disabled={saving}
            className="flex-1"
          >
            {saving ? "Saving..." : "No transition"}
          </Button>
          <Button
            onClick={() => setView("transition")}
            className="flex-1"
          >
            Next: transition plan
          </Button>
        </div>
      ) : (
        <div className="flex gap-4">
          {onCancel && (
            <Button variant="outline" onClick={onCancel} className="flex-1">
              Cancel
            </Button>
          )}
          <Button onClick={() => handleSave(false)} disabled={saving} className="flex-1">
            {saving ? "Saving..." : "Save routine"}
          </Button>
        </div>
      )}
      </div>
      </div>

      {/* ── Nutrition sidebar (desktop only) ──────────────────────────── */}
      <div className="hidden shrink-0 border-l border-border bg-secondary md:flex md:w-[264px] md:rounded-r-lg overflow-y-auto">
        <div className="my-auto w-full min-w-0 px-5 py-8">
          <NutritionLabel
            data={nutrition}
            loading={planItems.some((i) => i.product) && productDetails.size === 0}
            ingredientLists={ingredientsByProduct}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Modal wrapper ───────────────────────────────────────────────────────────

interface RoutineEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dogId: string
  currentPlan: ActivePlan | null
  onSaved: () => void
}

export function RoutineEditor({
  open,
  onOpenChange,
  dogId,
  currentPlan,
  onSaved,
}: RoutineEditorProps): React.ReactElement {
  function handleSaved(): void {
    onOpenChange(false)
    onSaved()
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Edit routine"
      description="Set your dog's daily food and supplements."
      size="wide"
    >
      {open && (
        <RoutineEditorContent
          dogId={dogId}
          currentPlan={currentPlan}
          onSaved={handleSaved}
          onCancel={() => onOpenChange(false)}
        />
      )}
    </ResponsiveModal>
  )
}
