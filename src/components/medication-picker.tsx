"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LiaSortSolid } from "react-icons/lia"
import {
  LiaCapsulesSolid,
  LiaSyringeSolid,
  LiaTintSolid,
  LiaSprayCanSolid,
  LiaMortarPestleSolid,
  LiaRingSolid,
  LiaPenSolid,
} from "react-icons/lia"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { MEDICATION_CATEGORY_LABELS } from "@/lib/labels"
import type { MedicationProduct } from "@/lib/db/schema"
import type { IconType } from "react-icons"

// ── Dosage form icons ───────────────────────────────────────────────────────

const DOSAGE_FORM_ICONS: Record<string, IconType> = {
  tablet: LiaCapsulesSolid,
  chewable: LiaCapsulesSolid,
  capsule: LiaCapsulesSolid,
  liquid: LiaTintSolid,
  injection: LiaSyringeSolid,
  topical: LiaTintSolid,
  spray: LiaSprayCanSolid,
  powder: LiaMortarPestleSolid,
  granules: LiaMortarPestleSolid,
  gel: LiaTintSolid,
  collar: LiaRingSolid,
}

export function getDosageFormIcon(dosageForm: string | null | undefined): IconType {
  if (!dosageForm) return LiaCapsulesSolid
  return DOSAGE_FORM_ICONS[dosageForm] ?? LiaCapsulesSolid
}

// ── Category filter order ───────────────────────────────────────────────────

const CATEGORY_ORDER = ["allergy", "parasite", "gi", "pain", "steroid"] as const

// ── Module-level cache ──────────────────────────────────────────────────────

let catalogCache: { items: MedicationProduct[]; at: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

async function fetchCatalog(): Promise<MedicationProduct[]> {
  if (catalogCache && Date.now() - catalogCache.at < CACHE_TTL) {
    return catalogCache.items
  }
  const res = await fetch("/api/medication-products")
  if (!res.ok) throw new Error("Failed to fetch medication catalog")
  const items: MedicationProduct[] = await res.json()
  catalogCache = { items, at: Date.now() }
  return items
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface MedicationPickerResult {
  medicationProductId: string | null
  name: string
  defaultIntervals: string[]
  dosageForm: string | null
  description: string | null
  commonSideEffects: string | null
  sideEffectsSources: string | null
}

interface MedicationPickerProps {
  value: MedicationPickerResult | null
  onChange: (result: MedicationPickerResult) => void
}

export function MedicationPicker({
  value,
  onChange,
}: MedicationPickerProps): React.ReactElement {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeFilter, setActiveFilter] = useState<string>("all")
  const [catalog, setCatalog] = useState<MedicationProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [customMode, setCustomMode] = useState(false)
  const [customName, setCustomName] = useState("")
  const filterBarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchCatalog()
      .then(setCatalog)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Reset filter when opening
  useEffect(() => {
    if (open) setActiveFilter("all")
  }, [open])

  // Derive which categories exist in the catalog
  const availableCategories = useMemo(() => {
    const cats = new Set(catalog.map((m) => m.category))
    return CATEGORY_ORDER.filter((c) => cats.has(c))
  }, [catalog])

  const filtered = useMemo(() => {
    let list = catalog

    // Apply category filter
    if (activeFilter !== "all") {
      list = list.filter((m) => m.category === activeFilter)
    }

    // Apply text search
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
  }, [catalog, activeFilter, query])

  function handleSelect(med: MedicationProduct): void {
    onChange({
      medicationProductId: med.id,
      name: med.name,
      defaultIntervals: med.defaultIntervals,
      dosageForm: med.dosageForm,
      description: med.description,
      commonSideEffects: med.commonSideEffects,
      sideEffectsSources: med.sideEffectsSources,
    })
    setOpen(false)
    setQuery("")
    setCustomMode(false)
  }

  function handleCustomSubmit(): void {
    if (!customName.trim()) return
    onChange({
      medicationProductId: null,
      name: customName.trim(),
      defaultIntervals: [],
      dosageForm: null,
      description: null,
      commonSideEffects: null,
      sideEffectsSources: null,
    })
    setOpen(false)
    setQuery("")
    setCustomMode(false)
    setCustomName("")
  }

  const ValueIcon = value ? getDosageFormIcon(value.dosageForm) : LiaCapsulesSolid

  const trigger = (
    <Button
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className="h-9 w-full justify-between font-normal"
    >
      {value ? (
        <span className="flex items-center gap-2 truncate">
          <ValueIcon className="size-4 shrink-0 text-muted-foreground" />
          {value.name}
        </span>
      ) : (
        <span className="text-muted-foreground">Select medication...</span>
      )}
      <LiaSortSolid className="ml-2 size-4 shrink-0 opacity-50" />
    </Button>
  )

  const content = (
    <Command shouldFilter={false}>
      {!customMode && (
        <>
          <CommandInput
            placeholder="Search medications..."
            value={query}
            onValueChange={setQuery}
          />
          {/* Category filter chips */}
          {availableCategories.length > 0 && (
            <div ref={filterBarRef} className="flex gap-1.5 overflow-x-auto border-b px-2 py-2">
              <button
                type="button"
                onClick={() => setActiveFilter("all")}
                aria-pressed={activeFilter === "all"}
                className={cn(
                  "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  activeFilter === "all"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border hover:bg-item-hover",
                )}
              >
                All
              </button>
              {availableCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveFilter(activeFilter === cat ? "all" : cat)}
                  aria-pressed={activeFilter === cat}
                  className={cn(
                    "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    activeFilter === cat
                      ? "border-foreground bg-foreground text-background"
                      : "border-border hover:bg-item-hover",
                  )}
                >
                  {MEDICATION_CATEGORY_LABELS[cat] ?? cat}
                </button>
              ))}
            </div>
          )}
          <CommandList className={cn("max-h-[300px]", isMobile && "h-[50vh] max-h-[50vh]")}>
            {loading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Loading...</div>
            ) : filtered.length === 0 && query.trim() ? (
              <CommandEmpty>No medications found</CommandEmpty>
            ) : (
              filtered.map((med) => {
                const Icon = getDosageFormIcon(med.dosageForm)
                return (
                  <CommandItem
                    key={med.id}
                    value={med.id}
                    onSelect={() => handleSelect(med)}
                    className="flex items-start gap-2 py-2"
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{med.name}</p>
                      <p className="text-xs text-muted-foreground">{med.genericName}</p>
                      {med.description && (
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-foreground-muted-70">
                          {med.description}
                        </p>
                      )}
                    </div>
                  </CommandItem>
                )
              })
            )}
            <CommandItem
              onSelect={() => {
                setCustomMode(true)
                setCustomName(query)
              }}
              className="flex items-center gap-2"
            >
              <LiaPenSolid className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm">Use custom medication name</span>
            </CommandItem>
          </CommandList>
        </>
      )}
      {customMode && (
        <div className="p-3 space-y-3">
          <p className="text-xs text-muted-foreground">Enter medication name</p>
          <Input
            placeholder="Medication name"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleCustomSubmit()
              }
            }}
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => {
                setCustomMode(false)
                setCustomName("")
              }}
            >
              Back
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={handleCustomSubmit}
              disabled={!customName.trim()}
            >
              Use this name
            </Button>
          </div>
        </div>
      )}
    </Command>
  )

  if (isMobile) {
    return (
      <>
        <div onClick={() => setOpen(true)}>{trigger}</div>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent aria-describedby={undefined}>
            <DrawerHeader>
              <DrawerTitle>Select medication</DrawerTitle>
            </DrawerHeader>
            <div className="px-2 pb-4">{content}</div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        {content}
      </PopoverContent>
    </Popover>
  )
}
