"use client"

import { useState } from "react"
import { FecalScorePickerMulti } from "@/components/fecal-score-picker"
import { ItchScorePickerMulti } from "@/components/itchiness-logger"
import { EnumPicker } from "@/components/enum-picker"
import { CollapsibleNotes } from "@/components/collapsible-notes"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { ThumbsUp, ThumbsDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"


const VOMITING_OPTIONS = [
  { value: "none", label: "None" },
  { value: "occasional", label: "Occasional" },
  { value: "frequent", label: "Frequent" },
]

const PALATABILITY_OPTIONS = [
  { value: "loved", label: "Loved" },
  { value: "ate", label: "Ate" },
  { value: "reluctant", label: "Reluctant" },
  { value: "refused", label: "Refused" },
]

const IMPACT_OPTIONS = [
  { value: "better", label: "Better" },
  { value: "no_change", label: "No change" },
  { value: "worse", label: "Worse" },
]

const PRIMARY_REASON_OPTIONS = [
  { value: "bad_poop", label: "Bad poop" },
  { value: "vomiting", label: "Vomiting" },
  { value: "itchiness", label: "Itchiness" },
  { value: "refused_to_eat", label: "Refused food" },
  { value: "too_expensive", label: "Too expensive" },
  { value: "other", label: "Other" },
]

export interface ScorecardData {
  poopQuality: number[] | null
  itchSeverity: number[] | null
  vomiting: string | null
  palatability: string | null
  digestiveImpact: string | null
  itchinessImpact: string | null
  verdict: string | null
  primaryReason: string | null
  notes: string | null
}

/** "food" = full scorecard, "supplement" = digestive/itch impact + verdict, "backfill" = poop + itch ranges + notes */
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
  const [vomiting, setVomiting] = useState<string | null>(
    initialData?.vomiting ?? null,
  )
  const [palatability, setPalatability] = useState<string | null>(
    initialData?.palatability ?? null,
  )
  const [digestiveImpact, setDigestiveImpact] = useState<string | null>(
    initialData?.digestiveImpact ?? null,
  )
  const [itchinessImpact, setItchinessImpact] = useState<string | null>(
    initialData?.itchinessImpact ?? null,
  )
  const [verdict, setVerdict] = useState<string | null>(
    initialData?.verdict ?? null,
  )
  const [primaryReason, setPrimaryReason] = useState<string | null>(
    initialData?.primaryReason ?? null,
  )
  const [notes, setNotes] = useState(initialData?.notes ?? "")

  const showPrimaryReason = verdict === "mixed" || verdict === "down"

  function handleSave(): void {
    if (isBackfill) {
      onSave({
        poopQuality,
        itchSeverity,
        vomiting: null,
        palatability: null,
        digestiveImpact: null,
        itchinessImpact: null,
        verdict: null,
        primaryReason: null,
        notes: notes.trim() || null,
      })
      return
    }
    onSave({
      poopQuality: isFood ? poopQuality : null,
      itchSeverity: null,
      vomiting: isFood ? vomiting : null,
      palatability: isFood ? palatability : null,
      digestiveImpact: !isFood ? digestiveImpact : null,
      itchinessImpact,
      verdict,
      primaryReason: showPrimaryReason ? primaryReason : null,
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
            Vomiting
          </Label>
          <EnumPicker
            options={VOMITING_OPTIONS}
            value={vomiting}
            onChange={setVomiting}
          />
        </div>
      )}

      {isFood && (
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Palatability
          </Label>
          <EnumPicker
            options={PALATABILITY_OPTIONS}
            value={palatability}
            onChange={setPalatability}
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

      <Separator />

      <div className="space-y-2">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Overall verdict
        </Label>
        <div className="flex gap-2">
          {([
            { value: "up", icon: ThumbsUp, label: "Good" },
            { value: "mixed", icon: Minus, label: "Mixed" },
            { value: "down", icon: ThumbsDown, label: "Bad" },
          ] as const).map(({ value: v, icon: Icon, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => setVerdict(v)}
              className={cn(
                "flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2 transition-all",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none",
                verdict === v
                  ? v === "up"
                    ? "border-score-excellent bg-score-excellent-bg text-score-excellent"
                    : v === "mixed"
                      ? "border-score-fair bg-score-fair-bg text-score-fair"
                      : "border-score-critical bg-score-critical-bg text-score-critical"
                  : "border-border hover:bg-secondary",
              )}
            >
              <Icon className="size-5" />
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {showPrimaryReason && (
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Primary reason
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {PRIMARY_REASON_OPTIONS
              .filter((o) => isFood || o.value !== "bad_poop")
              .map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPrimaryReason(option.value)}
                className={cn(
                  "min-h-[36px] rounded-md border px-3 py-1.5 text-sm transition-all",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none",
                  primaryReason === option.value
                    ? "border-foreground bg-foreground text-background"
                    : "border-border hover:bg-secondary",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <CollapsibleNotes value={notes} onChange={setNotes} label="Add scorecard note" placeholder="Optional observations..." />

      <div className="flex gap-2 pt-4">
        {!hideSkip && (
          <Button variant="outline" onClick={onSkip} className="flex-1">
            {skipLabel}
          </Button>
        )}
        <Button onClick={handleSave} disabled={!verdict} className="flex-1">
          Save scorecard
        </Button>
      </div>
    </div>
  )
}
