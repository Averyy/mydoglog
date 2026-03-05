"use client"

import { Badge } from "@/components/ui/badge"
import { Pill } from "lucide-react"
import { MEDICATION_REASON_LABELS } from "@/lib/labels"

interface MedicationItemProps {
  name: string
  dosage?: string | null
  reason?: string | null
}

export function MedicationItem({
  name,
  dosage,
  reason,
}: MedicationItemProps): React.ReactElement {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border-light px-3 py-2">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-score-critical-bg">
        <Pill className="size-5 text-muted-foreground fill-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
      </div>
      {reason && (
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {MEDICATION_REASON_LABELS[reason] ?? reason}
        </Badge>
      )}
      {dosage && (
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          {dosage}
        </Badge>
      )}
    </div>
  )
}
