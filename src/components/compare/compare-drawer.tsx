"use client"

import type { ProductDetail } from "@/lib/types"
import type { MedicationProduct } from "@/lib/db/schema"
import { Button } from "@/components/ui/button"
import { CompareColumns } from "./compare-columns"
import { MedCompareColumns } from "./med-compare-columns"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"

type CompareMode = "food" | "meds"

interface CompareDrawerProps {
  open: boolean
  onClose: () => void
  mode: CompareMode
  products: ProductDetail[]
  medications: MedicationProduct[]
  loading: boolean
  error?: boolean
  onRetry?: () => void
  onRemove: (id: string) => void
}

export function CompareDrawer({
  open,
  onClose,
  mode,
  products,
  medications,
  loading,
  error = false,
  onRetry,
  onRemove,
}: CompareDrawerProps): React.ReactElement {
  const isMeds = mode === "meds"
  const itemCount = isMeds ? medications.length : products.length
  const title = isMeds ? "Compare Medications" : "Compare Foods"

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DrawerContent className="data-[vaul-drawer-direction=bottom]:max-h-[96vh]" aria-describedby={undefined}>
        <DrawerHeader className="sr-only">
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>

        <div className="flex-1 select-text overflow-auto overscroll-contain" data-vaul-no-drag>
          {loading ? (
            <div className="flex flex-col gap-4 p-6">
              <div className="grid grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-2">
                    <div className="size-12 animate-pulse rounded-lg bg-muted" />
                    <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                  </div>
                ))}
              </div>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <p className="text-sm text-muted-foreground">
                Failed to load details.
              </p>
              {onRetry && (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  Try again
                </Button>
              )}
            </div>
          ) : itemCount < 2 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Select at least 2 {isMeds ? "medications" : "products"} to compare.
            </div>
          ) : isMeds ? (
            <MedCompareColumns medications={medications} onRemove={onRemove} />
          ) : (
            <CompareColumns products={products} onRemove={onRemove} />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
