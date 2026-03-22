"use client"

import { useState } from "react"
import { cn, largeImageUrl } from "@/lib/utils"
import type { ProductDetail } from "@/lib/types"
import { LiaTimesSolid } from "react-icons/lia"

interface CompareColumnHeaderProps {
  product: ProductDetail
  onRemove: (id: string) => void
}

export function CompareColumnHeader({
  product,
  onRemove,
}: CompareColumnHeaderProps): React.ReactElement {
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2">
      {/* Image + X */}
      <div className="relative shrink-0">
        <div className="flex size-10 items-center justify-center overflow-hidden rounded-md bg-muted-subtle sm:size-12">
          {product.imageUrl && !imgFailed ? (
            <img
              src={largeImageUrl(product.imageUrl)}
              alt={product.name}
              className="size-full object-contain mix-blend-multiply dark:mix-blend-normal"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <span className="text-xs text-muted-foreground">?</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => onRemove(product.id)}
          aria-label={`Remove ${product.name}`}
          className={cn(
            "absolute -right-2.5 -top-2.5 flex size-8 items-center justify-center rounded-full",
            "text-background transition-colors",
          )}
        >
          <span className="flex size-4 items-center justify-center rounded-full bg-compare-close-bg hover:bg-foreground">
            <LiaTimesSolid className="size-2.5" />
          </span>
        </button>
      </div>

      {/* Brand + product name, same size, 2 lines max */}
      <p className="line-clamp-3 min-w-0 break-all text-[11px] leading-snug">
        {product.brandName} {product.name}
      </p>
    </div>
  )
}
