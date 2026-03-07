"use client"

import { useState, useEffect, useCallback } from "react"
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
import { WhenInput } from "@/components/when-input"
import { ResponsiveModal } from "@/components/responsive-modal"
import { toast } from "sonner"
import { format } from "date-fns"
import type { ProductSummary } from "@/lib/types"

interface RecentTreatProduct {
  productId: string
  productName: string
  brandName: string
  brandId: string
  type: string | null
  channel: string | null
  lifestage: string | null
  imageUrl: string | null
  isDiscontinued: boolean
}

interface TreatLoggerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dogId: string
  onSaved: () => void
}

interface TreatLoggerContentProps {
  dogId: string
  onSaved: () => void
}

const UNIT_OPTIONS = [
  { value: "piece", label: "piece" },
  { value: "cup", label: "cup" },
  { value: "g", label: "g" },
  { value: "scoop", label: "scoop" },
  { value: "tbsp", label: "tbsp" },
  { value: "tsp", label: "tsp" },
]

export function TreatLoggerContent({
  dogId,
  onSaved,
}: TreatLoggerContentProps): React.ReactElement {
  const [recentTreats, setRecentTreats] = useState<RecentTreatProduct[]>([])
  const [product, setProduct] = useState<ProductSummary | null>(null)
  const [quantity, setQuantity] = useState("1")
  const [quantityUnit, setQuantityUnit] = useState("piece")
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [time, setTime] = useState<string | null>(format(new Date(), "HH:mm"))
  const [saving, setSaving] = useState(false)

  const fetchRecent = useCallback(async () => {
    try {
      const res = await fetch(`/api/dogs/${dogId}/treats?recent=5`)
      if (res.ok) {
        const data = await res.json()
        setRecentTreats(data)
      }
    } catch {
      // Silently fail — recent treats are a convenience, not critical
    }
  }, [dogId])

  useEffect(() => {
    fetchRecent()
    setDate(format(new Date(), "yyyy-MM-dd"))
    setTime(format(new Date(), "HH:mm"))
  }, [fetchRecent])

  async function quickLog(recent: RecentTreatProduct): Promise<void> {
    setSaving(true)
    try {
      const now = new Date()
      const body = {
        productId: recent.productId,
        date: format(now, "yyyy-MM-dd"),
        datetime: now.toISOString(),
        quantity: "1",
        quantityUnit: "piece",
      }

      const res = await fetch(`/api/dogs/${dogId}/treats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        toast.error("Failed to log treat")
        return
      }

      toast.success("Treat logged")
      onSaved()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  async function handleSave(): Promise<void> {
    if (!product) {
      toast.error("Select a product")
      return
    }

    setSaving(true)
    try {
      const datetime =
        date && time ? new Date(`${date}T${time}`).toISOString() : undefined

      const body = {
        productId: product.id,
        date,
        datetime,
        quantity: quantity || "1",
        quantityUnit,
      }

      const res = await fetch(`/api/dogs/${dogId}/treats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        toast.error("Failed to log treat")
        return
      }

      toast.success("Treat logged")
      resetForm()
      onSaved()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  function resetForm(): void {
    setProduct(null)
    setQuantity("1")
    setQuantityUnit("piece")
  }

  return (
    <div className="space-y-5">
      {/* Recent treats — quick re-log */}
      {recentTreats.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Recent
          </Label>
          <div className="space-y-0.5">
            {recentTreats.map((treat) => (
              <button
                key={treat.productId}
                type="button"
                disabled={saving}
                onClick={() => quickLog(treat)}
                className="flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring outline-none"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {treat.productName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {treat.brandName}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  Tap to log
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {recentTreats.length > 0 && <Separator />}

      {/* New treat search */}
      <div className="space-y-2">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Search product
        </Label>
        <ProductPicker
          value={product}
          onChange={setProduct}
          productType="treat"
          placeholder="Search treats..."
          inline
        />
      </div>

      {/* Quantity */}
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

      {/* Date/time */}
      <WhenInput date={date} onDateChange={setDate} time={time} onTimeChange={setTime} />

      {/* Save */}
      <Button
        onClick={handleSave}
        disabled={saving || !product}
        className="mt-2 w-full"
      >
        {saving ? "Saving..." : "Save"}
      </Button>
    </div>
  )
}

export function TreatLogger({
  open,
  onOpenChange,
  dogId,
  onSaved,
}: TreatLoggerProps): React.ReactElement {
  function handleSaved(): void {
    onOpenChange(false)
    onSaved()
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Log treat"
      description="Record a treat or snack."
    >
      {open && <TreatLoggerContent dogId={dogId} onSaved={handleSaved} />}
    </ResponsiveModal>
  )
}
