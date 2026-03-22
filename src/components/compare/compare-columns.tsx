"use client"

import { useMemo } from "react"
import type { ProductDetail } from "@/lib/types"
import { parseCalorieContent, GA_FIELDS, type GAFieldDef } from "@/lib/nutrition"
import { splitIngredients } from "@/lib/ingredients"
import { capitalize } from "@/lib/utils"
import { CompareColumnHeader } from "./compare-column-header"
import { CompareSection } from "./compare-section"
import { CompareRow, LABEL_WIDTH } from "./compare-row"
import { cn } from "@/lib/utils"

// Short labels for compact comparison display
const COMPARE_LABELS: Record<string, string> = {
  crude_protein_min: "Protein",
  crude_fat_min: "Fat",
  crude_fiber_max: "Fiber",
  moisture_max: "Moisture",
  omega_6_min: "Omega-6",
  omega_3_min: "Omega-3",
  calcium_min: "Calcium",
  phosphorus_min: "Phosphorus",
  glucosamine_min: "Glucosamine",
  epa_min: "EPA",
  dha_min: "DHA",
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getGAValue(
  product: ProductDetail,
  field: GAFieldDef,
  dmbEnabled: boolean,
): number | null {
  const ga = product.guaranteedAnalysis
  if (!ga) return null
  const raw = ga[field.key] ?? null
  if (raw === null) return null
  if (!dmbEnabled || field.key === "moisture_max" || field.displayUnit === "mg/kg") return raw
  // Hill's vet products store GA as dry-matter basis already — skip conversion
  if (product.guaranteedAnalysisBasis === "dry-matter") return raw
  const moisture = ga["moisture_max"] ?? 0
  if (moisture >= 100) return null
  return raw / (1 - moisture / 100)
}

function formatGA(value: number | null, displayUnit: "%" | "mg/kg"): string | null {
  if (value === null) return null
  if (displayUnit === "mg/kg") return `${Math.round(value)}`
  return `${value.toFixed(1)}%`
}

// ── Component ──────────────────────────────────────────────────────────────

interface CompareColumnsProps {
  products: ProductDetail[]
  onRemove: (id: string) => void
}

export function CompareColumns({
  products,
  onRemove,
}: CompareColumnsProps): React.ReactElement {
  // Auto-select basis: all wet (with no DMB-only products) → as-fed, otherwise → DMB
  const { dmbEnabled, showDmbNote } = useMemo(() => {
    const formats = new Set(products.map((p) => p.format).filter(Boolean))
    const allWet = formats.size === 1 && formats.has("wet")
    const hasDmbOnly = products.some((p) => p.guaranteedAnalysisBasis === "dry-matter")
    const mixed = formats.size > 1
    const showDmbNote = mixed || (allWet && hasDmbOnly)
    return { dmbEnabled: !allWet || hasDmbOnly, showDmbNote }
  }, [products])

  // ── Overview rows ──────────────────────────────────────────────────────

  const overviewRows = useMemo(() => {
    const rows: { label: string; values: (string | null)[] }[] = []
    rows.push({
      label: "Format",
      values: products.map((p) => p.format ? capitalize(p.format) : null),
    })
    rows.push({
      label: "Type",
      values: products.map((p) => p.type ? capitalize(p.type) : null),
    })
    rows.push({
      label: "Channel",
      values: products.map((p) => p.channel ? capitalize(p.channel) : null),
    })
    return rows
  }, [products])

  // ── Calorie rows ───────────────────────────────────────────────────────

  const calorieRows = useMemo(() => {
    const rows: { label: string; values: (string | null)[] }[] = []

    // Parse once per product
    const parsed = products.map((p) =>
      p.calorieContent ? parseCalorieContent(p.calorieContent) : null,
    )

    // kcal/kg — always shown
    const kgValues = parsed.map((p) => p?.kg ?? null)
    rows.push({
      label: "kcal/kg",
      values: kgValues.map((v) => v !== null ? v.toLocaleString() : null),
    })

    // kcal/cup — show if any product has it
    const cupValues = parsed.map((p) => p?.cup ?? null)
    if (cupValues.some((v) => v !== null)) {
      rows.push({
        label: "kcal/cup",
        values: cupValues.map((v) => v !== null ? v.toLocaleString() : null),
      })
    }

    // kcal/can — show if any product has it
    const canValues = parsed.map((p) => p?.can ?? null)
    if (canValues.some((v) => v !== null)) {
      rows.push({
        label: "kcal/can",
        values: canValues.map((v) => v !== null ? v.toLocaleString() : null),
      })
    }

    return rows
  }, [products])

  // ── GA rows ────────────────────────────────────────────────────────────

  const gaRows = useMemo(() => {
    const primaryGA = GA_FIELDS.filter((f) => f.group === "primary")
    return primaryGA
      .filter((field) => {
        if (dmbEnabled && field.key === "moisture_max") return false
        return products.some((p) => p.guaranteedAnalysis?.[field.key] != null)
      })
      .map((field) => {
        const nums = products.map((p) => getGAValue(p, field, dmbEnabled))
        const formatted = nums.map((v, i) => {
          const str = formatGA(v, field.displayUnit)
          if (!str) return null
          // Show "(DMB)" for wet food products whose GA is stored as dry-matter
          // basis — but only when NOT in DMB comparison mode (where everything
          // is already converted to DMB).
          const p = products[i]
          if (
            !dmbEnabled &&
            p.guaranteedAnalysisBasis === "dry-matter" &&
            p.format === "wet" &&
            field.displayUnit === "%"
          ) {
            return `${str} (DMB)`
          }
          return str
        })
        return {
          label: COMPARE_LABELS[field.key] ?? field.label,
          qualifier: field.qualifier,
          values: formatted,
        }
      })
  }, [products, dmbEnabled])

  // ── Ingredients ────────────────────────────────────────────────────────

  const ingredientData = useMemo(() => {
    const perProduct = products.map((p) => {
      if (p.rawIngredientString) {
        return splitIngredients(p.rawIngredientString)
      }
      return p.ingredients.map((i) => i.normalizedName)
    })

    // Find shared ingredients (present in ALL products)
    const allSets = perProduct.map(
      (list) => new Set(list.map((s) => s.toLowerCase().trim())),
    )
    const shared = allSets.length > 0
      ? new Set([...allSets[0]].filter((name) => allSets.every((s) => s.has(name))))
      : new Set<string>()

    // Always show top 20 ingredients line-by-line, rest compressed
    const TOP_N = 20
    const preSaltMax = Math.min(TOP_N, Math.max(...perProduct.map((l) => l.length), 0))

    // Remaining ingredients per product (compressed)
    const postSalt = perProduct.map((list) => list.slice(TOP_N))

    return { perProduct, shared, preSaltMax, postSalt }
  }, [products])

  // Ensure horizontal scroll on mobile when columns don't fit
  const COL_MIN = 160
  const GAP = 24
  const minWidth = parseInt(LABEL_WIDTH) + products.length * COL_MIN + (products.length) * GAP

  return (
    <div className="flex flex-col pb-8" style={{ minWidth }}>
      {/* Column headers */}
      <div
        className="sticky top-0 z-10 grid gap-6 border-b border-border bg-background px-3 sm:px-4"
        style={{
          gridTemplateColumns: `${LABEL_WIDTH} repeat(${products.length}, minmax(0, 1fr))`,
        }}
      >
        {/* Label column spacer */}
        <div />
        {products.map((product) => (
          <CompareColumnHeader
            key={product.id}
            product={product}
            onRemove={onRemove}
          />
        ))}
      </div>

      {/* Overview */}
      <CompareSection title="Overview">
        {overviewRows.map((row) => (
          <CompareRow
            key={row.label}
            label={row.label}
            values={row.values}

          />
        ))}
      </CompareSection>

      {/* Calories */}
      <CompareSection title="Calories">
        {calorieRows.map((row) => (
          <CompareRow
            key={row.label}
            label={row.label}
            values={row.values}

            mono
          />
        ))}
      </CompareSection>

      {/* GA — Primary */}
      <CompareSection
        title="Guaranteed Analysis"
        nutritionStyle
      >
        {showDmbNote && (
          <p className="px-3 pb-1 text-[11px] text-muted-foreground sm:px-4">
            Values converted to dry matter basis for fair comparison.
          </p>
        )}
        {gaRows.map((row) => (
          <CompareRow
            key={row.label}
            label={row.label}
            qualifier={row.qualifier}
            values={row.values}

            mono
            nutritionStyle
          />
        ))}
      </CompareSection>

      {/* Supplemental analysis removed — too sparse to be useful in comparison */}

      {/* Ingredients */}
      <CompareSection title="Ingredients">
        {/* Pre-salt ingredients: line by line */}
        {Array.from({ length: ingredientData.preSaltMax }).map((_, idx) => {
          const values = ingredientData.perProduct.map((list) => list[idx] ?? null)
          const isShared = values.every((v) => {
            if (v === null) return true
            return ingredientData.shared.has(v.toLowerCase().trim())
          })

          return (
            <div
              key={idx}
              className="grid items-baseline gap-6 px-3 py-1 sm:px-4"
              style={{
                gridTemplateColumns: `${LABEL_WIDTH} repeat(${products.length}, minmax(0, 1fr))`,
              }}
            >
              <span className="text-xs font-mono text-muted-foreground">
                {idx + 1}.
              </span>
              {values.map((v, i) => (
                <div key={i} className="flex justify-center">
                  <span
                    title={v ?? undefined}
                    className={cn(
                      "max-w-full truncate text-center text-xs leading-snug",
                      v === null && "text-muted-foreground",
                      isShared && v !== null && "text-muted-foreground",
                      !isShared && v !== null && "text-foreground",
                    )}
                  >
                    {v ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          )
        })}

        {/* Post-salt: compressed inline with section-style header */}
        {ingredientData.postSalt.some((list) => list.length > 0) && (
          <>
            <div className="flex items-center border-t border-border px-3 pb-1 pt-3 sm:px-4">
              <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Other Ingredients
              </span>
            </div>
            <div
              className="grid gap-6 px-3 py-1.5 sm:px-4"
              style={{
                gridTemplateColumns: `${LABEL_WIDTH} repeat(${products.length}, minmax(0, 1fr))`,
              }}
            >
              <span />
              {ingredientData.postSalt.map((list, i) => (
                <span key={i} className="break-all text-center text-[9px] leading-tight text-muted-foreground">
                  {list.length > 0 ? list.join(", ") : "—"}
                </span>
              ))}
            </div>
          </>
        )}
      </CompareSection>
    </div>
  )
}
