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

interface ExistingPoopEntry {
  id: string
  firmnessScore: number
  notes: string | null
}

interface ExistingItchEntry {
  id: string
  score: number
  bodyAreas: string[] | null
  notes: string | null
}

interface ExistingTreatEntry {
  id: string
  productId: string
  productName: string
  brandName: string
  imageUrl: string | null
  quantity: string | null
  quantityUnit: string | null
}

export function DailyCheckInContent({
  dogId,
  onSaved,
}: DailyCheckInProps): React.ReactElement {
  // Routine data
  const [routine, setRoutine] = useState<RoutineData | null>(null)
  const [routineLoading, setRoutineLoading] = useState(true)

  // Existing entries (read-only)
  const [existingPoop, setExistingPoop] = useState<ExistingPoopEntry[]>([])
  const [existingItch, setExistingItch] = useState<ExistingItchEntry[]>([])
  const [existingTreats, setExistingTreats] = useState<ExistingTreatEntry[]>([])

  // New entry state (only used when no existing entries for that category)
  const [stoolScore, setStoolScore] = useState<number | null>(null)
  const [stoolNotes, setStoolNotes] = useState("")
  const [itchScore, setItchScore] = useState<number | null>(null)
  const [bodyAreas, setBodyAreas] = useState<string[]>([])
  const [itchNotes, setItchNotes] = useState("")
  const [treats, setTreats] = useState<TreatEntry[]>([])

  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const hasExistingPoop = existingPoop.length > 0
  const hasExistingItch = existingItch.length > 0
  const hasExistingTreats = existingTreats.length > 0

  // Whether the user has entered anything new
  const hasNewStool = !hasExistingPoop && stoolScore !== null
  const hasNewItch = !hasExistingItch && itchScore !== null
  const hasNewTreats = !hasExistingTreats && treats.length > 0
  const hasAnythingNew = hasNewStool || hasNewItch || hasNewTreats

  // Fetch today's existing entries
  useEffect(() => {
    async function loadExisting(): Promise<void> {
      try {
        const res = await fetch(`/api/dogs/${dogId}/checkin/today`)
        if (!res.ok) return

        const data = await res.json()

        if (data.poopEntries?.length > 0) {
          setExistingPoop(data.poopEntries)
        }

        if (data.itchinessEntries?.length > 0) {
          setExistingItch(data.itchinessEntries)
        }

        if (data.treats?.length > 0) {
          setExistingTreats(data.treats)
        }
      } catch (err) {
        console.error("Failed to load existing check-in data:", err)
      } finally {
        setLoaded(true)
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
    if (!hasAnythingNew) return
    setSaving(true)

    const now = new Date()
    const todayStr = format(now, "yyyy-MM-dd")
    const nowIso = now.toISOString()

    try {
      const promises: Promise<Response>[] = []

      if (hasNewStool) {
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

      if (hasNewItch) {
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

      if (hasNewTreats) {
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
      }

      const results = await Promise.all(promises)
      const failed = results.filter((r) => !r.ok)

      if (failed.length > 0) {
        toast.error(`${failed.length} of ${results.length} entries failed to save`)
      } else {
        toast.success("Check-in saved")
        onSaved()
      }
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  // Badge helpers
  const noneBadge = (
    <Badge variant="outline" className="ml-auto mr-2 text-muted-foreground text-[10px]">
      None
    </Badge>
  )

  const loggedBadge = (label: string): React.ReactElement => (
    <Badge variant="outline" className="ml-auto mr-2 border-primary text-primary text-[10px]">
      <LiaCheckSolid className="size-3" />
      {label}
    </Badge>
  )

  // Stool badge
  const stoolBadge = hasExistingPoop
    ? loggedBadge(`${existingPoop.length} logged`)
    : stoolScore !== null
      ? loggedBadge(FECAL_SCORES.find((s) => s.score === stoolScore)?.label ?? "")
      : noneBadge

  // Itch badge
  const itchBadge = hasExistingItch
    ? loggedBadge(`${existingItch.length} logged`)
    : itchScore !== null
      ? loggedBadge(ITCH_SCORES.find((s) => s.score === itchScore)?.label ?? "")
      : noneBadge

  // Treat badge
  const allTreats = hasExistingTreats ? existingTreats : treats
  const allPieces = allTreats.length > 0 && allTreats.every((t) => ("quantityUnit" in t ? t.quantityUnit : null) === "piece")
  const treatTotalPieces = allPieces
    ? allTreats.reduce((sum, t) => sum + (Number(t.quantity ?? "1") || 0), 0)
    : 0
  const treatBadge = allTreats.length > 0
    ? loggedBadge(treatTotalPieces > 0 ? `${treatTotalPieces} treat${treatTotalPieces !== 1 ? "s" : ""}` : "Treats")
    : noneBadge

  const mealPlanBadge = !routineLoading && routine?.plan ? (
    <Badge variant="outline" className="ml-auto mr-2 border-primary text-primary text-[10px]">
      <LiaCheckSolid className="size-3" />
      Normal Routine
    </Badge>
  ) : null

  // Unique stool scores from existing entries
  const existingStoolScores = [...new Set(existingPoop.map((p) => p.firmnessScore))].sort((a, b) => a - b)
  // Unique itch scores from existing entries
  const existingItchScores = [...new Set(existingItch.map((i) => i.score))].sort((a, b) => a - b)
  // Unique body areas from existing entries
  const existingBodyAreas = [...new Set(existingItch.flatMap((i) => i.bodyAreas ?? []))]

  return (
    <div className="space-y-4">
      <Accordion type="single" collapsible>
        {/* ── Stool ── */}
        <AccordionItem value="stool">
          <AccordionTrigger className="text-sm font-semibold">
            <span className="flex-1 text-left">Stool</span>
            {stoolBadge}
          </AccordionTrigger>
          <AccordionContent>
            {hasExistingPoop ? (
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none" data-vaul-no-drag style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-x" }}>
                {existingStoolScores.map((score) => {
                  const s = FECAL_SCORES.find((f) => f.score === score)
                  if (!s) return null
                  return (
                    <div
                      key={s.score}
                      className="flex w-[144px] shrink-0 flex-col items-start gap-1.5 rounded-lg border bg-item-active p-2"
                      style={{ borderColor: s.color }}
                    >
                      <div className="flex aspect-[3/2] w-full items-center justify-center overflow-hidden rounded-md p-2">
                        <img
                          src={`/images/fecal-scores/score${s.score}.png`}
                          alt={`Score ${s.score}`}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <div className="flex w-full items-center gap-1.5">
                        <span
                          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                          style={{ backgroundColor: s.color }}
                        >
                          {s.score}
                        </span>
                        <span className="text-[11px] font-semibold leading-tight">
                          {s.label}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="space-y-2">
                <FecalScorePickerHorizontal value={stoolScore} onChange={setStoolScore} />
                <CollapsibleNotes value={stoolNotes} onChange={setStoolNotes} label="Add stool note" />
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* ── Itchiness ── */}
        <AccordionItem value="itchiness">
          <AccordionTrigger className="text-sm font-semibold">
            <span className="flex-1 text-left">Itchiness</span>
            {itchBadge}
          </AccordionTrigger>
          <AccordionContent>
            {hasExistingItch ? (
              <div className="space-y-3">
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none" data-vaul-no-drag style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-x" }}>
                  {existingItchScores.map((score) => {
                    const s = ITCH_SCORES.find((i) => i.score === score)
                    if (!s) return null
                    return (
                      <div
                        key={s.score}
                        className="flex w-[120px] shrink-0 flex-col items-start gap-1.5 rounded-lg border bg-item-active p-2"
                        style={{ borderColor: s.color }}
                      >
                        <div className="flex w-full items-center gap-1.5">
                          <span
                            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                            style={{ backgroundColor: s.color }}
                          >
                            {s.score}
                          </span>
                          <span className="text-[11px] font-semibold leading-tight">
                            {s.label}
                          </span>
                        </div>
                        <p className="w-full text-left text-[10px] leading-snug text-muted-foreground">
                          {s.description}
                        </p>
                      </div>
                    )
                  })}
                </div>
                {existingBodyAreas.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Affected areas
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {existingBodyAreas.map((areaValue) => {
                        const area = BODY_AREAS.find((a) => a.value === areaValue)
                        if (!area) return null
                        return (
                          <span
                            key={area.value}
                            className="rounded-md border border-primary bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground"
                          >
                            {area.label}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
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
                          "rounded-md border px-2.5 py-2.5 text-xs font-medium transition-all min-h-[28px]",
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
            )}
          </AccordionContent>
        </AccordionItem>

        {/* ── Treats ── */}
        <AccordionItem value="treats">
          <AccordionTrigger className="text-sm font-semibold">
            <span className="flex-1 text-left">Treats</span>
            {treatBadge}
          </AccordionTrigger>
          <AccordionContent>
            {hasExistingTreats ? (
              <div className="space-y-1.5">
                {existingTreats.map((treat) => (
                  <ProductItem
                    key={treat.id}
                    brandName={treat.brandName}
                    productName={treat.productName}
                    imageUrl={treat.imageUrl}
                    quantity={treat.quantity}
                    quantityUnit={treat.quantityUnit}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <ProductPicker
                  value={null}
                  onChange={(p) => p && addTreat(p)}
                  productType="treat"
                  placeholder="Search to add treats..."
                  dogId={dogId}
                />

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
                          className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground min-h-[28px] min-w-[28px] flex items-center justify-center"
                        >
                          <LiaTimesSolid className="size-4" />
                        </button>
                      </ProductItem>
                    ))}
                  </div>
                )}
              </div>
            )}
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
              <div className="space-y-1.5">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-md border border-border-light px-3 py-2">
                    <div className="size-9 animate-pulse rounded-md bg-muted shrink-0" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                      <div className="h-3.5 w-36 animate-pulse rounded bg-muted" />
                    </div>
                    <div className="h-5 w-12 animate-pulse rounded-full bg-muted shrink-0" />
                  </div>
                ))}
              </div>
            ) : !routine?.plan ? (
              <p className="text-xs text-muted-foreground">No active routine set up.</p>
            ) : (
              <div className="space-y-3 animate-in fade-in duration-300">
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

              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Save / Close */}
      {loaded && (
        <Button
          onClick={hasAnythingNew ? handleSave : onSaved}
          disabled={saving}
          variant={hasAnythingNew ? "default" : "outline"}
          className="mt-2 w-full"
        >
          {saving ? "Saving..." : hasAnythingNew ? "Save check-in" : "Close summary"}
        </Button>
      )}
    </div>
  )
}
