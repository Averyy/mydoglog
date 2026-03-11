"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { largeImageUrl } from "@/lib/utils"

interface FoodScoreCardProps {
  brandName: string
  productName: string
  imageUrl: string | null
  isCurrent?: boolean
  dateLabel?: string
  className?: string
  children?: React.ReactNode
}

export function FoodScoreCard({
  brandName,
  productName,
  imageUrl,
  isCurrent,
  dateLabel,
  className,
  children,
}: FoodScoreCardProps): React.ReactElement {
  return (
    <Card className={`overflow-hidden gap-0 py-0 ${className ?? ""}`}>
      {/* Product image area */}
      <div className="relative flex items-center justify-center bg-muted px-3 py-3">
        {imageUrl ? (
          <img
            src={largeImageUrl(imageUrl)}
            alt={productName}
            className="h-28 w-auto object-contain rounded-md mix-blend-multiply dark:mix-blend-normal"
          />
        ) : (
          <div className="flex h-28 items-center justify-center">
            <p className="text-xs text-muted-foreground">No image</p>
          </div>
        )}
        {isCurrent && (
          <Badge className="absolute top-2 right-2 text-[10px]">
            Current
          </Badge>
        )}
      </div>

      {/* Product details */}
      <CardContent className="flex flex-1 flex-col px-4 pt-3 pb-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-text-tertiary">
          {brandName}
        </p>
        <p className="mt-0.5 text-sm font-semibold leading-snug text-foreground line-clamp-2">
          {productName}
        </p>
        {dateLabel && (
          <p className="mt-1 text-[11px] text-text-tertiary pb-3">
            {dateLabel}
          </p>
        )}
        {children && <div className="mt-auto flex flex-col">{children}</div>}
      </CardContent>
    </Card>
  )
}
