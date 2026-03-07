import { ThumbsUp, ThumbsDown, Minus } from "lucide-react"

const POOP_SCORE_COLORS: Record<number, string> = {
  1: "text-score-excellent", 2: "text-score-excellent",
  3: "text-score-good", 4: "text-score-fair",
  5: "text-score-fair", 6: "text-score-poor",
  7: "text-score-critical",
}

const ITCH_SCORE_COLORS: Record<number, string> = {
  0: "text-score-excellent", 1: "text-score-excellent", 2: "text-score-good",
  3: "text-score-fair", 4: "text-score-poor",
  5: "text-score-critical",
}

function poopScoreColor(avg: number): string {
  return POOP_SCORE_COLORS[Math.round(avg)] ?? "text-foreground"
}

function itchScoreColor(avg: number): string {
  return ITCH_SCORE_COLORS[Math.round(avg)] ?? "text-foreground"
}

function ImpactIcon({ impact }: { impact: "better" | "no_change" | "worse" }): React.ReactElement {
  switch (impact) {
    case "better":
      return <ThumbsUp className="size-4 text-score-excellent" />
    case "worse":
      return <ThumbsDown className="size-4 text-score-critical" />
    case "no_change":
      return <Minus className="size-4 text-muted-foreground" />
  }
}

interface ScoreGridProps {
  avgStool?: number | null
  avgItch?: number | null
  days: number
  stoolImpact?: "better" | "no_change" | "worse" | null
  itchImpact?: "better" | "no_change" | "worse" | null
}

export function ScoreGrid({
  avgStool,
  avgItch,
  days,
  stoolImpact,
  itchImpact,
}: ScoreGridProps): React.ReactElement {
  const hasNumericStool = avgStool != null
  const hasNumericItch = avgItch != null

  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      {/* Stool */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Stool</p>
        {hasNumericStool ? (
          <p className={`text-lg font-bold tabular-nums ${poopScoreColor(avgStool)}`}>
            {avgStool}
          </p>
        ) : stoolImpact ? (
          <div className="flex justify-center pt-0.5">
            <ImpactIcon impact={stoolImpact} />
          </div>
        ) : (
          <p className="text-lg font-bold text-muted-foreground">-</p>
        )}
      </div>

      {/* Itch */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Itch</p>
        {hasNumericItch ? (
          <p className={`text-lg font-bold tabular-nums ${itchScoreColor(avgItch)}`}>
            {avgItch}
          </p>
        ) : itchImpact ? (
          <div className="flex justify-center pt-0.5">
            <ImpactIcon impact={itchImpact} />
          </div>
        ) : (
          <p className="text-lg font-bold text-muted-foreground">-</p>
        )}
      </div>

      {/* Days */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Days</p>
        <p className="text-lg font-bold tabular-nums text-muted-foreground">{days}</p>
      </div>
    </div>
  )
}

export { poopScoreColor, itchScoreColor }
