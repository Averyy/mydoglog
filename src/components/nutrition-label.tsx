"use client"

import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import type { AnalysisRow, ComputedNutrition } from "@/lib/nutrition"

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThickBar({ className }: { className?: string }): React.ReactElement {
  return <div className={cn("bg-foreground", className)} />
}

function ThinRule(): React.ReactElement {
  return <div className="border-b border-foreground" />
}

function NutrientRow({
  row,
  bold = true,
  showGrams = true,
}: {
  row: AnalysisRow
  bold?: boolean
  showGrams?: boolean
}): React.ReactElement {
  const pctFormatted =
    row.value !== null
      ? row.displayUnit === "mg/kg"
        ? `${Math.round(row.value)} mg/kg`
        : `${row.value.toFixed(1)}%`
      : "—"

  const gramsFormatted =
    showGrams && row.gramsPerDay !== null
      ? row.gramsPerDay >= 1
        ? `${Math.round(row.gramsPerDay)}g`
        : `${row.gramsPerDay.toFixed(1)}g`
      : null

  return (
    <div className="flex items-baseline justify-between gap-2 py-[3px]">
      <span className={cn("min-w-0 truncate text-[13px] leading-tight", bold && "font-bold")}>
        {row.label}
        <span className="ml-1 text-[11px] font-normal text-muted-foreground">
          ({row.qualifier})
        </span>
      </span>
      <span className="shrink-0 flex items-baseline gap-1.5 font-mono tabular-nums">
        {gramsFormatted && (
          <span className="text-[13px] font-bold">{gramsFormatted}</span>
        )}
        <span className={cn(
          "text-[11px]",
          gramsFormatted ? "text-muted-foreground" : "text-[13px] font-bold",
        )}>
          {pctFormatted}
        </span>
      </span>
    </div>
  )
}

// ─── Ingredient sub-components ────────────────────────────────────────────────

export interface IngredientList {
  name: string
  ingredients: string
}

function IngredientItem({ item }: { item: IngredientList }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const textRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = textRef.current
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [item.ingredients])

  return (
    <div>
      <p className="text-[11px] font-bold truncate">{item.name}</p>
      <p className="break-words text-[10px] leading-snug text-muted-foreground">
        <span
          ref={textRef}
          className={cn("inline-block", !expanded && "line-clamp-3")}
        >
          {item.ingredients}
        </span>
        {(overflows || expanded) && (
          <>
            {" "}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline text-[10px] font-medium text-primary hover:underline"
            >
              {expanded ? "View less" : "View all"}
            </button>
          </>
        )}
      </p>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface NutritionLabelBaseProps {
  data: ComputedNutrition
  loading?: boolean
  className?: string
}

interface DailyVariantProps extends NutritionLabelBaseProps {
  variant?: "daily"
  ingredientLists?: IngredientList[]
  /** Show "Nutrition Facts" on a single line with smaller text */
  compact?: boolean
  /** Raw calorie content string — not used for daily variant */
  calorieContentRaw?: never
}

interface ProductVariantProps extends NutritionLabelBaseProps {
  variant: "product"
  /** Raw calorie content string, displayed as-is below the kcal/kg number */
  calorieContentRaw?: string | null
  ingredientLists?: never
}

type NutritionLabelProps = DailyVariantProps | ProductVariantProps

function Skeleton({ className }: { className?: string }): React.ReactElement {
  return <div className={cn("animate-pulse rounded bg-muted", className)} />
}

export function NutritionLabel(props: NutritionLabelProps): React.ReactElement {
  const { data, loading, className, variant = "daily" } = props
  const compact = "compact" in props && props.compact
  const { caloriesPerDay, primaryAnalysis, supplementalAnalysis, productCount } = data
  const isProduct = variant === "product"

  return (
    <div
      className={cn(
        "w-full min-w-0 overflow-hidden border-2 border-foreground bg-muted-subtle px-2 pb-2 pt-1",
        className,
      )}
    >
      {/* ── Title ──────────────────────────────────────────────────── */}
      <ThickBar className="h-[7px]" />
      <h3 className={cn(
        "mt-0.5 font-black tracking-[-0.02em] text-foreground",
        compact ? "text-[22px] leading-[1.1]" : "text-[32px] leading-[1.05]",
      )}>
        Nutrition{compact ? " " : <br />}Facts
      </h3>

      <ThickBar className="h-[5px]" />

      {/* ── Context line ─────────────────────────────────────────── */}
      {!isProduct && (
        <div className="py-[2px] text-[13px]">
          <span className="font-bold">Daily total</span>
          {productCount > 0 && (
            <span className="text-muted-foreground">
              {" "}
              · {productCount} item{productCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}
      {isProduct && (
        <div className="py-[2px] text-[13px]">
          <span className="font-bold">Per food label</span>
          <span className="text-muted-foreground"> · as-fed basis</span>
        </div>
      )}

      <ThickBar className="h-[7px]" />

      {/* ── Calories ───────────────────────────────────────────────── */}
      <div className="flex items-baseline justify-between py-[2px]">
        <span className="text-[15px] font-black">Calories</span>
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : caloriesPerDay !== null ? (
          <span className="font-mono text-[28px] font-black leading-none tabular-nums">
            {caloriesPerDay.toLocaleString()}
          </span>
        ) : (
          <span className="font-mono text-[20px] leading-none tabular-nums text-muted-foreground">
            —
          </span>
        )}
      </div>
      {isProduct && caloriesPerDay !== null && data.calorieUnit && (
        <p className="text-[10px] text-muted-foreground -mt-0.5">{data.calorieUnit}</p>
      )}
      {isProduct && props.calorieContentRaw && (
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {props.calorieContentRaw}
        </p>
      )}

      <ThickBar className="h-[3px]" />

      {/* ── GA header ──────────────────────────────────────────────── */}
      <div className="py-[2px]">
        <span className="text-[11px] font-bold tracking-wide">GUARANTEED ANALYSIS</span>
      </div>

      <ThinRule />

      {/* ── Primary GA rows ────────────────────────────────────────── */}
      {primaryAnalysis.map((row, i) => (
        <div key={row.key}>
          {loading ? (
            <div className="flex items-baseline justify-between gap-2 py-[3px]">
              <span className="text-[13px] font-bold leading-tight">
                {row.label}
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  ({row.qualifier})
                </span>
              </span>
              <Skeleton className="h-4 w-10" />
            </div>
          ) : (
            <NutrientRow row={row} showGrams={!isProduct} />
          )}
          {i < primaryAnalysis.length - 1 && <ThinRule />}
        </div>
      ))}
      <ThinRule />

      {/* ── Supplemental GA rows ───────────────────────────────────── */}
      {supplementalAnalysis.length > 0 && (
        <>
          <ThickBar className="mt-[2px] h-[3px]" />
          {supplementalAnalysis.map((row, i) => (
            <div key={row.key}>
              <NutrientRow row={row} bold={false} showGrams={!isProduct} />
              {i < supplementalAnalysis.length - 1 && <ThinRule />}
            </div>
          ))}
        </>
      )}

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <ThickBar className="mt-[2px] h-[5px]" />
      {loading ? (
        <Skeleton className="mt-1 h-3 w-3/4" />
      ) : !isProduct ? (
        <p className="mt-1 break-words text-[10px] leading-tight text-muted-foreground">
          Per food label guaranteed analysis, as-fed basis.
          {productCount > 1 && ` Weighted average from ${productCount} products.`}
          {caloriesPerDay === null && productCount > 0 && " Add quantities to calculate calories."}
          {productCount === 0 && " Add foods to see nutrition info."}
        </p>
      ) : (
        <p className="mt-1 break-words text-[10px] leading-tight text-muted-foreground">
          Guaranteed analysis from product label.
        </p>
      )}

      {/* ── Ingredients (daily variant only) ───────────────────────── */}
      {loading && !isProduct && (
        <div className="mt-2 space-y-2">
          <ThickBar className="h-[3px]" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}
      {!loading && !isProduct && props.ingredientLists && props.ingredientLists.length > 0 && (
        <div className="mt-2 space-y-2">
          <ThickBar className="h-[3px]" />
          {props.ingredientLists.map((item) => (
            <IngredientItem key={item.name} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
