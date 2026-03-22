"use client"

import { useMemo } from "react"
import type { MedicationProduct } from "@/lib/db/schema"
import { DOSING_INTERVAL_LABELS, MEDICATION_CATEGORY_LABELS } from "@/lib/labels"
import { capitalize, cn } from "@/lib/utils"
import { LiaExternalLinkAltSolid } from "react-icons/lia"
import { MedCompareColumnHeader } from "./med-compare-column-header"
import { CompareSection } from "./compare-section"
import { CompareRow, LABEL_WIDTH } from "./compare-row"

// ── Helpers ────────────────────────────────────────────────────────────────

/** Parse side effects string into individual items, splitting on commas
 *  that are NOT inside parentheses (preserving "(7.0% vs 6.8% placebo)"). */
function parseSideEffects(text: string | null): string[] {
  if (!text) return []
  const items: string[] = []
  let depth = 0
  let current = ""
  for (const ch of text) {
    if (ch === "(") depth++
    else if (ch === ")") depth--
    if (ch === "," && depth === 0) {
      const trimmed = current.trim()
      if (trimmed) items.push(trimmed)
      current = ""
    } else {
      current += ch
    }
  }
  const last = current.trim()
  if (last) items.push(last)
  return items
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

// ── Component ──────────────────────────────────────────────────────────────

interface MedCompareColumnsProps {
  medications: MedicationProduct[]
  onRemove: (id: string) => void
}

export function MedCompareColumns({
  medications,
  onRemove,
}: MedCompareColumnsProps): React.ReactElement {
  const colCount = medications.length

  // ── Overview rows ──────────────────────────────────────────────────────

  const overviewRows = useMemo(() => {
    const rows: { label: string; values: (string | null)[] }[] = []
    rows.push({
      label: "Drug class",
      values: medications.map((m) => m.drugClass ?? null),
    })
    rows.push({
      label: "Category",
      values: medications.map((m) =>
        m.category ? (MEDICATION_CATEGORY_LABELS[m.category] ?? capitalize(m.category)) : null,
      ),
    })
    rows.push({
      label: "Dosage form",
      values: medications.map((m) => m.dosageForm ? capitalize(m.dosageForm) : null),
    })
    rows.push({
      label: "Interval",
      values: medications.map((m) =>
        m.defaultIntervals?.length
          ? m.defaultIntervals.map((iv) => DOSING_INTERVAL_LABELS[iv] ?? iv).join(", ")
          : null,
      ),
    })
    rows.push({
      label: "Manufacturer",
      values: medications.map((m) => m.manufacturer ?? null),
    })
    return rows
  }, [medications])

  // ── Side effects with shared/unique highlighting ─────────────────────

  const sideEffectData = useMemo(() => {
    const perMed = medications.map((m) => parseSideEffects(m.commonSideEffects))

    // Normalize for comparison (lowercase, trim, strip parenthetical data)
    const normalize = (s: string): string =>
      s.toLowerCase().replace(/\s*\(.*?\)\s*/g, "").trim()

    const allSets = perMed.map(
      (list) => new Set(list.map(normalize)),
    )
    const shared = allSets.length > 0
      ? new Set([...allSets[0]].filter((name) => allSets.every((s) => s.has(name))))
      : new Set<string>()

    return { perMed, shared, normalize }
  }, [medications])

  // ── Flags ────────────────────────────────────────────────────────────

  const flagRows = useMemo(() => {
    const rows: { label: string; values: (string | null)[] }[] = []
    rows.push({
      label: "Suppresses itch",
      values: medications.map((m) => m.suppressesItch ? "Yes" : "No"),
    })
    rows.push({
      label: "GI side effects",
      values: medications.map((m) => m.hasGiSideEffects ? "Yes" : "No"),
    })
    return rows
  }, [medications])

  const COL_MIN = 160
  const GAP = 24
  const minWidth = parseInt(LABEL_WIDTH) + colCount * COL_MIN + colCount * GAP

  return (
    <div className="flex flex-col pb-8" style={{ minWidth }}>
      {/* Column headers */}
      <div
        className="sticky top-0 z-10 grid items-center gap-6 border-b border-border bg-background px-3 sm:px-4"
        style={{
          gridTemplateColumns: `${LABEL_WIDTH} repeat(${colCount}, minmax(0, 1fr))`,
        }}
      >
        <div />
        {medications.map((med) => (
          <MedCompareColumnHeader
            key={med.id}
            medication={med}
            onRemove={onRemove}
          />
        ))}
      </div>

      {/* Overview */}
      <CompareSection title="Overview">
        {overviewRows.map((row) => (
          <CompareRow key={row.label} label={row.label} values={row.values} className="!items-center" />
        ))}
        {flagRows.map((row) => (
          <CompareRow key={row.label} label={row.label} values={row.values} className="!items-center" />
        ))}
      </CompareSection>

      {/* Description */}
      <CompareSection title="Description">
        <div
          className="grid gap-6 px-3 py-1.5 sm:px-4"
          style={{
            gridTemplateColumns: `${LABEL_WIDTH} repeat(${colCount}, minmax(0, 1fr))`,
          }}
        >
          <span />
          {medications.map((med) => (
            <p
              key={med.id}
              className="select-text text-xs leading-relaxed text-muted-foreground"
            >
              {med.description ?? "—"}
            </p>
          ))}
        </div>
      </CompareSection>

      {/* Side Effects */}
      <CompareSection title="Side Effects">
        <div
          className="grid gap-6 px-3 py-1.5 sm:px-4"
          style={{
            gridTemplateColumns: `${LABEL_WIDTH} repeat(${colCount}, minmax(0, 1fr))`,
          }}
        >
          <span />
          {sideEffectData.perMed.map((effects, medIdx) => (
            <ul key={medIdx} className="space-y-1">
              {effects.length > 0 ? (
                effects.map((effect, i) => {
                  const isShared = sideEffectData.shared.has(
                    sideEffectData.normalize(effect),
                  )
                  return (
                    <li
                      key={i}
                      className={cn(
                        "select-text text-xs leading-snug",
                        isShared ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {effect}
                    </li>
                  )
                })
              ) : (
                <li className="text-xs text-muted-foreground">—</li>
              )}
            </ul>
          ))}
        </div>
      </CompareSection>

      {/* Sources */}
      <CompareSection title="Sources">
        <div
          className="grid gap-6 px-3 py-1.5 sm:px-4"
          style={{
            gridTemplateColumns: `${LABEL_WIDTH} repeat(${colCount}, minmax(0, 1fr))`,
          }}
        >
          <span />
          {medications.map((med) => (
            <div key={med.id} className="space-y-1.5">
              {med.sideEffectsSources && (
                <p className="select-text text-[11px] leading-relaxed text-muted-foreground">
                  <MarkdownLinks text={med.sideEffectsSources} />
                </p>
              )}
              {med.learnMoreUrl && (
                <a
                  href={med.learnMoreUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary underline hover:text-primary/80"
                >
                  Learn more
                  <LiaExternalLinkAltSolid className="size-3 shrink-0" />
                </a>
              )}
              {!med.sideEffectsSources && !med.learnMoreUrl && (
                <span className="text-[11px] text-muted-foreground">—</span>
              )}
            </div>
          ))}
        </div>
      </CompareSection>
    </div>
  )
}
