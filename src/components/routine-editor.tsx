"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
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
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { ActivePlan, FeedingPlanItem, MedicationSummary, ProductSummary } from "@/lib/types"
import { QUANTITY_UNIT_OPTIONS, MEDICATION_REASON_LABELS } from "@/lib/labels"
import { computeNutrition, getAvailableUnits, type NutritionItem, type AvailableUnit } from "@/lib/nutrition"

// ─── Local types ─────────────────────────────────────────────────────────────

interface PlanItem {
  key: string
  product: ProductSummary | null
  quantity: string
  quantityUnit: string
  /** Original feeding period id (if editing existing item) */
  originalId?: string
}

interface MedicationItem {
  key: string
  name: string
  dosage: string
  reason: string
  /** Original medication id (if editing existing item) */
  originalId?: string
}

interface ProductDetail {
  guaranteedAnalysis: Record<string, number> | null
  calorieContent: string | null
  rawIngredientString: string | null
}

// ─── Constants ───────────────────────────────────────────────────────────────

const REASON_OPTIONS = Object.entries(MEDICATION_REASON_LABELS).map(
  ([value, label]) => ({ value, label }),
)

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

function createMedItem(from?: MedicationSummary): MedicationItem {
  if (from) {
    return {
      key: crypto.randomUUID(),
      name: from.name,
      dosage: from.dosage ?? "",
      reason: from.reason ?? "",
      originalId: from.id,
    }
  }
  return {
    key: crypto.randomUUID(),
    name: "",
    dosage: "",
    reason: "",
  }
}

function planItemsChanged(
  items: PlanItem[],
  original: FeedingPlanItem[],
): boolean {
  const validItems = items.filter((i) => i.product)
  if (validItems.length !== original.length) return true

  // Check if any product/quantity/unit/slot changed
  for (const item of validItems) {
    const orig = original.find((o) => o.id === item.originalId)
    if (!orig) return true
    if (item.product!.id !== orig.productId) return true
    if ((item.quantity || null) !== (orig.quantity || null)) return true
    if (item.quantity && item.quantityUnit !== (orig.quantityUnit ?? "cup")) return true
  }
  return false
}

// ─── Content component ───────────────────────────────────────────────────────

interface RoutineEditorContentProps {
  dogId: string
  currentPlan: ActivePlan | null
  currentMedications: MedicationSummary[]
  onSaved: () => void
}

export function RoutineEditorContent({
  dogId,
  currentPlan,
  currentMedications,
  onSaved,
}: RoutineEditorContentProps): React.ReactElement {
  const [planItems, setPlanItems] = useState<PlanItem[]>(() =>
    currentPlan && currentPlan.items.length > 0
      ? currentPlan.items.map((item) => createPlanItem(item))
      : [createPlanItem()],
  )
  const [medItems, setMedItems] = useState<MedicationItem[]>(() =>
    currentMedications.length > 0
      ? currentMedications.map((m) => createMedItem(m))
      : [],
  )
  const [saving, setSaving] = useState(false)

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
        const available = getAvailableUnits(calContent, item.product.type)
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
        name: item.product.brandName,
        ingredients: detail.rawIngredientString,
      })
    }
    return result
  }, [planItems, productDetails])

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

  // ── Medication handlers ───────────────────────────────────────────────

  function updateMedItem(key: string, updates: Partial<MedicationItem>): void {
    setMedItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...updates } : item)),
    )
  }

  function removeMedItem(key: string): void {
    setMedItems((prev) => prev.filter((item) => item.key !== key))
  }

  // ── Save logic ────────────────────────────────────────────────────────

  async function handleSave(): Promise<void> {
    const validPlanItems = planItems.filter((i) => i.product)
    const validMedItems = medItems.filter((m) => m.name.trim())

    if (validPlanItems.length === 0 && validMedItems.length === 0 && currentMedications.length === 0) {
      toast.error("Add at least one food or medication")
      return
    }

    setSaving(true)
    try {
      // a. Products: check if changed → create new plan group
      const productsChanged = currentPlan
        ? planItemsChanged(planItems, currentPlan.items)
        : validPlanItems.length > 0

      if (productsChanged && validPlanItems.length > 0) {
        const body = {
          mode: "starting_today",
          items: validPlanItems.map((item) => ({
            productId: item.product!.id,
            quantity: item.quantity || "1",
            quantityUnit: item.quantityUnit,
          })),
        }

        const res = await fetch(`/api/dogs/${dogId}/feeding`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const data = await res.json()
          toast.error(data.error ?? "Failed to save plan")
          return
        }
      }

      // b. Medications: diff against current
      await saveMedications(validMedItems)

      toast.success("Routine saved")
      onSaved()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  async function saveMedications(validMedItems: MedicationItem[]): Promise<void> {
    const today = new Date().toISOString().split("T")[0]
    const promises: Promise<Response>[] = []

    // New medications (no originalId)
    for (const item of validMedItems) {
      if (!item.originalId) {
        promises.push(
          fetch(`/api/dogs/${dogId}/medications`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: item.name.trim(),
              dosage: item.dosage.trim() || undefined,
              reason: item.reason || undefined,
            }),
          }),
        )
      }
    }

    // Modified medications (has originalId, fields changed)
    for (const item of validMedItems) {
      if (!item.originalId) continue
      const orig = currentMedications.find((m) => m.id === item.originalId)
      if (!orig) continue

      const updates: Record<string, string | null> = {}
      if (item.name.trim() !== orig.name) updates.name = item.name.trim()
      if ((item.dosage.trim() || null) !== (orig.dosage || null)) updates.dosage = item.dosage.trim() || null
      if ((item.reason || null) !== (orig.reason || null)) updates.reason = item.reason || null

      if (Object.keys(updates).length > 0) {
        promises.push(
          fetch(`/api/medications/${item.originalId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          }),
        )
      }
    }

    // Removed medications (originalId present in currentMedications but not in validMedItems)
    const keptIds = new Set(validMedItems.filter((m) => m.originalId).map((m) => m.originalId))
    for (const med of currentMedications) {
      if (!keptIds.has(med.id)) {
        promises.push(
          fetch(`/api/medications/${med.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endDate: today }),
          }),
        )
      }
    }

    const responses = await Promise.all(promises)
    const failed = responses.filter((r) => !r.ok)
    if (failed.length > 0) {
      throw new Error(`${failed.length} medication update(s) failed`)
    }
  }

  return (
    <div className="flex h-full">
      {/* ── Form ───────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6 pt-6 md:pr-6">
      {/* Header (inside scrollable form column) */}
      <div>
        <h2 className="text-lg font-semibold">Edit routine</h2>
        <p className="text-sm text-muted-foreground">Set your dog&apos;s daily food, supplements, and medications.</p>
      </div>
      {/* ── Food & Supplements ──────────────────────────────────────────── */}
      <div className="space-y-3">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Food & Supplements
        </Label>
        {planItems.map((item) => {
          const detail = item.product ? productDetails.get(item.product.id) : undefined
          const calorieContent = detail?.calorieContent ?? item.product?.calorieContent ?? null
          const unitOptions: AvailableUnit[] =
            getAvailableUnits(calorieContent, item.product?.type) ||
            QUANTITY_UNIT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))

          return (
          <div key={item.key} className="space-y-2 rounded-lg border p-3">
            <ProductPicker
              value={item.product}
              onChange={(product) => updatePlanItem(item.key, { product })}
              inline
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
                <Trash2 className="size-4" />
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
          <Plus className="size-4" />
          Add item
        </Button>
      </div>

      <Separator />

      {/* ── Medications ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Medications
        </Label>
        {medItems.length === 0 && (
          <p className="text-sm text-muted-foreground">No active medications</p>
        )}
        {medItems.map((item) => (
          <div key={item.key} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Medication name"
                value={item.name}
                onChange={(e) => updateMedItem(item.key, { name: e.target.value })}
                className="h-9 min-w-0 flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => removeMedItem(item.key)}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                aria-label="Remove medication"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. 16mg daily"
                value={item.dosage}
                onChange={(e) => updateMedItem(item.key, { dosage: e.target.value })}
                className="h-9 min-w-0 flex-1"
              />
              <Select
                value={item.reason}
                onValueChange={(v) => updateMedItem(item.key, { reason: v })}
              >
                <SelectTrigger size="sm" className="w-28">
                  <SelectValue placeholder="Reason" />
                </SelectTrigger>
                <SelectContent>
                  {REASON_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setMedItems((prev) => [...prev, createMedItem()])}
          className="w-full"
        >
          <Plus className="size-4" />
          Add medication
        </Button>
      </div>

      {/* ── Save ────────────────────────────────────────────────────────── */}
      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? "Saving..." : "Save routine"}
      </Button>
      </div>

      {/* ── Nutrition sidebar (desktop only) ──────────────────────────── */}
      <div className="hidden shrink-0 border-l border-border bg-secondary md:flex md:w-[264px] md:items-center md:rounded-r-lg">
        <div className="p-4">
          <NutritionLabel data={nutrition} ingredientLists={ingredientsByProduct} />
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
  currentMedications: MedicationSummary[]
  onSaved: () => void
}

export function RoutineEditor({
  open,
  onOpenChange,
  dogId,
  currentPlan,
  currentMedications,
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
      description="Set your dog's daily food, supplements, and medications."
      size="wide"
    >
      {open && (
        <RoutineEditorContent
          dogId={dogId}
          currentPlan={currentPlan}
          currentMedications={currentMedications}
          onSaved={handleSaved}
        />
      )}
    </ResponsiveModal>
  )
}
