"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { FecalScorePickerHorizontal } from "@/components/fecal-score-picker"
import { ItchScorePicker, ITCH_SCORES, BODY_AREAS } from "@/components/itchiness-logger"
import { ProductPicker } from "@/components/product-picker"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CollapsibleNotes } from "@/components/collapsible-notes"
import { MedicationItem } from "@/components/medication-item"
import { ProductItem } from "@/components/product-item"
import { LiaCheckSolid, LiaTimesSolid } from "react-icons/lia"
import { toast } from "sonner"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { QUANTITY_UNIT_OPTIONS } from "@/lib/labels"
import { SCORES as FECAL_SCORES } from "@/components/fecal-score-guide"
import type { RoutineData, ProductSummary } from "@/lib/types"

interface DailyCheckInProps {
  dogId: string
  onSaved: () => void
}

interface TreatEntry {
  productId: string
  productName: string
  brandName: string
  imageUrl: string | null
  quantity: string
  quantityUnit: string
}

export function DailyCheckInContent({
  dogId,
  onSaved,
}: DailyCheckInProps): React.ReactElement {
  // Routine data
  const [routine, setRoutine] = useState<RoutineData | null>(null)
  const [routineLoading, setRoutineLoading] = useState(true)

  // Stool state
  const [stoolScore, setStoolScore] = useState<number | null>(null)
  const [stoolNotes, setStoolNotes] = useState("")

  // Itch state
  const [itchScore, setItchScore] = useState<number | null>(null)
  const [bodyAreas, setBodyAreas] = useState<string[]>([])
  const [itchNotes, setItchNotes] = useState("")

  // Treats state
  const [treats, setTreats] = useState<TreatEntry[]>([])

  // Existing check-in IDs for edit-on-reopen
  const [existingPoopId, setExistingPoopId] = useState<string | null>(null)
  const [existingItchId, setExistingItchId] = useState<string | null>(null)
  const [existingTreatIds, setExistingTreatIds] = useState<string[]>([])

  const [saving, setSaving] = useState(false)

  const isEditing = existingPoopId !== null || existingItchId !== null || existingTreatIds.length > 0
  const hasAnything = stoolScore !== null || itchScore !== null || treats.length > 0

  // Fetch today's existing check-in
  useEffect(() => {
    async function loadExisting(): Promise<void> {
      try {
        const res = await fetch(`/api/dogs/${dogId}/checkin/today`)
        if (!res.ok) return

        const data = await res.json()

        if (data.poop) {
          setStoolScore(data.poop.firmnessScore)
          setStoolNotes(data.poop.notes ?? "")
          setExistingPoopId(data.poop.id)
        }

        if (data.itchiness) {
          setItchScore(data.itchiness.score)
          setBodyAreas(data.itchiness.bodyAreas ?? [])
          setItchNotes(data.itchiness.notes ?? "")
          setExistingItchId(data.itchiness.id)
        }

        if (data.treats?.length > 0) {
          // Merge duplicate products by summing quantities
          const merged = new Map<string, TreatEntry>()
          for (const t of data.treats as { productId: string; productName: string; brandName: string; imageUrl: string | null; quantity: string | null; quantityUnit: string | null }[]) {
            const existing = merged.get(t.productId)
            const qty = Number(t.quantity ?? "1") || 1
            if (existing) {
              existing.quantity = String(Number(existing.quantity) + qty)
            } else {
              merged.set(t.productId, {
                productId: t.productId,
                productName: t.productName,
                brandName: t.brandName,
                imageUrl: t.imageUrl,
                quantity: String(qty),
                quantityUnit: t.quantityUnit ?? "piece",
              })
            }
          }
          setTreats(Array.from(merged.values()))
          setExistingTreatIds(data.treats.map((t: { id: string }) => t.id))
        }
      } catch {
        // Non-critical
      }
    }
    loadExisting()
  }, [dogId])

  // Fetch routine
  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const res = await fetch(`/api/dogs/${dogId}/food/routine`)
        if (res.ok) {
          const data: RoutineData = await res.json()
          setRoutine(data)
        }
      } catch {
        // Non-critical
      } finally {
        setRoutineLoading(false)
      }
    }
    load()
  }, [dogId])


  function toggleBodyArea(area: string): void {
    setBodyAreas((prev) =>
      prev.includes(area)
        ? prev.filter((a) => a !== area)
        : [...prev, area],
    )
  }

  function addTreat(product: ProductSummary): void {
    if (treats.some((t) => t.productId === product.id)) return
    setTreats((prev) => [
      ...prev,
      {
        productId: product.id,
        productName: product.name,
        brandName: product.brandName,
        imageUrl: product.imageUrl,
        quantity: "1",
        quantityUnit: "piece",
      },
    ])
  }

  function removeTreat(productId: string): void {
    setTreats((prev) => prev.filter((t) => t.productId !== productId))
  }

  function updateTreatQuantity(productId: string, quantity: string): void {
    setTreats((prev) =>
      prev.map((t) => (t.productId === productId ? { ...t, quantity } : t)),
    )
  }

  function updateTreatUnit(productId: string, unit: string): void {
    setTreats((prev) =>
      prev.map((t) => (t.productId === productId ? { ...t, quantityUnit: unit } : t)),
    )
  }

  async function handleSave(): Promise<void> {
    if (!hasAnything) return
    setSaving(true)

    const now = new Date()
    const todayStr = format(now, "yyyy-MM-dd")
    const nowIso = now.toISOString()

    try {
      // Delete existing entries first if editing
      const deletePromises: Promise<Response>[] = []
      if (existingPoopId) {
        deletePromises.push(fetch(`/api/poop/${existingPoopId}`, { method: "DELETE" }))
      }
      if (existingItchId) {
        deletePromises.push(fetch(`/api/itchiness/${existingItchId}`, { method: "DELETE" }))
      }
      for (const treatId of existingTreatIds) {
        deletePromises.push(fetch(`/api/treats/${treatId}`, { method: "DELETE" }))
      }
      if (deletePromises.length > 0) {
        await Promise.all(deletePromises)
      }

      // Create new entries
      const promises: Promise<Response>[] = []

      if (stoolScore !== null) {
        promises.push(
          fetch(`/api/dogs/${dogId}/poop`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entries: [
                {
                  firmnessScore: stoolScore,
                  notes: stoolNotes.trim() || undefined,
                },
              ],
              date: todayStr,
              datetime: nowIso,
            }),
          }),
        )
      }

      if (itchScore !== null) {
        promises.push(
          fetch(`/api/dogs/${dogId}/itchiness`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              score: itchScore,
              bodyAreas: bodyAreas.length > 0 ? bodyAreas : undefined,
              date: todayStr,
              datetime: nowIso,
              notes: itchNotes.trim() || undefined,
            }),
          }),
        )
      }

      for (const treat of treats) {
        promises.push(
          fetch(`/api/dogs/${dogId}/treats`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              productId: treat.productId,
              quantity: treat.quantity,
              quantityUnit: treat.quantityUnit,
              date: todayStr,
              datetime: nowIso,
            }),
          }),
        )
      }

      const results = await Promise.all(promises)
      const failed = results.filter((r) => !r.ok)

      if (failed.length > 0) {
        toast.error(`${failed.length} of ${results.length} entries failed to save`)
      } else {
        toast.success(isEditing ? "Check-in updated" : "Check-in saved")
        onSaved()
      }
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  // Badge helpers for accordion triggers
  const noneBadge = (
    <Badge variant="outline" className="ml-auto mr-2 text-muted-foreground text-[10px]">
      None
    </Badge>
  )

  const stoolBadge = stoolScore !== null ? (
    <Badge variant="outline" className="ml-auto mr-2 border-primary text-primary text-[10px]">
      <LiaCheckSolid className="size-3" />
      {FECAL_SCORES.find((s) => s.score === stoolScore)?.label}
    </Badge>
  ) : noneBadge

  const itchBadge = itchScore !== null ? (
    <Badge variant="outline" className="ml-auto mr-2 border-primary text-primary text-[10px]">
      <LiaCheckSolid className="size-3" />
      {ITCH_SCORES.find((s) => s.score === itchScore)?.label}
    </Badge>
  ) : noneBadge

  const treatTotalPieces = treats.reduce((sum, t) => {
    if (t.quantityUnit === "piece") return sum + (Number(t.quantity) || 0)
    return -1
  }, 0)
  const treatBadge = treats.length > 0 ? (
    <Badge variant="outline" className="ml-auto mr-2 border-primary text-primary text-[10px]">
      <LiaCheckSolid className="size-3" />
      {treatTotalPieces > 0 ? `${treatTotalPieces} treat${treatTotalPieces !== 1 ? "s" : ""}` : "Treats"}
    </Badge>
  ) : noneBadge

  const mealPlanBadge = !routineLoading && routine && (routine.plan || routine.medications.length > 0) ? (
    <Badge variant="outline" className="ml-auto mr-2 border-primary text-primary text-[10px]">
      <LiaCheckSolid className="size-3" />
      Normal Routine
    </Badge>
  ) : null

  return (
    <div className="space-y-4">
      <Accordion type="single" defaultValue="stool" collapsible>
        {/* ── Stool ── */}
        <AccordionItem value="stool">
          <AccordionTrigger className="text-sm font-semibold">
            <span className="flex-1 text-left">Stool</span>
            {stoolBadge}
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2">
              <FecalScorePickerHorizontal value={stoolScore} onChange={setStoolScore} />
              <CollapsibleNotes value={stoolNotes} onChange={setStoolNotes} label="Add stool note" />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Itchiness ── */}
        <AccordionItem value="itchiness">
          <AccordionTrigger className="text-sm font-semibold">
            <span className="flex-1 text-left">Itchiness</span>
            {itchBadge}
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4">
              <ItchScorePicker value={itchScore} onChange={setItchScore} showNone />

              <div className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Affected areas
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {BODY_AREAS.map((area) => (
                    <button
                      key={area.value}
                      type="button"
                      onClick={() => toggleBodyArea(area.value)}
                      className={cn(
                        "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none",
                        bodyAreas.includes(area.value)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-secondary",
                      )}
                    >
                      {area.label}
                    </button>
                  ))}
                </div>
              </div>

              <CollapsibleNotes value={itchNotes} onChange={setItchNotes} label="Add itchiness note" placeholder="Optional observations..." />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Treats ── */}
        <AccordionItem value="treats">
          <AccordionTrigger className="text-sm font-semibold">
            <span className="flex-1 text-left">Treats</span>
            {treatBadge}
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4">
              {/* Search for new treat */}
              <ProductPicker
                value={null}
                onChange={(p) => p && addTreat(p)}
                productType="treat"
                placeholder="Search to add treats..."
                inline
                dogId={dogId}
              />

              {/* Added treats list */}
              {treats.length > 0 && (
                <div className="space-y-1.5">
                  {treats.map((treat, idx) => (
                    <ProductItem
                      key={`${treat.productId}-${idx}`}
                      brandName={treat.brandName}
                      productName={treat.productName}
                      imageUrl={treat.imageUrl}
                    >
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        aria-label={`Quantity for ${treat.productName}`}
                        value={treat.quantity}
                        onChange={(e) => updateTreatQuantity(treat.productId, e.target.value)}
                        className="h-8 w-16 shrink-0 text-center"
                      />
                      <Select
                        value={treat.quantityUnit}
                        onValueChange={(v) => updateTreatUnit(treat.productId, v)}
                      >
                        <SelectTrigger size="sm" className="w-[5.5rem] shrink-0" aria-label={`Unit for ${treat.productName}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {QUANTITY_UNIT_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <button
                        type="button"
                        aria-label={`Remove ${treat.productName}`}
                        onClick={() => removeTreat(treat.productId)}
                        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <LiaTimesSolid className="size-4" />
                      </button>
                    </ProductItem>
                  ))}
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Routine (read-only) ── */}
        <AccordionItem value="routine">
          <AccordionTrigger className="text-sm font-semibold">
            <span className="flex-1 text-left">Routine</span>
            {mealPlanBadge}
          </AccordionTrigger>
          <AccordionContent>
            {routineLoading ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : !routine || (!routine.plan && routine.medications.length === 0) ? (
              <p className="text-xs text-muted-foreground">No active routine set up.</p>
            ) : (
              <div className="space-y-3">
                {/* Food & supplement items */}
                {routine.plan && routine.plan.items.length > 0 && (
                  <div className="space-y-1.5">
                    {routine.plan.items.map((item) => (
                      <ProductItem
                        key={item.id}
                        brandName={item.brandName}
                        productName={item.productName}
                        imageUrl={item.imageUrl}
                        quantity={item.quantity}
                        quantityUnit={item.quantityUnit}
                      />
                    ))}
                  </div>
                )}

                {/* Medications */}
                {routine.medications.length > 0 && (
                    <div className="space-y-1.5">
                      {routine.medications.map((med) => (
                        <MedicationItem
                          key={med.id}
                          name={med.name}
                          dosage={med.dosage}
                          reason={med.reason}
                        />
                      ))}
                    </div>
                )}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Save */}
      <Button
        onClick={handleSave}
        disabled={saving || !hasAnything}
        className="mt-2 w-full"
      >
        {saving ? "Saving..." : isEditing ? "Update check-in" : "Save check-in"}
      </Button>
    </div>
  )
}
