"use client"

import { Badge } from "@/components/ui/badge"
import { cn, largeImageUrl, stripBrandPrefix } from "@/lib/utils"
import { PRODUCT_FORMAT_LABELS } from "@/lib/labels"
import type { ProductSummary } from "@/lib/types"
import { LiaCheckSolid, LiaPlusSolid } from "react-icons/lia"
import { memo, useState } from "react"

interface CompareProductCardProps {
  product: ProductSummary
  isSelected: boolean
  onToggle: (product: ProductSummary) => void
  disabled: boolean
}

export const CompareProductCard = memo(function CompareProductCard({
  product,
  isSelected,
  onToggle,
  disabled,
}: CompareProductCardProps): React.ReactElement {
  const [imgFailed, setImgFailed] = useState(false)
  const isDisabled = disabled && !isSelected

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={() => onToggle(product)}
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors",
        isSelected
          ? "border-primary shadow-sm ring-1 ring-compare-selected-ring"
          : "border-border hover:bg-item-hover",
        isDisabled && "cursor-not-allowed opacity-40",
      )}
    >
      {/* Image area */}
      <div className="relative aspect-square overflow-hidden bg-muted-subtle p-3">
        {product.imageUrl && !imgFailed ? (
          <img
            src={largeImageUrl(product.imageUrl)}
            alt={product.name}
            loading="lazy"
            className="absolute inset-0 m-auto h-3/4 w-3/4 object-contain mix-blend-multiply dark:mix-blend-normal"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-2xl text-muted-foreground">?</span>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-0.5 px-2.5 pb-2 pt-1.5">
        <span className="flex items-center justify-between gap-1">
          <span className="text-[11px] text-muted-foreground">
            {product.brandName}
          </span>
          {product.format && (
            <Badge variant="secondary" className="shrink-0 text-[9px] px-1.5 py-0">
              {PRODUCT_FORMAT_LABELS[product.format] ?? product.format}
            </Badge>
          )}
        </span>
        <span
          className="line-clamp-2 break-all text-xs font-medium leading-snug"
          title={stripBrandPrefix(product.name, product.brandName)}
        >
          {stripBrandPrefix(product.name, product.brandName)}
        </span>
      </div>

      {/* Status indicator */}
      <div className="flex items-center justify-center gap-1 border-t border-border px-2.5 py-1.5 text-xs font-medium">
        {isSelected ? (
          <>
            <LiaCheckSolid className="size-3.5 text-primary" />
            <span className="text-primary">Added</span>
          </>
        ) : (
          <>
            <LiaPlusSolid className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Add</span>
          </>
        )}
      </div>
    </button>
  )
})
