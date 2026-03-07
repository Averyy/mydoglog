"use client"

import { useCallback, useEffect, useState } from "react"
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
import { WhenInput } from "@/components/when-input"
import { ResponsiveModal } from "@/components/responsive-modal"
import { toast } from "sonner"
import { format } from "date-fns"
import type { ProductSummary } from "@/lib/types"

interface LastTreatResponse {
  productId: string
  productName: string
  brandName: string
  brandId: string
  type: string | null
  channel: string | null
  lifestage: string | null
  imageUrl: string | null
  isDiscontinued: boolean
  lastUsed: string | null
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

// Module-level cache: last selected treat per dog (with TTL)
const TREAT_CACHE_TTL = 30 * 60 * 1000 // 30 minutes
const lastTreatCache = new Map<string, { product: ProductSummary; timestamp: number }>()

function getCachedTreat(dogId: string): ProductSummary | null {
  const entry = lastTreatCache.get(dogId)
  if (!entry) return null
  if (Date.now() - entry.timestamp > TREAT_CACHE_TTL) {
    lastTreatCache.delete(dogId)
    return null
  }
  return entry.product
}

function setCachedTreat(dogId: string, product: ProductSummary): void {
  lastTreatCache.set(dogId, { product, timestamp: Date.now() })
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
  const [product, setProduct] = useState<ProductSummary | null>(
    getCachedTreat(dogId),
  )
  const [quantity, setQuantity] = useState("1")
  const [quantityUnit, setQuantityUnit] = useState("piece")
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [time, setTime] = useState<string | null>(format(new Date(), "HH:mm"))
  const [saving, setSaving] = useState(false)

  const fetchLastTreat = useCallback(async () => {
    // Skip fetch if we already have a cached value
    if (getCachedTreat(dogId)) return
    try {
      const res = await fetch(`/api/dogs/${dogId}/treats?recent=1`)
      if (res.ok) {
        const data = await res.json() as LastTreatResponse[]
        if (data.length > 0) {
          const last = data[0]
          const p: ProductSummary = {
            id: last.productId,
            name: last.productName,
            brandName: last.brandName,
            brandId: last.brandId,
            type: last.type,
            channel: last.channel,
            lifestage: last.lifestage,
            imageUrl: last.imageUrl,
            isDiscontinued: last.isDiscontinued,
            calorieContent: null,
          }
          setCachedTreat(dogId, p)
          setProduct(p)
        }
      }
    } catch {
      // Silently fail
    }
  }, [dogId])

  useEffect(() => {
    fetchLastTreat()
    setDate(format(new Date(), "yyyy-MM-dd"))
    setTime(format(new Date(), "HH:mm"))
  }, [fetchLastTreat])

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
      setCachedTreat(dogId, product)
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
      {/* Product selection */}
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
          dogId={dogId}
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
