"use client"

import { Card, CardContent } from "@/components/ui/card"
import { largeImageUrl } from "@/lib/utils"

interface FoodScoreCardProps {
  brandName: string
  productName: string
  imageUrl: string | null
  quantity?: string | null
  quantityUnit?: string | null
  /** Additional classes on the outer Card (e.g. "border-dashed") */
  className?: string
  children?: React.ReactNode
}

export function FoodScoreCard({
  brandName,
  productName,
  imageUrl,
  quantity,
  quantityUnit,
  className,
  children,
}: FoodScoreCardProps): React.ReactElement {
  return (
    <Card className={`overflow-hidden gap-0 py-0 ${className ?? ""}`}>
      {/* Product image showcase — warm khaki stage */}
      <div className="flex items-center justify-center bg-muted px-4 py-4">
        {imageUrl ? (
          <img
            src={largeImageUrl(imageUrl)}
            alt={productName}
            className="h-44 w-auto object-contain mix-blend-multiply"
          />
        ) : (
          <div className="flex h-44 items-center justify-center">
            <p className="text-xs text-muted-foreground">No image</p>
          </div>
        )}
      </div>

      {/* Product details */}
      <CardContent className="flex flex-1 flex-col pt-4 pb-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-text-tertiary">
          {brandName}
        </p>
        <p className="mt-0.5 text-[15px] font-semibold leading-snug text-foreground">
          {productName}
        </p>
        {quantity && (
          <p className="mt-1 text-xs text-muted-foreground">
            {quantity}{quantityUnit ? `${/^[a-zA-Z]{1,3}$/.test(quantityUnit) ? "" : " "}${quantityUnit}` : ""} daily
          </p>
        )}
        {children && <div className="mt-3 flex flex-1 flex-col">{children}</div>}
      </CardContent>
    </Card>
  )
}
