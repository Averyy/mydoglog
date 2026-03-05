"use client"

import { Badge } from "@/components/ui/badge"
import { smallImageUrl } from "@/lib/utils"

interface ProductItemProps {
  brandName: string
  productName: string
  imageUrl?: string | null
  quantity?: string | null
  quantityUnit?: string | null
  mealSlot?: string | null
  children?: React.ReactNode
}

export function ProductItem({
  brandName,
  productName,
  imageUrl,
  quantity,
  quantityUnit,
  mealSlot,
  children,
}: ProductItemProps): React.ReactElement {
  const qtyLabel = quantity
    ? `${quantity}${quantityUnit ? ` ${quantityUnit}` : ""}`
    : null

  return (
    <div className="flex items-center gap-3 rounded-md border border-border-light px-3 py-2">
      {imageUrl ? (
        <div className="size-9 shrink-0 rounded-md bg-muted-subtle">
          <img
            src={smallImageUrl(imageUrl)}
            alt=""
            className="size-full rounded-md object-contain mix-blend-multiply"
          />
        </div>
      ) : (
        <div className="size-9 shrink-0 rounded-md bg-muted-subtle" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted-foreground">{brandName}</p>
        <p className="truncate text-sm font-medium">{productName}</p>
      </div>
      {qtyLabel && (
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          {qtyLabel}
        </Badge>
      )}
      {mealSlot && (
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {mealSlot}
        </Badge>
      )}
      {children}
    </div>
  )
}
