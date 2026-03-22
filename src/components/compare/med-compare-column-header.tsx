"use client"

import type { MedicationProduct } from "@/lib/db/schema"
import { getDosageFormIcon } from "@/lib/medication-utils"
import { LiaTimesSolid } from "react-icons/lia"
import { cn } from "@/lib/utils"

interface MedCompareColumnHeaderProps {
  medication: MedicationProduct
  onRemove: (id: string) => void
}

export function MedCompareColumnHeader({
  medication,
  onRemove,
}: MedCompareColumnHeaderProps): React.ReactElement {
  const Icon = getDosageFormIcon(medication.dosageForm)

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2">
      <div className="relative shrink-0">
        <div className="flex size-10 items-center justify-center rounded-md bg-secondary sm:size-12">
          <Icon className="size-5 text-muted-foreground" />
        </div>
        <button
          type="button"
          onClick={() => onRemove(medication.id)}
          aria-label={`Remove ${medication.name}`}
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

      <div className="min-w-0">
        <p className="line-clamp-2 break-all text-[11px] font-medium leading-snug">
          {medication.name}
        </p>
        <p className="line-clamp-1 text-[10px] leading-snug text-muted-foreground">
          {medication.genericName}
        </p>
      </div>
    </div>
  )
}
