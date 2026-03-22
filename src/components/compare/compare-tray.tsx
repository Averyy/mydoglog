"use client"

import { Button } from "@/components/ui/button"
import { smallImageUrl, stripBrandPrefix } from "@/lib/utils"
import type { ProductSummary } from "@/lib/types"
import type { MedicationProduct } from "@/lib/db/schema"
import { getDosageFormIcon } from "@/lib/medication-utils"
import { LiaTimesSolid } from "react-icons/lia"
import { ChevronUp } from "lucide-react"
import { useState } from "react"

type CompareMode = "food" | "meds"

interface CompareTrayProps {
  mode: CompareMode
  selectedProducts: ProductSummary[]
  selectedMedications: MedicationProduct[]
  onRemove: (id: string) => void
  onCompare: () => void
  onClear: () => void
}

export function CompareTray({
  mode,
  selectedProducts,
  selectedMedications,
  onRemove,
  onCompare,
  onClear,
}: CompareTrayProps): React.ReactElement {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set())
  const items = mode === "food" ? selectedProducts : selectedMedications
  const count = items.length

  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t border-border bg-compare-tray-bg backdrop-blur-sm md:bottom-0">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2 sm:px-4 sm:py-3">
        {/* Product slots: 4 equal cards */}
        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => {
            const item = items[i]
            if (!item) {
              return (
                <div
                  key={i}
                  className="flex h-12 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-foreground-muted-50"
                >
                  Empty
                </div>
              )
            }

            if (mode === "meds") {
              const med = item as MedicationProduct
              const Icon = getDosageFormIcon(med.dosageForm)
              return (
                <div
                  key={med.id}
                  className="relative flex h-12 items-center gap-1.5 rounded-md border border-border bg-bg-primary px-1.5"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded bg-secondary">
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium leading-tight">{med.name}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{med.genericName}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(med.id)}
                    aria-label={`Remove ${med.name}`}
                    className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-item-hover hover:text-foreground"
                  >
                    <LiaTimesSolid className="size-3" />
                  </button>
                </div>
              )
            }

            const product = item as ProductSummary
            return (
              <div
                key={product.id}
                className="relative flex h-12 items-center gap-1.5 rounded-md border border-border bg-bg-primary px-1.5"
              >
                <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded bg-muted-subtle">
                  {product.imageUrl && !failedImages.has(product.id) ? (
                    <img
                      src={smallImageUrl(product.imageUrl)}
                      alt={product.name}
                      className="size-full object-contain mix-blend-multiply dark:mix-blend-normal"
                      onError={() => setFailedImages((prev) => new Set(prev).add(product.id))}
                    />
                  ) : (
                    <span className="text-[8px] text-muted-foreground">?</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] text-muted-foreground">{product.brandName}</p>
                  <p className="truncate text-[11px] font-medium leading-tight">
                    {stripBrandPrefix(product.name, product.brandName)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(product.id)}
                  aria-label={`Remove ${product.name}`}
                  className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-item-hover hover:text-foreground"
                >
                  <LiaTimesSolid className="size-3" />
                </button>
              </div>
            )
          })}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
          <Button
            variant="default"
            size="sm"
            className="h-9 gap-1.5"
            onClick={onCompare}
            disabled={count < 2}
          >
            Compare ({count})
            <ChevronUp className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="hidden h-[env(safe-area-inset-bottom)] md:block" />
    </div>
  )
}
