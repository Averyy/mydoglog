"use client"

import { useState } from "react"
import { FecalScorePickerMulti } from "@/components/fecal-score-picker"
import { ItchScorePickerMulti } from "@/components/itchiness-logger"
import { CollapsibleNotes } from "@/components/collapsible-notes"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

export interface ScorecardData {
  poopQuality: number[] | null
  itchSeverity: number[] | null
  notes: string | null
}

interface FoodScorecardFormProps {
  onSave: (data: ScorecardData) => void
  initialData?: Partial<ScorecardData>
}

export function FoodScorecardForm({
  onSave,
  initialData,
}: FoodScorecardFormProps): React.ReactElement {
  const [poopQuality, setPoopQuality] = useState<number[] | null>(
    initialData?.poopQuality ?? null,
  )
  const [itchSeverity, setItchSeverity] = useState<number[] | null>(
    initialData?.itchSeverity ?? null,
  )
  const [notes, setNotes] = useState(initialData?.notes ?? "")

  function handleSave(): void {
    onSave({
      poopQuality,
      itchSeverity,
      notes: notes.trim() || null,
    })
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Poop quality
        </Label>
        <FecalScorePickerMulti
          value={poopQuality}
          onChange={setPoopQuality}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Itch severity
        </Label>
        <ItchScorePickerMulti
          value={itchSeverity}
          onChange={setItchSeverity}
        />
      </div>

      <CollapsibleNotes value={notes} onChange={setNotes} label="Add note" placeholder="Optional observations..." />

      <div className="flex justify-end gap-2 pt-4">
        <Button onClick={handleSave} disabled={poopQuality == null || itchSeverity == null} className="flex-1">
          Save
        </Button>
      </div>
    </div>
  )
}
