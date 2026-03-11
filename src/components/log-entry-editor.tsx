"use client"

import { useState } from "react"
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
import { FecalScorePickerHorizontal } from "@/components/fecal-score-picker"
import { ItchScorePicker, BODY_AREAS } from "@/components/itchiness-logger"
import { CollapsibleNotes } from "@/components/collapsible-notes"
import { WhenInput } from "@/components/when-input"
import { ProductPicker } from "@/components/product-picker"
import { ResponsiveModal } from "@/components/responsive-modal"
import { toast } from "sonner"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import type { LogFeedEntry, ProductSummary } from "@/lib/types"

const UNIT_OPTIONS = [
  { value: "piece", label: "piece" },
  { value: "cup", label: "cup" },
  { value: "g", label: "g" },
  { value: "scoop", label: "scoop" },
  { value: "tbsp", label: "tbsp" },
  { value: "tsp", label: "tsp" },
]

interface LogEntryEditorProps {
  entry: LogFeedEntry
  dogId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: () => void
}

function getApiPath(entry: LogFeedEntry): string {
  switch (entry.type) {
    case "poop":
      return `/api/poop/${entry.id}`
    case "itch":
      return `/api/itchiness/${entry.id}`
    case "treat":
      return `/api/treats/${entry.id}`
  }
}

function getTitle(type: LogFeedEntry["type"]): string {
  switch (type) {
    case "poop":
      return "Edit stool log"
    case "itch":
      return "Edit itch log"
    case "treat":
      return "Edit treat log"
  }
}

export function LogEntryEditor({
  entry,
  dogId,
  open,
  onOpenChange,
  onUpdated,
}: LogEntryEditorProps): React.ReactElement {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={getTitle(entry.type)}
    >
      {open && (
        <EditorContent
          entry={entry}
          dogId={dogId}
          onClose={() => onOpenChange(false)}
          onUpdated={onUpdated}
        />
      )}
    </ResponsiveModal>
  )
}

function EditorContent({
  entry,
  dogId,
  onClose,
  onUpdated,
}: {
  entry: LogFeedEntry
  dogId: string
  onClose: () => void
  onUpdated: () => void
}): React.ReactElement {
  switch (entry.type) {
    case "poop":
      return <PoopEditor entry={entry} onClose={onClose} onUpdated={onUpdated} />
    case "itch":
      return <ItchEditor entry={entry} onClose={onClose} onUpdated={onUpdated} />
    case "treat":
      return <TreatEditor entry={entry} dogId={dogId} onClose={onClose} onUpdated={onUpdated} />
  }
}

// ── Poop Editor ──────────────────────────────────────────────────────

function PoopEditor({
  entry,
  onClose,
  onUpdated,
}: {
  entry: LogFeedEntry
  onClose: () => void
  onUpdated: () => void
}): React.ReactElement {
  const [score, setScore] = useState<number | null>(entry.data.firmnessScore as number)
  const [date, setDate] = useState(entry.date)
  const [time, setTime] = useState<string | null>(
    entry.datetime ? format(new Date(entry.datetime), "HH:mm") : null,
  )
  const [notes, setNotes] = useState((entry.data.notes as string) ?? "")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleSave(): Promise<void> {
    if (score === null) return
    setSaving(true)
    try {
      const datetime =
        date && time ? new Date(`${date}T${time}`).toISOString() : null
      const res = await fetch(getApiPath(entry), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firmnessScore: score, date, datetime, notes: notes.trim() || null }),
      })
      if (!res.ok) {
        toast.error("Failed to update")
        return
      }
      toast.success("Log updated")
      onUpdated()
      onClose()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(): Promise<void> {
    setDeleting(true)
    try {
      const res = await fetch(getApiPath(entry), { method: "DELETE" })
      if (!res.ok) {
        toast.error("Failed to delete")
        return
      }
      toast.success("Log deleted")
      onUpdated()
      onClose()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <FecalScorePickerHorizontal value={score} onChange={setScore} />
      <WhenInput date={date} onDateChange={setDate} time={time} onTimeChange={setTime} />
      <CollapsibleNotes value={notes} onChange={setNotes} label="Stool note" />
      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="destructive"
          onClick={handleDelete}
          disabled={saving || deleting}
          className=""
        >
          {deleting ? "Deleting..." : "Delete"}
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || deleting || score === null}
          className=""
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  )
}

// ── Itch Editor ──────────────────────────────────────────────────────

function ItchEditor({
  entry,
  onClose,
  onUpdated,
}: {
  entry: LogFeedEntry
  onClose: () => void
  onUpdated: () => void
}): React.ReactElement {
  const [score, setScore] = useState<number | null>(entry.data.score as number)
  const [bodyAreas, setBodyAreas] = useState<string[]>(
    (entry.data.bodyAreas as string[]) ?? [],
  )
  const [date, setDate] = useState(entry.date)
  const [time, setTime] = useState<string | null>(
    entry.datetime ? format(new Date(entry.datetime), "HH:mm") : null,
  )
  const [notes, setNotes] = useState((entry.data.notes as string) ?? "")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function toggleBodyArea(area: string): void {
    setBodyAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area],
    )
  }

  async function handleSave(): Promise<void> {
    if (score === null) return
    setSaving(true)
    try {
      const datetime =
        date && time ? new Date(`${date}T${time}`).toISOString() : null
      const res = await fetch(getApiPath(entry), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score,
          bodyAreas: bodyAreas.length > 0 ? bodyAreas : null,
          date,
          datetime,
          notes: notes.trim() || null,
        }),
      })
      if (!res.ok) {
        toast.error("Failed to update")
        return
      }
      toast.success("Log updated")
      onUpdated()
      onClose()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(): Promise<void> {
    setDeleting(true)
    try {
      const res = await fetch(getApiPath(entry), { method: "DELETE" })
      if (!res.ok) {
        toast.error("Failed to delete")
        return
      }
      toast.success("Log deleted")
      onUpdated()
      onClose()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <ItchScorePicker value={score} onChange={setScore} showNone />
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
      <WhenInput date={date} onDateChange={setDate} time={time} onTimeChange={setTime} />
      <CollapsibleNotes value={notes} onChange={setNotes} label="Itchiness note" />
      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="destructive"
          onClick={handleDelete}
          disabled={saving || deleting}
          className=""
        >
          {deleting ? "Deleting..." : "Delete"}
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || deleting || score === null}
          className=""
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  )
}

// ── Treat Editor ─────────────────────────────────────────────────────

function TreatEditor({
  entry,
  dogId,
  onClose,
  onUpdated,
}: {
  entry: LogFeedEntry
  dogId: string
  onClose: () => void
  onUpdated: () => void
}): React.ReactElement {
  const initialProduct: ProductSummary | null = entry.data.productId
    ? {
        id: entry.data.productId as string,
        name: (entry.data.productName as string) ?? "Unknown",
        brandName: (entry.data.brandName as string) ?? "",
        brandId: (entry.data.brandId as string) ?? "",
        type: "treat",
        format: null,
        channel: null,
        lifestage: null,
        imageUrl: (entry.data.imageUrl as string) ?? null,
        isDiscontinued: false,
        calorieContent: null,
      }
    : null

  const [product, setProduct] = useState<ProductSummary | null>(initialProduct)
  const [quantity, setQuantity] = useState(
    String(entry.data.quantity ?? "1"),
  )
  const [quantityUnit, setQuantityUnit] = useState(
    (entry.data.quantityUnit as string) ?? "piece",
  )
  const [date, setDate] = useState(entry.date)
  const [time, setTime] = useState<string | null>(
    entry.datetime ? format(new Date(entry.datetime), "HH:mm") : null,
  )
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleSave(): Promise<void> {
    if (!product) {
      toast.error("Select a product")
      return
    }
    setSaving(true)
    try {
      const datetime =
        date && time ? new Date(`${date}T${time}`).toISOString() : null
      const res = await fetch(getApiPath(entry), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          quantity: Number(quantity) || 1,
          quantityUnit,
          date,
          datetime,
        }),
      })
      if (!res.ok) {
        toast.error("Failed to update")
        return
      }
      toast.success("Log updated")
      onUpdated()
      onClose()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(): Promise<void> {
    setDeleting(true)
    try {
      const res = await fetch(getApiPath(entry), { method: "DELETE" })
      if (!res.ok) {
        toast.error("Failed to delete")
        return
      }
      toast.success("Log deleted")
      onUpdated()
      onClose()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Product
        </Label>
        <ProductPicker
          value={product}
          onChange={setProduct}
          productType="treat"
          placeholder="Search treats..."
          dogId={dogId}
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Quantity
        </Label>
        <div className="flex gap-2">
          <Input
            type="number"
            step="0.5"
            min="0"
            placeholder="Qty"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="min-w-0 w-0 flex-1"
          />
          <Select value={quantityUnit} onValueChange={setQuantityUnit}>
            <SelectTrigger className="min-w-0 w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNIT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <WhenInput date={date} onDateChange={setDate} time={time} onTimeChange={setTime} />
      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="destructive"
          onClick={handleDelete}
          disabled={saving || deleting}
          className=""
        >
          {deleting ? "Deleting..." : "Delete"}
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || deleting || !product}
          className=""
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  )
}
