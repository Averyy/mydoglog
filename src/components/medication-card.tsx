"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getDosageFormIcon } from "@/lib/medication-utils"
import { format, parseISO } from "date-fns"
import { DOSING_INTERVAL_LABELS } from "@/lib/labels"
import type { MedicationSummary } from "@/lib/types"

interface MedicationCardProps {
  medication: MedicationSummary
  onEdit: () => void
}

export function MedicationCard({
  medication,
  onEdit,
}: MedicationCardProps): React.ReactElement {
  const isActive = !medication.endDate
  const Icon = getDosageFormIcon(medication.dosageForm)
  const hasDetails = medication.description || medication.commonSideEffects

  if (isActive) {
    return (
      <div className="rounded-lg border border-border bg-card">
        {/* Header */}
        <div className="flex items-start gap-3 px-4 py-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary">
            <Icon className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{medication.name}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {medication.dosage && <span>{medication.dosage}</span>}
              {medication.dosage && medication.interval && <span>&middot;</span>}
              {medication.interval && (
                <span>{DOSING_INTERVAL_LABELS[medication.interval] ?? medication.interval}</span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-foreground-muted-60">
              {format(parseISO(medication.startDate), "MMM d, yyyy")} - Present
            </p>
            {medication.notes && (
              <p className="mt-0.5 text-[11px] text-foreground-muted-60">{medication.notes}</p>
            )}
          </div>
          <div className="mt-0.5 flex shrink-0 items-center gap-3">
            <Badge className="bg-primary text-primary-foreground text-[10px]">
              Active
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
            >
              Edit
            </Button>
          </div>
        </div>

        {/* Description + side effects shown directly */}
        {hasDetails && (
          <div className="border-t border-border px-4 py-2.5 space-y-1.5">
            {medication.description && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {medication.description}
              </p>
            )}
            {medication.commonSideEffects && (
              <details className="group">
                <summary className="cursor-pointer text-[11px] font-medium text-foreground-muted-70 hover:text-muted-foreground">
                  Potential side effects
                </summary>
                <p className="mt-1 text-[11px] leading-relaxed text-foreground-muted-70">
                  {medication.commonSideEffects}
                </p>
                {medication.sideEffectsSources && (
                  <p className="mt-1 text-[11px] leading-relaxed text-foreground-muted-50">
                    <MarkdownLinks text={medication.sideEffectsSources} />
                  </p>
                )}
              </details>
            )}
          </div>
        )}
      </div>
    )
  }

  // Past medication — slightly muted, everything behind accordion
  return (
    <div className="rounded-lg border border-border bg-card-muted">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary">
          <Icon className="size-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{medication.name}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {medication.dosage && <span>{medication.dosage}</span>}
            {medication.dosage && medication.interval && <span>&middot;</span>}
            {medication.interval && (
              <span>{DOSING_INTERVAL_LABELS[medication.interval] ?? medication.interval}</span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {format(parseISO(medication.startDate), "MMM d, yyyy")}
            {medication.endDate && (
              <> &mdash; {format(parseISO(medication.endDate), "MMM d, yyyy")}</>
            )}
          </p>
          {medication.notes && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{medication.notes}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className="mt-0.5 shrink-0"
        >
          Edit
        </Button>
      </div>

      {/* Everything behind accordion for past meds */}
      {hasDetails && (
        <div className="border-t border-border px-4 py-2">
          <details className="group">
            <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-foreground">
              Description and potential side effects
            </summary>
            <div className="mt-1.5 space-y-1.5">
              {medication.description && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {medication.description}
                </p>
              )}
              {medication.commonSideEffects && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {medication.commonSideEffects}
                </p>
              )}
              {medication.sideEffectsSources && (
                <p className="mt-1 text-[11px] leading-relaxed text-foreground-muted-70">
                  <MarkdownLinks text={medication.sideEffectsSources} />
                </p>
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

/** Render markdown-style links [text](url) as clickable <a> tags. */
function MarkdownLinks({ text }: { text: string }): React.ReactElement {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/)
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
        if (match) {
          return (
            <a
              key={i}
              href={match[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              {match[1]}
            </a>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}
