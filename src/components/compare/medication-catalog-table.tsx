"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { MedicationProduct } from "@/lib/db/schema"
import { fetchMedicationCatalog } from "@/lib/medication-cache"
import { MEDICATION_CATEGORY_LABELS } from "@/lib/labels"
import { getDosageFormIcon } from "@/lib/medication-utils"
import { LiaSearchSolid, LiaPlusSolid, LiaCheckSolid } from "react-icons/lia"

// ── Category filter order ───────────────────────────────────────────────────

const CATEGORY_ORDER = ["allergy", "parasite", "gi", "pain", "steroid"] as const

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border hover:bg-item-hover",
      )}
    >
      {label}
    </button>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

interface MedicationCatalogTableProps {
  selectedIds: string[]
  onToggle: (med: MedicationProduct) => void
  onMedicationsLoaded?: (meds: MedicationProduct[]) => void
  maxCompare: number
}

export function MedicationCatalogTable({
  selectedIds,
  onToggle,
  onMedicationsLoaded,
  maxCompare,
}: MedicationCatalogTableProps): React.ReactElement {
  const onLoadedRef = useRef(onMedicationsLoaded)
  onLoadedRef.current = onMedicationsLoaded
  const [catalog, setCatalog] = useState<MedicationProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [activeCategory, setActiveCategory] = useState<string>("all")

  useEffect(() => {
    fetchMedicationCatalog()
      .then((items) => {
        setCatalog(items)
        onLoadedRef.current?.(items)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    let list = catalog

    if (activeCategory !== "all") {
      list = list.filter((m) => m.category === activeCategory)
    }

    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.genericName.toLowerCase().includes(q) ||
          (m.drugClass?.toLowerCase().includes(q) ?? false),
      )
    }

    return list
  }, [catalog, activeCategory, query])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const atMax = selectedIds.length >= maxCompare

  return (
    <div className="flex flex-col gap-4">
      {/* Search */}
      <div className="relative">
        <LiaSearchSolid className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search medications..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 pl-9"
        />
      </div>

      {/* Category chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <FilterChip
          label="All"
          active={activeCategory === "all"}
          onClick={() => setActiveCategory("all")}
        />
        {CATEGORY_ORDER.map((cat) => (
          <FilterChip
            key={cat}
            label={MEDICATION_CATEGORY_LABELS[cat] ?? cat}
            active={activeCategory === cat}
            onClick={() => setActiveCategory(activeCategory === cat ? "all" : cat)}
          />
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
              <div className="size-8 animate-pulse rounded-md bg-muted" />
              <div className="flex-1 space-y-1">
                <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-7 w-14 animate-pulse rounded-md bg-muted" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No medications found</p>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((med) => {
            const Icon = getDosageFormIcon(med.dosageForm)
            const isSelected = selectedSet.has(med.id)
            const disabled = atMax && !isSelected

            return (
              <button
                key={med.id}
                type="button"
                disabled={disabled}
                onClick={() => onToggle(med)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  isSelected
                    ? "border-primary bg-primary/[0.04] ring-1 ring-primary/20"
                    : "border-border hover:bg-item-hover",
                  disabled && "cursor-not-allowed opacity-40",
                )}
              >
                {/* Dosage form icon */}
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary">
                  <Icon className="size-4 text-muted-foreground" />
                </div>

                {/* Name + generic + drug class + description */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{med.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {med.genericName}
                    {med.drugClass && (
                      <span className="text-foreground-muted-50"> · {med.drugClass}</span>
                    )}
                  </p>
                  {med.description && (
                    <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-foreground-muted-60">
                      {med.description}
                    </p>
                  )}
                </div>

                {/* Add/Added button */}
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border",
                  )}
                >
                  {isSelected ? (
                    <>
                      <LiaCheckSolid className="size-3" />
                      Added
                    </>
                  ) : (
                    <>
                      <LiaPlusSolid className="size-3" />
                      Add
                    </>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
