// ─── Types ────────────────────────────────────────────────────────────────────

export interface NutritionItem {
  guaranteedAnalysis: Record<string, number> | null
  calorieContent: string | null
  quantity: number | null
  quantityUnit: string | null
}

export interface ComputedNutrition {
  caloriesPerDay: number | null
  primaryAnalysis: AnalysisRow[]
  supplementalAnalysis: AnalysisRow[]
  productCount: number
}

export interface AnalysisRow {
  key: string
  label: string
  value: number | null
  /** Absolute grams per day (derived from percentage × serving weight). Null if not computable. */
  gramsPerDay: number | null
  qualifier: "min" | "max"
  /** "%" for most GA values, "mg/kg" for glucosamine/chondroitin */
  displayUnit: "%" | "mg/kg"
}

// ─── GA field definitions ─────────────────────────────────────────────────────

interface GAFieldDef {
  key: string
  label: string
  qualifier: "min" | "max"
  displayUnit: "%" | "mg/kg"
  group: "primary" | "supplemental"
}

const GA_FIELDS: GAFieldDef[] = [
  { key: "crude_protein_min", label: "Crude Protein", qualifier: "min", displayUnit: "%", group: "primary" },
  { key: "crude_fat_min", label: "Crude Fat", qualifier: "min", displayUnit: "%", group: "primary" },
  { key: "crude_fiber_max", label: "Crude Fiber", qualifier: "max", displayUnit: "%", group: "primary" },
  { key: "moisture_max", label: "Moisture", qualifier: "max", displayUnit: "%", group: "primary" },
  { key: "omega_6_min", label: "Omega-6 Fatty Acids", qualifier: "min", displayUnit: "%", group: "supplemental" },
  { key: "omega_3_min", label: "Omega-3 Fatty Acids", qualifier: "min", displayUnit: "%", group: "supplemental" },
  { key: "calcium_min", label: "Calcium", qualifier: "min", displayUnit: "%", group: "supplemental" },
  { key: "phosphorus_min", label: "Phosphorus", qualifier: "min", displayUnit: "%", group: "supplemental" },
  { key: "glucosamine_min", label: "Glucosamine", qualifier: "min", displayUnit: "mg/kg", group: "supplemental" },
  { key: "epa_min", label: "EPA", qualifier: "min", displayUnit: "%", group: "supplemental" },
  { key: "dha_min", label: "DHA", qualifier: "min", displayUnit: "%", group: "supplemental" },
]

const PRIMARY_GA_FIELDS = GA_FIELDS.filter((f) => f.group === "primary")
const SUPPLEMENTAL_GA_FIELDS = GA_FIELDS.filter((f) => f.group === "supplemental")

// ─── Calorie parsing ──────────────────────────────────────────────────────────

/** Extract kcal values from a calorie content string like "3617 kcal/kg, 361 kcal/cup" */
export function parseCalorieContent(content: string): Record<string, number> {
  const result: Record<string, number> = {}
  const regex = /(\d+(?:\.\d+)?)\s*kcal\/(kg|cup|can|piece|scoop|tbsp|tsp|treat|pouch|box)/gi
  let match
  while ((match = regex.exec(content)) !== null) {
    result[match[2].toLowerCase()] = parseFloat(match[1])
  }
  return result
}

/** User-facing labels for calorie-derived units. */
const UNIT_LABELS: Record<string, string> = {
  cup: "cup",
  can: "can",
  treat: "treat",
  pouch: "pouch",
  box: "box",
  scoop: "scoop",
  piece: "piece",
  tbsp: "tbsp",
  tsp: "tsp",
  g: "g",
}

export interface AvailableUnit {
  value: string
  label: string
}

/** Sensible default units per product type when calorie content is missing. */
const TYPE_DEFAULT_UNITS: Record<string, AvailableUnit[]> = {
  dry_food: [{ value: "cup", label: "cup" }, { value: "g", label: "g" }],
  wet_food: [{ value: "can", label: "can" }, { value: "g", label: "g" }],
  treat: [{ value: "treat", label: "treat" }, { value: "g", label: "g" }],
  freeze_dried: [{ value: "cup", label: "cup" }, { value: "g", label: "g" }],
  topper: [{ value: "tbsp", label: "tbsp" }, { value: "g", label: "g" }],
  supplement: [{ value: "scoop", label: "scoop" }, { value: "g", label: "g" }],
  probiotic: [{ value: "scoop", label: "scoop" }, { value: "g", label: "g" }],
}

/**
 * Extract which serving units a product supports from its calorie content.
 * Returns serving units first (cup/can/treat/etc), then "g" (derived from kcal/kg).
 * Falls back to sensible defaults by product type if calorie data is unavailable.
 * Returns null only if no calorie data AND no product type are available.
 */
export function getAvailableUnits(
  calorieContent: string | null,
  productType?: string | null,
): AvailableUnit[] | null {
  if (calorieContent) {
    const parsed = parseCalorieContent(calorieContent)
    const units: AvailableUnit[] = []

    // Serving units first (everything except kg)
    for (const unit of Object.keys(parsed)) {
      if (unit !== "kg" && UNIT_LABELS[unit]) {
        units.push({ value: unit, label: UNIT_LABELS[unit] })
      }
    }

    // "g" derived from kcal/kg — always available if kg data exists
    if (parsed.kg !== undefined) {
      units.push({ value: "g", label: "g" })
    }

    if (units.length > 0) return units
  }

  // Fallback to sensible defaults by product type
  if (productType && TYPE_DEFAULT_UNITS[productType]) {
    return TYPE_DEFAULT_UNITS[productType]
  }

  return null
}

/** Calculate daily calories for a single item. Returns null if data is insufficient. */
function calculateItemCalories(
  calorieContent: string | null,
  quantity: number | null,
  quantityUnit: string | null,
): number | null {
  if (!calorieContent || !quantity || !quantityUnit) return null

  const parsed = parseCalorieContent(calorieContent)
  const unit = quantityUnit.toLowerCase()

  // Direct match (cup, can, treat, etc.)
  if (parsed[unit] !== undefined) {
    return Math.round(quantity * parsed[unit])
  }

  // "g" derived from kcal/kg
  if (unit === "g" && parsed.kg !== undefined) {
    return Math.round(quantity * (parsed.kg / 1000))
  }

  return null
}

/**
 * Compute grams-per-serving for a unit, derived from calorie content.
 * e.g. if 3774 kcal/kg and 336 kcal/cup → 1 cup = 336/3774 * 1000 = ~89g.
 * For "g" unit, returns 1.
 */
export function gramsPerServing(
  calorieContent: string | null,
  quantityUnit: string | null,
): number | null {
  if (!calorieContent || !quantityUnit) return null
  const unit = quantityUnit.toLowerCase()
  if (unit === "g") return 1

  const parsed = parseCalorieContent(calorieContent)
  if (parsed.kg === undefined || parsed.kg === 0) return null
  if (parsed[unit] === undefined) return null

  return (parsed[unit] / parsed.kg) * 1000
}

// ─── Computation ──────────────────────────────────────────────────────────────

/** Compute combined nutrition data from an array of food items. */
export function computeNutrition(items: NutritionItem[]): ComputedNutrition {
  const validItems = items.filter((i) => i.guaranteedAnalysis || i.calorieContent)

  // Calories: sum of all items with computable calorie data
  let totalCalories: number | null = null
  for (const item of validItems) {
    const cal = calculateItemCalories(item.calorieContent, item.quantity, item.quantityUnit)
    if (cal !== null) {
      totalCalories = (totalCalories ?? 0) + cal
    }
  }

  // GA: quantity-weighted average across items that have GA data
  const itemsWithGA = validItems.filter((i) => i.guaranteedAnalysis)

  // Compute total daily grams of food (for converting % → absolute grams)
  let totalGramsPerDay: number | null = null
  for (const item of validItems) {
    if (!item.quantity || !item.quantityUnit || !item.calorieContent) continue
    const gps = gramsPerServing(item.calorieContent, item.quantityUnit)
    if (gps !== null) {
      totalGramsPerDay = (totalGramsPerDay ?? 0) + item.quantity * gps
    }
  }

  function computeRow(field: GAFieldDef): AnalysisRow {
    const values = itemsWithGA
      .map((i) => ({
        value: i.guaranteedAnalysis?.[field.key] ?? null,
        qty: i.quantity ?? 1,
      }))
      .filter((v): v is { value: number; qty: number } => v.value !== null)

    let avgValue: number | null = null
    if (values.length > 0) {
      const totalQty = values.reduce((sum, v) => sum + v.qty, 0)
      avgValue = values.reduce((sum, v) => sum + v.value * v.qty, 0) / totalQty
    }

    // Derive absolute grams/day from percentage × total food weight
    let gpd: number | null = null
    if (avgValue !== null && totalGramsPerDay !== null && field.displayUnit === "%") {
      gpd = (avgValue / 100) * totalGramsPerDay
    }

    return {
      key: field.key,
      label: field.label,
      value: avgValue,
      gramsPerDay: gpd,
      qualifier: field.qualifier,
      displayUnit: field.displayUnit,
    }
  }

  return {
    caloriesPerDay: totalCalories,
    primaryAnalysis: PRIMARY_GA_FIELDS.map(computeRow),
    // Only include supplemental rows that have data
    supplementalAnalysis: SUPPLEMENTAL_GA_FIELDS.map(computeRow).filter((r) => r.value !== null),
    productCount: validItems.length,
  }
}
