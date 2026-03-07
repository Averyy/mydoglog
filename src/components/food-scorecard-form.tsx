"use client"

import { useState } from "react"
import { FecalScorePickerMulti } from "@/components/fecal-score-picker"
import { ItchScorePickerMulti } from "@/components/itchiness-logger"
import { EnumPicker } from "@/components/enum-picker"
import { CollapsibleNotes } from "@/components/collapsible-notes"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

const IMPACT_OPTIONS = [
  { value: "better", label: "Better" },
  { value: "no_change", label: "No change" },
  { value: "worse", label: "Worse" },
]

export interface ScorecardData {
  poopQuality: number[] | null
  itchSeverity: number[] | null
  digestiveImpact: string | null
  itchinessImpact: string | null
  notes: string | null
}

/** "food" = poop + itch ranges + impact, "supplement" = digestive/itch impact only, "backfill" = poop + itch ranges + notes */
export type ScorecardFormMode = "food" | "supplement" | "backfill"

interface FoodScorecardFormProps {
  onSave: (data: ScorecardData) => void
  onSkip: () => void
  initialData?: Partial<ScorecardData>
  hideSkip?: boolean
  skipLabel?: string
  mode?: ScorecardFormMode
}

export function FoodScorecardForm({
  onSave,
  onSkip,
  initialData,
  hideSkip,
  skipLabel = "Skip",
  mode = "food",
}: FoodScorecardFormProps) {
  const isFood = mode === "food"
  const isBackfill = mode === "backfill"
  const [poopQuality, setPoopQuality] = useState<number[] | null>(
    initialData?.poopQuality ?? null,
  )
  const [itchSeverity, setItchSeverity] = useState<number[] | null>(
    initialData?.itchSeverity ?? null,
  )
  const [digestiveImpact, setDigestiveImpact] = useState<string | null>(
    initialData?.digestiveImpact ?? null,
  )
  const [itchinessImpact, setItchinessImpact] = useState<string | null>(
    initialData?.itchinessImpact ?? null,
  )
  const [notes, setNotes] = useState(initialData?.notes ?? "")

  function handleSave(): void {
    if (isBackfill) {
      onSave({
        poopQuality,
        itchSeverity,
        digestiveImpact: null,
        itchinessImpact: null,
        notes: notes.trim() || null,
      })
      return
    }
    onSave({
      poopQuality: isFood ? poopQuality : null,
      itchSeverity: isFood ? itchSeverity : null,
      digestiveImpact: !isFood ? digestiveImpact : null,
      itchinessImpact,
      notes: notes.trim() || null,
    })
  }

  if (isBackfill) {
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

        <div className="flex gap-2 pt-4">
          {!hideSkip && (
            <Button variant="outline" onClick={onSkip} className="flex-1">
              {skipLabel}
            </Button>
          )}
          <Button onClick={handleSave} disabled={poopQuality == null || itchSeverity == null} className="flex-1">
            Save
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {isFood && (
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Poop quality
          </Label>
          <FecalScorePickerMulti
            value={poopQuality}
            onChange={setPoopQuality}
          />
        </div>
      )}

      {isFood && (
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Itch severity
          </Label>
          <ItchScorePickerMulti
            value={itchSeverity}
            onChange={setItchSeverity}
          />
        </div>
      )}

      {!isFood && (
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Digestive impact
          </Label>
          <EnumPicker
            options={IMPACT_OPTIONS}
            value={digestiveImpact}
            onChange={setDigestiveImpact}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Itchiness impact
        </Label>
        <EnumPicker
          options={IMPACT_OPTIONS}
          value={itchinessImpact}
          onChange={setItchinessImpact}
        />
      </div>

      <CollapsibleNotes value={notes} onChange={setNotes} label="Add scorecard note" placeholder="Optional observations..." />

      <div className="flex gap-2 pt-4">
        {!hideSkip && (
          <Button variant="outline" onClick={onSkip} className="flex-1">
            {skipLabel}
          </Button>
        )}
        <Button onClick={handleSave} className="flex-1">
          Save scorecard
        </Button>
      </div>
    </div>
  )
}
