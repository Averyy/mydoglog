/**
 * LLM export markdown formatter.
 * Pure functions that take assembled data and return formatted markdown.
 * No DB access — all logic is testable with plain data.
 */

import type { CorrelationResult, IngredientScore, CrossReactivityGroup } from "@/lib/correlation/types"
import type { MedicationSummary } from "@/lib/types"

export interface ExportMedication extends MedicationSummary {
  category: string | null
  drugClass: string | null
  // suppressesItch and hasGiSideEffects are inherited from MedicationSummary
}

// ---------------------------------------------------------------------------
// Types for the export data bundle
// ---------------------------------------------------------------------------

export interface ExportDog {
  name: string
  breed: string | null
  birthDate: string | null
  weightKg: string | null
  mealsPerDay: number
  environmentEnabled: boolean
}

export interface ExportProduct {
  id: string
  name: string
  brandName: string
  type: string | null
  format: string | null
  channel: string | null
  calorieContent: string | null
  guaranteedAnalysis: Record<string, string> | null
  ingredients: { normalizedName: string; position: number }[]
  /** Full ingredient list from raw string, truncated at salt line. */
  rawIngredients: string[] | null
}

export interface ExportFeedingPeriod {
  periodNumber: number
  planGroupId: string
  planName: string | null
  startDate: string
  endDate: string | null
  isBackfill: boolean
  transitionDays: number | null
  previousPeriodNumber: number | null
  items: {
    productId: string
    quantity: string
    quantityUnit: string
    mealSlot: string | null
  }[]
  scorecard: { poopQuality: number[] | null; itchSeverity: number[] | null } | null
  logStats: { avgPoopScore: number | null; avgItchScore: number | null; daysWithData: number } | null
  avgPollen: number | null
  highPollenDayPercent: number | null
  activeMeds: string[]
  treats: { productId: string; productName: string; count: number }[]
}

export interface ExportDailyRow {
  date: string
  poopEntries: { score: number; time: string | null; note: string | null }[]
  avgPoop: number | null
  itchEntries: { score: number; time: string | null; bodyAreas: string[]; note: string | null }[]
  avgItch: number | null
  effectivePollen: number | null
  foodNames: string[]
  meds: string[]
  isTransition: boolean
}

export interface ExportPollenBucket {
  label: string
  days: number
  avgPoop: number | null
  avgItch: number | null
}

export interface ExportBodyAreaFrequency {
  area: string
  percent: number
}

export interface ExportMedChangeEvent {
  date: string
  event: string
  medication: string
  avgPoopBefore: number | null
  avgPoopAfter: number | null
  avgItchBefore: number | null
  avgItchAfter: number | null
}

export interface ExportData {
  dog: ExportDog
  exportDate: string
  products: Map<string, ExportProduct>
  feedingPeriods: ExportFeedingPeriod[]
  medications: ExportMedication[]
  dailyLog: ExportDailyRow[]
  correlation: CorrelationResult | null
  pollenBuckets: ExportPollenBucket[]
  crossReactivityGroups: CrossReactivityGroup[]
  bodyAreaFrequency: ExportBodyAreaFrequency[]
  constantIngredients: string[]
  uniqueIngredientsByPeriod: Map<number, string[]>
  avgPoopEntriesPerDay: number | null
  itchChangeEvents: ExportMedChangeEvent[]
  pollenSource: { provider: string; location: string } | null
  pollenCoverage: { daysWithData: number; totalDays: number } | null
}

export type ExportSection =
  | "profile"
  | "current-diet"
  | "supplements"
  | "medications"
  | "food-history"
  | "medication-history"
  | "daily-log"
  | "correlation"
  | "medication-confounding"
  | "pollen"
  | "links"
  | "cross-reactivity"
  | "reference-stats"

export const VALID_EXPORT_SECTIONS = new Set<ExportSection>([
  "profile", "current-diet", "supplements", "medications",
  "food-history", "medication-history", "daily-log", "correlation",
  "medication-confounding", "pollen", "links", "cross-reactivity",
  "reference-stats",
])

export const TIMELINE_OPTIONS = [
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "3m", label: "Last 3 months", days: 90 },
  { value: "6m", label: "Last 6 months", days: 180 },
  { value: "1y", label: "Last 1 year", days: 365 },
  { value: "all", label: "All time", days: 0 },
] as const

export const TIMELINE_DAYS: Record<string, number> = Object.fromEntries(
  TIMELINE_OPTIONS.map((o) => [o.value, o.days]),
)

// ---------------------------------------------------------------------------
// Track which products have had their full ingredient list printed
// ---------------------------------------------------------------------------

class ProductDedup {
  private printed = new Map<string, number>() // productId → period number

  /**
   * Pre-populate the dedup tracker with chronological period order.
   * This ensures ingredients are printed in full at the earliest period,
   * and later periods (including Current Diet) reference back correctly.
   */
  prePopulate(
    periods: ExportFeedingPeriod[],
    products: Map<string, ExportProduct>,
  ): void {
    const sorted = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate))
    for (const period of sorted) {
      for (const item of period.items) {
        const product = products.get(item.productId)
        if (product && !this.printed.has(product.id)) {
          this.printed.set(product.id, period.periodNumber)
        }
      }
    }
  }

  /** Returns the full ingredient section, or a reference to the first period. */
  formatIngredients(
    product: ExportProduct,
    periodNumber: number,
  ): string {
    const hasRaw = product.rawIngredients && product.rawIngredients.length > 0
    const hasNormalized = product.ingredients.length > 0
    if (!hasRaw && !hasNormalized) return ""

    const firstPeriod = this.printed.get(product.id)
    if (firstPeriod !== undefined && firstPeriod !== periodNumber) {
      return `  - Ingredients: See period #${firstPeriod}`
    }
    // Mark as printed at this period (for non-pre-populated products like treats)
    this.printed.set(product.id, periodNumber)

    // Prefer raw ingredients (full list, truncated at salt) over normalized subset
    if (hasRaw) {
      return `  - Ingredients: ${product.rawIngredients!.join(", ")}`
    }
    const list = product.ingredients
      .sort((a, b) => a.position - b.position)
      .map((i) => i.normalizedName)
      .join(", ")
    return `  - Ingredients: ${list}`
  }

  formatGA(product: ExportProduct): string {
    if (!product.guaranteedAnalysis) return ""
    const entries = Object.entries(product.guaranteedAnalysis)
    if (entries.length === 0) return ""
    return `  - Guaranteed Analysis: ${entries.map(([k, v]) => `${k}: ${v}`).join(", ")}`
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeAge(birthDate: string, exportDate: string): string {
  const birth = new Date(birthDate + "T00:00:00Z")
  const now = new Date(exportDate + "T00:00:00Z")
  const months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth())
  if (months < 12) return `${months} months`
  const years = Math.floor(months / 12)
  const rem = months % 12
  return rem > 0 ? `${years} year${years > 1 ? "s" : ""}, ${rem} month${rem > 1 ? "s" : ""}` : `${years} year${years > 1 ? "s" : ""}`
}

function formatDateRange(start: string, end: string | null): string {
  const s = formatShortDate(start)
  if (!end) return `${s} – present`
  return `${s} – ${formatShortDate(end)}`
}

function formatShortDate(date: string): string {
  const d = new Date(date + "T00:00:00Z")
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

function daysBetweenInclusive(start: string, end: string): number {
  const s = new Date(start + "T12:00:00Z")
  const e = new Date(end + "T12:00:00Z")
  return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
}

function round1(n: number | null): string {
  if (n === null) return "—"
  return (Math.round(n * 10) / 10).toString()
}

function round2(n: number | null): string {
  if (n === null) return "—"
  return (Math.round(n * 100) / 100).toString()
}

function formatInterval(interval: string | null): string {
  if (!interval) return ""
  return interval.replace(/_/g, " ")
}

/** Format a scorecard range array as "3" (single value) or "3–4" (range). */
function formatScorecardRange(values: number[]): string {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return min.toString()
  return `${min}–${max}`
}

/** Shorten a product name for dense markdown tables (daily log export). Strips brand prefix and common suffixes. */
function shortProductName(fullName: string): string {
  const short = fullName
    .replace(/^Pro Plan (Veterinary Diets |Complete Essentials |Sensitive Skin & Stomach |Development )?/i, "")
    .replace(/^(Wet |Dry )?Dog Food (Supplement Topper )?/i, " ")
    .replace(/ (Wet |Dry )?Dog Food (Supplement Topper )?/i, " ")
    .replace(/ (- |— )/g, " ")
    .replace(/ (Canine |Canned |Flavour )?(Formula|Classic|Pate)/gi, "")
    .replace(/\s+/g, " ")
    .trim()
  return short || fullName
}

// ---------------------------------------------------------------------------
// Section formatters
// ---------------------------------------------------------------------------

function formatPreamble(data: ExportData): string {
  const lines: string[] = []
  lines.push(`# ${data.dog.name} — MyDogLog Export`)
  lines.push("")
  lines.push("> This is a structured data export from MyDogLog, a dog food and digestive health tracking app. The product database is focused on the Canadian market. It contains a dog's complete feeding history with ingredient lists, daily stool and itchiness logs, medications, environmental pollen/mold data, and ingredient-level correlation analysis.")
  lines.push(">")
  lines.push("> Dogs with food sensitivities or allergies are a multi-variable problem: food ingredients, environmental allergens (pollen, mold, dust mites), medications (which have their own GI/skin side effects), treats, and supplements all interact. Symptoms can be delayed (GI: up to 1-7 days, skin/itch: up to weeks or months), and food allergies and environmental allergies can present with similar symptoms — making them difficult to distinguish without data. This data exists to help untangle those variables.")
  lines.push(">")
  lines.push("> The owner is likely looking for help with: which foods or ingredients work best or worst for their dog's digestion and skin, whether itching/GI symptoms are food-related or environmental, whether medications are contributing to symptoms, and what to try next.")
  lines.push(">")
  lines.push("> All data below is factual — logged by the owner or computed from logs. No conclusions have been drawn. Backfill data (marked throughout) is lower confidence than manual daily logs.")
  return lines.join("\n")
}

function formatScoringAndCoverage(data: ExportData): string {
  const lines: string[] = []
  lines.push("## Scoring Systems & Data Coverage")
  lines.push("")
  lines.push("### Data Sources")
  lines.push("")
  lines.push("- **Logs**: Manually entered by owner in real-time. High confidence.")
  lines.push("- **Backfill**: Rough approximations entered retroactively. Scorecard ranges (e.g., poop \"3-4\") rather than daily values. Low confidence — use for general patterns only.")
  lines.push("")
  lines.push("### Poop (Purina Fecal Score 1-7, goal: 2)")
  lines.push("")
  lines.push("- 1: Hard pellets — \"Very hard and dry; requires much effort to expel from body; no residue left on ground when picked up. Often expelled as individual pellets.\"")
  lines.push("- 2: Ideal — \"Firm, but not hard; should be pliable; segmented appearance; little or no residue left on ground when picked up.\" **(goal)**")
  lines.push("- 3: Soft — \"Log-like; little or no segmentation visible; moist surface; leaves residue, but holds form when picked up.\"")
  lines.push("- 4: Soggy — \"Very moist (soggy); distinct log shape visible; leaves residue and loses form when picked up.\"")
  lines.push("- 5: Soft piles — \"Very moist but has distinct shape; present in piles rather than as distinct logs; leaves residue and loses form when picked up.\"")
  lines.push("- 6: No shape — \"Has texture, but no defined shape; occurs as piles or as spots; leaves residue when picked up.\"")
  lines.push("- 7: Liquid — \"Watery, no texture, flat; occurs as puddles.\"")
  lines.push("")
  lines.push("### Itch (0-5, goal: 0)")
  lines.push("")
  lines.push("- 0: None — \"Normal grooming only, no signs of itchiness\" **(goal)**")
  lines.push("- 1: Very mild — \"Occasional episodes, slightly more than normal\"")
  lines.push("- 2: Mild — \"Slightly increased, stops when distracted\"")
  lines.push("- 3: Moderate — \"Regular episodes, stops when eating or playing\"")
  lines.push("- 4: Severe — \"Prolonged, itches even when eating, playing, or sleeping\"")
  lines.push("- 5: Extreme — \"Nearly continuous, must be physically restrained\"")
  lines.push("")
  lines.push("### Pollen (0-4)")
  lines.push("")
  lines.push("- 0: None/offseason. 1: Low. 2: Moderate. 3: High. 4: Very high.")
  lines.push("- Effective pollen level = 3-day rolling max of max(pollenLevel, sporeLevel)")

  // Coverage stats
  if (data.correlation) {
    const c = data.correlation

    // Use feeding period range for tracking period (correlation window only covers daily logs)
    const sortedPeriods = [...data.feedingPeriods].sort((a, b) => a.startDate.localeCompare(b.startDate))
    const trackingStart = sortedPeriods.length > 0 ? sortedPeriods[0].startDate : c.windowStart
    const trackingEnd = c.windowEnd

    lines.push("")
    lines.push("### Data Coverage")
    lines.push("")
    lines.push(`- Tracking period: ${trackingStart} → ${trackingEnd}`)
    lines.push(`- Total days: ${c.totalDays}`)
    lines.push(`- Days with manual logs: ${c.loggedDays}`)
    lines.push(`- Backfilled days: ${c.backfillDays}`)
    lines.push(`- Scoreable days (used in correlation): ${c.scoreableDays}`)
    lines.push(`- Transition buffer: ${c.options.transitionBufferDays}-day default after food switches (excluded from correlation)`)

  }

  if (data.pollenCoverage) {
    lines.push(`- Pollen coverage: ${data.pollenCoverage.daysWithData} of ${data.pollenCoverage.totalDays} days have readings`)
  }
  if (data.pollenSource) {
    lines.push(`- Pollen data source: ${data.pollenSource.provider}, ${data.pollenSource.location}`)
  }

  return lines.join("\n")
}

function formatProfile(data: ExportData): string {
  const d = data.dog
  const lines: string[] = []
  lines.push("## Profile")
  lines.push("")
  lines.push(`- Name: ${d.name}`)
  if (d.breed) lines.push(`- Breed: ${d.breed}`)
  if (d.birthDate) lines.push(`- Born: ${formatShortDate(d.birthDate)} (${computeAge(d.birthDate, data.exportDate)})`)
  if (d.weightKg) lines.push(`- Weight: ${d.weightKg} kg`)
  lines.push(`- Meals per day: ${d.mealsPerDay}`)
  if (d.environmentEnabled) {
    lines.push("- Environment tracking: Enabled")
  }
  lines.push(`- Export date: ${formatShortDate(data.exportDate)}`)
  return lines.join("\n")
}

function formatCurrentDiet(data: ExportData, dedup: ProductDedup): string {
  const activePeriod = data.feedingPeriods.find((p) => !p.endDate)
  if (!activePeriod) return "## Current Diet\n\nNo active feeding plan."

  const lines: string[] = []
  lines.push("## Current Diet")
  lines.push("")
  if (activePeriod.planName) lines.push(`Plan: ${activePeriod.planName}`)
  lines.push(`Start date: ${formatShortDate(activePeriod.startDate)}`)
  lines.push("")

  // Filter to food items only
  const foodItems = activePeriod.items.filter((item) => {
    const product = data.products.get(item.productId)
    return product && product.type === "food"
  })

  for (const item of foodItems) {
    const product = data.products.get(item.productId)
    if (!product) continue
    lines.push(`### ${product.brandName} ${product.name}`)
    lines.push(`- Type: ${product.type}, Format: ${product.format ?? "—"}, Channel: ${product.channel ?? "—"}`)
    lines.push(`- Quantity: ${item.quantity} ${item.quantityUnit}${item.mealSlot ? ` (${item.mealSlot})` : ""}`)
    if (product.calorieContent) lines.push(`- Calories: ${product.calorieContent}`)
    const ingLine = dedup.formatIngredients(product, activePeriod.periodNumber)
    if (ingLine) lines.push(ingLine)
    const gaLine = dedup.formatGA(product)
    if (gaLine) lines.push(gaLine)
    lines.push("")
  }

  return lines.join("\n")
}

function formatSupplements(data: ExportData, dedup: ProductDedup): string {
  const activePeriod = data.feedingPeriods.find((p) => !p.endDate)
  const lines: string[] = []
  lines.push("## Supplements, Toppers & Treats")
  lines.push("")
  lines.push("Note: Toppers/supplements are small quantities (~25-30g/meal) vs primary food at 200g+/meal.")
  lines.push("")

  if (activePeriod) {
    const suppItems = activePeriod.items.filter((item) => {
      const product = data.products.get(item.productId)
      return product && product.type !== "food"
    })

    if (suppItems.length > 0) {
      lines.push("### Active Supplements/Toppers")
      for (const item of suppItems) {
        const product = data.products.get(item.productId)
        if (!product) continue
        lines.push(`- ${product.brandName} ${product.name}: ${item.quantity} ${item.quantityUnit}${item.mealSlot ? ` (${item.mealSlot})` : ""}`)
        const ingLine = dedup.formatIngredients(product, activePeriod.periodNumber)
        if (ingLine) lines.push(ingLine)
      }
      lines.push("")
    }
  }

  // Aggregate treats from feeding periods
  const allTreats = new Map<string, { productId: string; name: string; total: number }>()
  for (const period of data.feedingPeriods) {
    for (const treat of period.treats) {
      const existing = allTreats.get(treat.productId)
      if (existing) {
        existing.total += treat.count
      } else {
        allTreats.set(treat.productId, { productId: treat.productId, name: treat.productName, total: treat.count })
      }
    }
  }

  if (allTreats.size > 0) {
    lines.push("### Treats")
    lines.push("")
    for (const [, treat] of allTreats) {
      lines.push(`- ${treat.name}: ${treat.total} ${treat.total === 1 ? "entry" : "entries"} logged`)
      const product = data.products.get(treat.productId)
      if (product) {
        const ingLine = dedup.formatIngredients(product, 0)
        if (ingLine) lines.push(ingLine)
      }
    }
    lines.push("")
  }

  if (lines.length <= 4) {
    lines.push("No supplements, toppers, or treats recorded.")
  }

  return lines.join("\n")
}

function formatCurrentMedications(data: ExportData): string {
  const active = data.medications.filter((m) => !m.endDate)
  const lines: string[] = []
  lines.push("## Current Medications")
  lines.push("")

  if (active.length === 0) {
    lines.push("No active medications.")
    return lines.join("\n")
  }

  for (const med of active) {
    lines.push(`### ${med.name}`)
    if (med.dosage) lines.push(`- Dosage: ${med.dosage}`)
    if (med.interval) lines.push(`- Interval: ${formatInterval(med.interval)}`)
    lines.push(`- Start date: ${formatShortDate(med.startDate)}`)
    const daysOn = daysBetweenInclusive(med.startDate, data.exportDate)
    lines.push(`- Duration: ${daysOn} days`)
    if (med.drugClass) lines.push(`- Drug class: ${med.drugClass}`)
    if (med.dosageForm) lines.push(`- Form: ${med.dosageForm}`)
    if (med.description) lines.push(`- Description: ${med.description}`)
    if (med.commonSideEffects) lines.push(`- Known side effects: ${med.commonSideEffects}`)
    const effects: string[] = []
    if (med.suppressesItch) effects.push("suppresses itch")
    if (med.hasGiSideEffects) effects.push("has GI side effects")
    if (effects.length > 0) lines.push(`- Correlation effects: ${effects.join(", ")}`)
    lines.push("")
  }

  return lines.join("\n")
}

function formatFoodHistory(data: ExportData, dedup: ProductDedup): string {
  const lines: string[] = []
  lines.push("## Food History")
  lines.push("")
  lines.push("Oldest → newest. One row per feeding period. Ingredient lists are truncated at salt — ingredients after salt are present at less than 1% by weight (vitamins, minerals, preservatives).")
  lines.push("")

  // Table header
  lines.push("| # | Food | Qty | Dates | Days | Avg Poop | Avg Itch | Logged/Backfill | Avg Pollen | High Pollen Days | Active Meds |")
  lines.push("|---|------|-----|-------|------|----------|----------|-----------------|------------|------------------|-------------|")

  // Sort oldest first, filter to periods with at least one food item
  const sorted = [...data.feedingPeriods]
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .filter((period) =>
      period.items.some((item) => {
        const p = data.products.get(item.productId)
        return p && p.type === "food"
      }),
    )

  for (const period of sorted) {
    const mainFoods = period.items
      .map((item) => data.products.get(item.productId))
      .filter((p): p is ExportProduct => p != null && p.type === "food")
    const foodName = mainFoods.map((p) => p.name).join(" + ") || "—"
    const qty = period.items
      .filter((item) => {
        const p = data.products.get(item.productId)
        return p && p.type === "food"
      })
      .map((item) => `${item.quantity} ${item.quantityUnit}`)
      .join(" + ") || "—"
    const endDate = period.endDate ?? data.exportDate
    const days = daysBetweenInclusive(period.startDate, endDate)

    let avgPoop = "—"
    let avgItch = "—"
    let loggedBackfill = "—"

    if (period.logStats && period.logStats.daysWithData > 0) {
      avgPoop = round1(period.logStats.avgPoopScore)
      avgItch = round1(period.logStats.avgItchScore)
      loggedBackfill = `${period.logStats.daysWithData}/${days - period.logStats.daysWithData}`
    } else if (period.scorecard) {
      const pq = period.scorecard.poopQuality
      const is_ = period.scorecard.itchSeverity
      if (pq && pq.length > 0) avgPoop = formatScorecardRange(pq)
      if (is_ && is_.length > 0) avgItch = formatScorecardRange(is_)
      loggedBackfill = `0/${days}`
    }

    const avgPollenStr = period.avgPollen !== null ? round1(period.avgPollen) : "—"
    const highPollenStr = period.highPollenDayPercent !== null ? `${Math.round(period.highPollenDayPercent)}%` : "—"
    const medsStr = period.activeMeds.length > 0 ? period.activeMeds.join(", ") : "none"

    lines.push(`| ${period.periodNumber} | ${foodName} | ${qty} | ${formatDateRange(period.startDate, period.endDate)} | ${days} | ${avgPoop} | ${avgItch} | ${loggedBackfill} | ${avgPollenStr} | ${highPollenStr} | ${medsStr} |`)
  }

  // Product details below table — include ALL periods (even supplement-only)
  // so that "See period #N" references from other sections resolve
  const allSorted = [...data.feedingPeriods].sort((a, b) => a.startDate.localeCompare(b.startDate))
  lines.push("")
  for (const period of allSorted) {
    lines.push(`### Period #${period.periodNumber}`)

    for (const item of period.items) {
      const product = data.products.get(item.productId)
      if (!product) continue
      lines.push(`- ${product.brandName} ${product.name} (${product.type}, ${product.format ?? "—"}, ${product.channel ?? "—"})`)
      lines.push(`  - Qty: ${item.quantity} ${item.quantityUnit}${item.mealSlot ? ` (${item.mealSlot})` : ""}`)
      const ingLine = dedup.formatIngredients(product, period.periodNumber)
      if (ingLine) lines.push(ingLine)
      const gaLine = dedup.formatGA(product)
      if (gaLine) lines.push(gaLine)
      if (product.calorieContent) lines.push(`  - Calories: ${product.calorieContent}`)
    }

    if (period.transitionDays && period.previousPeriodNumber !== null) {
      lines.push(`- Transition: ${period.transitionDays}-day transition from period #${period.previousPeriodNumber}`)
    }

    if (period.treats.length > 0) {
      lines.push(`- Treats during this period: ${period.treats.map((t) => `${t.productName} (×${t.count})`).join(", ")}`)
    }

    lines.push("")
  }

  return lines.join("\n")
}

function formatMedicationHistory(data: ExportData): string {
  const lines: string[] = []
  lines.push("## Medication History")
  lines.push("")

  if (data.medications.length === 0) {
    lines.push("No medications recorded.")
    return lines.join("\n")
  }

  lines.push("| Medication | Dosage | Interval | Dates | Days | Category |")
  lines.push("|------------|--------|----------|-------|------|----------|")

  // Sort oldest first
  const sorted = [...data.medications].sort((a, b) => a.startDate.localeCompare(b.startDate))

  for (const med of sorted) {
    const endDate = med.endDate ?? data.exportDate
    const days = daysBetweenInclusive(med.startDate, endDate)
    lines.push(`| ${med.name} | ${med.dosage ?? "—"} | ${formatInterval(med.interval) || "—"} | ${formatDateRange(med.startDate, med.endDate)} | ${days} | ${med.category ?? "—"} |`)
  }

  lines.push("")
  lines.push("### Side Effects by Medication")
  lines.push("")
  const seen = new Set<string>()
  for (const med of sorted) {
    if (seen.has(med.name)) continue
    seen.add(med.name)
    if (med.commonSideEffects) {
      lines.push(`- **${med.name}**: ${med.commonSideEffects}`)
    }
  }

  return lines.join("\n")
}

function formatDailyLogTable(data: ExportData): string {
  const lines: string[] = []
  lines.push("## Daily Log Table")
  lines.push("")

  if (data.dailyLog.length === 0) {
    lines.push("No daily log data in the selected time range.")
    return lines.join("\n")
  }

  lines.push("| Date | Poop | Itch | Pollen | Food | Meds |")
  lines.push("|------|------|------|--------|------|------|")

  // Already sorted newest first from the API
  for (const row of data.dailyLog) {
    const poopStr = row.poopEntries.length > 0
      ? row.poopEntries.map((e) => {
          const parts: string[] = []
          if (e.time) parts.push(e.time)
          if (e.note) parts.push(e.note)
          return parts.length > 0 ? `${e.score} (${parts.join(", ")})` : `${e.score}`
        }).join(", ")
      : "—"
    const itchStr = row.itchEntries.length > 0
      ? row.itchEntries.map((e) => {
          const parts: string[] = []
          if (e.time) parts.push(e.time)
          if (e.bodyAreas.length > 0) parts.push(e.bodyAreas.join("+"))
          if (e.note) parts.push(e.note)
          return parts.length > 0 ? `${e.score} (${parts.join(", ")})` : `${e.score}`
        }).join(", ")
      : "—"
    const pollenStr = row.effectivePollen !== null ? row.effectivePollen.toString() : "—"
    const foodStr = row.foodNames.map(shortProductName).join(", ") || "—"
    const medsStr = row.meds.join(", ") || "—"
    const dateStr = row.isTransition ? `${row.date} (transition day)` : row.date

    lines.push(`| ${dateStr} | ${poopStr} | ${itchStr} | ${pollenStr} | ${foodStr} | ${medsStr} |`)
  }

  if (data.dailyLog.some((r) => r.isTransition)) {
    lines.push("")
    lines.push("Transition days = food switch buffer where old and new food overlap. Excluded from ingredient correlation.")
  }

  return lines.join("\n")
}

function formatCorrelationData(data: ExportData): string {
  if (!data.correlation) return "## Ingredient Correlation Data\n\nNo correlation data available."

  const lines: string[] = []
  lines.push("## Ingredient Correlation Data")
  lines.push("")
  lines.push(`Scoreable days: ${data.correlation.scoreableDays}. Logged days: ${data.correlation.loggedDays}. Backfilled days: ${data.correlation.backfillDays}.`)
  lines.push("")
  lines.push("Note: Probiotics (products with type \"probiotic\") are excluded from correlation. Their ingredients are therapeutic bacterial strains at trace quantities — scores would just mirror paired primary food.")
  lines.push("")

  // GI Track (giMergedScores)
  lines.push("### GI Track (form-merged by ingredient family)")
  lines.push("")
  formatScoreTable(data.correlation.giMergedScores, lines, false)

  lines.push("")
  lines.push("### Skin/Itch Track (raw, separate forms)")
  lines.push("")
  formatScoreTable(data.correlation.scores, lines, true)

  return lines.join("\n")
}

function formatScoreTable(scores: IngredientScore[], lines: string[], includeSeasonalColumn: boolean): void {
  if (scores.length === 0) {
    lines.push("No scored ingredients.")
    return
  }

  // Sort by weighted poop/itch score descending (worst first for GI, best last)
  const sorted = [...scores].sort((a, b) => {
    const aScore = a.weightedPoopScore ?? a.weightedItchScore ?? 0
    const bScore = b.weightedPoopScore ?? b.weightedItchScore ?? 0
    return aScore - bScore
  })

  const header = includeSeasonalColumn
    ? "| Ingredient | Weighted Score | Raw Avg | Good | Bad | Data | Position | Products | Cross-Reactivity | Seasonally Confounded |"
    : "| Ingredient | Weighted Score | Raw Avg | Good | Bad | Data | Position | Products | Cross-Reactivity |"
  const divider = includeSeasonalColumn
    ? "|------------|----------------|---------|------|-----|------|----------|----------|------------------|-----------------------|"
    : "|------------|----------------|---------|------|-----|------|----------|----------|------------------|"

  lines.push(header)
  lines.push(divider)

  for (const s of sorted) {
    const wScore = includeSeasonalColumn
      ? round2(s.weightedItchScore)
      : round2(s.weightedPoopScore)
    const rawAvg = includeSeasonalColumn
      ? round2(s.rawAvgItchScore)
      : round2(s.rawAvgPoopScore)
    const good = includeSeasonalColumn ? s.goodItchDayCount : s.goodPoopDayCount
    const bad = includeSeasonalColumn ? s.badItchDayCount : s.badPoopDayCount
    const est = s.daysWithScorecardOnly + s.daysWithBackfill
    const dataStr = `${s.daysWithEventLogs} logged / ${est} est. / ${s.dayCount} total`
    const crossReact = s.crossReactivityGroup ?? "—"
    const seasonal = includeSeasonalColumn ? (s.itchSeasonallyConfounded ? "yes" : "no") : ""

    const row = includeSeasonalColumn
      ? `| ${s.key} | ${wScore} | ${rawAvg} | ${good} | ${bad} | ${dataStr} | ${s.positionCategory} | ${s.distinctProductCount} | ${crossReact} | ${seasonal} |`
      : `| ${s.key} | ${wScore} | ${rawAvg} | ${good} | ${bad} | ${dataStr} | ${s.positionCategory} | ${s.distinctProductCount} | ${crossReact} |`

    lines.push(row)
  }

  // Form breakdown rows for GI track
  if (!includeSeasonalColumn) {
    const withBreakdown = sorted.filter((s) => s.formBreakdown && s.formBreakdown.length > 1)
    if (withBreakdown.length > 0) {
      lines.push("")
      lines.push("#### GI Form Breakdown")
      for (const s of withBreakdown) {
        lines.push(`- **${s.key}**:`)
        for (const fb of s.formBreakdown!) {
          lines.push(`  - ${fb.key}: weighted ${round2(fb.weightedPoopScore)}, ${fb.dayCount} days`)
        }
      }
    }
  }
}

function formatMedicationConfounding(data: ExportData): string {
  if (!data.correlation) return ""

  const lines: string[] = []

  // Find medications that suppress itch or have GI side effects
  const itchMeds = data.medications.filter((m) => m.suppressesItch)
  const giMeds = data.medications.filter((m) => m.hasGiSideEffects)

  if (itchMeds.length === 0 && giMeds.length === 0) return ""

  lines.push("## Medication Confounding Analysis")
  lines.push("")
  lines.push("Medications can mask food reactions (itch suppressants) or create false food signals (GI side effects). Scores during active medication periods may not reflect true food sensitivity.")
  lines.push("")

  if (itchMeds.length > 0) {
    lines.push("### Itch-Suppressing Medications")
    for (const med of itchMeds) {
      lines.push(`- ${med.name}${med.dosage ? ` (${med.dosage})` : ""}: ${formatDateRange(med.startDate, med.endDate)}${med.drugClass ? ` — ${med.drugClass}` : ""}`)
    }
    lines.push("")
  }

  if (giMeds.length > 0) {
    lines.push("### Medications with GI Side Effects")
    for (const med of giMeds) {
      lines.push(`- ${med.name}${med.dosage ? ` (${med.dosage})` : ""}: ${formatDateRange(med.startDate, med.endDate)}${med.drugClass ? ` — ${med.drugClass}` : ""}`)
    }
    lines.push("")
  }

  // On/off score splits table
  const scores = data.correlation.giMergedScores
  const splittable = scores.filter((s) =>
    (s.onMedRawAvgPoopScore != null && s.offMedRawAvgPoopScore != null) ||
    (s.onMedRawAvgItchScore != null && s.offMedRawAvgItchScore != null),
  )

  if (splittable.length > 0) {
    lines.push("### On/Off Medication Score Splits")
    lines.push("")
    lines.push("| Ingredient | On-Med Poop | Off-Med Poop | On-Med Itch | Off-Med Itch | Poop Confounded | Itch Confounded |")
    lines.push("|------------|-------------|--------------|-------------|--------------|-----------------|-----------------|")

    for (const s of splittable) {
      lines.push(`| ${s.key} | ${round1(s.onMedRawAvgPoopScore)} | ${round1(s.offMedRawAvgPoopScore)} | ${round1(s.onMedRawAvgItchScore)} | ${round1(s.offMedRawAvgItchScore)} | ${s.poopMedicationConfounded ? "yes" : "no"} | ${s.itchMedicationConfounded ? "yes" : "no"} |`)
    }
    lines.push("")
  }

  // Summary
  const confoundedPoop = scores.filter((s) => s.poopMedicationConfounded)
  const confoundedItch = scores.filter((s) => s.itchMedicationConfounded)
  if (confoundedPoop.length > 0 || confoundedItch.length > 0) {
    lines.push("### Confounding Summary")
    lines.push("")
    if (confoundedPoop.length > 0) {
      lines.push(`- **GI confounded** (≥50% of scored days on GI-affecting med): ${confoundedPoop.map((s) => s.key).join(", ")}`)
    }
    if (confoundedItch.length > 0) {
      lines.push(`- **Itch confounded** (≥50% of scored days on itch suppressant): ${confoundedItch.map((s) => s.key).join(", ")}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

function formatPollenSymptomTable(data: ExportData): string {
  const lines: string[] = []
  lines.push("## Symptom Averages by Pollen Level")
  lines.push("")

  if (data.pollenBuckets.length === 0) {
    lines.push("No pollen data available.")
    return lines.join("\n")
  }

  lines.push("| Pollen Level | Days | Avg Poop | Avg Itch |")
  lines.push("|--------------|------|----------|----------|")

  for (const bucket of data.pollenBuckets) {
    lines.push(`| ${bucket.label} | ${bucket.days} | ${round1(bucket.avgPoop)} | ${round1(bucket.avgItch)} |`)
  }

  if (data.pollenCoverage) {
    lines.push("")
    lines.push(`Pollen data coverage: ${data.pollenCoverage.daysWithData} of ${data.pollenCoverage.totalDays} days.`)
  }
  if (data.pollenSource) {
    lines.push(`Pollen source: ${data.pollenSource.provider}, ${data.pollenSource.location}.`)
  }

  return lines.join("\n")
}

function formatResearchLinks(data: ExportData): string {
  const lines: string[] = []
  lines.push("## Links for Further Research")
  lines.push("")
  lines.push("### General References")
  lines.push("- [Common food allergen sources in dogs and cats](https://link.springer.com/article/10.1186/s12917-016-0633-8) — Mueller, Olivry & Prélaud 2016")
  lines.push("- [Adverse food reactions in dogs and atopic dermatitis](https://academy.royalcanin.com/en/veterinary/adverse-skin-reactions-to-food) — Royal Canin Academy")
  lines.push("- [Atopic dermatitis and intestinal epithelial damage in dogs](https://pmc.ncbi.nlm.nih.gov/articles/PMC11034634/) — Ekici & Ok 2024")
  lines.push("- [Cross-reactivity among food allergens for dogs](https://pubmed.ncbi.nlm.nih.gov/36043337/) — Olivry, O'Malley & Chruszcz 2022")
  lines.push("- [AAHA Management of Allergic Skin Diseases in Dogs and Cats](https://www.aaha.org/wp-content/uploads/globalassets/02-guidelines/2023-aaha-management-of-allergic-skin-diseases-in-dogs-and-cats-guidelines/resources/2023-aaha-management-of-allergic-skin-diseases-guidelines.pdf) — 2023 clinical guidelines")

  // Medication side effect sources
  const medSources = new Set<string>()
  for (const med of data.medications) {
    if (med.sideEffectsSources) {
      medSources.add(med.sideEffectsSources)
    }
  }

  if (medSources.size > 0) {
    lines.push("")
    lines.push("### Medication Side Effect Sources")
    for (const src of medSources) {
      lines.push(`- ${src}`)
    }
  }

  return lines.join("\n")
}

function formatCrossReactivity(data: ExportData): string {
  const lines: string[] = []
  lines.push("## Cross-Reactivity Groups")
  lines.push("")
  lines.push("Dogs allergic to one protein may react to related proteins in the same biological group.")

  if (data.crossReactivityGroups.length === 0) {
    lines.push("No cross-reactivity data available.")
    return lines.join("\n")
  }

  for (const group of data.crossReactivityGroups) {
    lines.push(`- **${group.groupName}**: ${group.families.join(", ")}`)
  }

  return lines.join("\n")
}

function formatReferenceStats(data: ExportData): string {
  const lines: string[] = []
  lines.push("## Computed Reference Stats")
  lines.push("")

  // Constant ingredients
  if (data.constantIngredients.length > 0) {
    lines.push("### Ingredients Present in ALL Foods Tried")
    lines.push("")
    lines.push(data.constantIngredients.join(", "))
    lines.push("")
  }

  // Unique ingredients per period
  if (data.uniqueIngredientsByPeriod.size > 0) {
    lines.push("### Ingredients Unique to Each Food Period")
    lines.push("")
    for (const [periodNum, ings] of data.uniqueIngredientsByPeriod) {
      if (ings.length > 0) {
        lines.push(`- Period #${periodNum}: ${ings.join(", ")}`)
      }
    }
    lines.push("")
  }

  // Avg poop entries per day
  if (data.avgPoopEntriesPerDay !== null) {
    lines.push("### Stool Frequency")
    lines.push("")
    lines.push(`Average poop log entries per day (from days with ≥1 entry): ${round1(data.avgPoopEntriesPerDay)}`)
    lines.push("")
  }

  // Body area frequency
  if (data.bodyAreaFrequency.length > 0) {
    lines.push("### Itch Body Area Frequency")
    lines.push("")
    lines.push("Percentage of itch-logged days each body area was recorded:")
    lines.push("")
    for (const ba of data.bodyAreaFrequency) {
      lines.push(`- ${ba.area}: ${Math.round(ba.percent)}%`)
    }
    lines.push("")
  }

  // Medication change events
  if (data.itchChangeEvents.length > 0) {
    lines.push("### Symptom Changes Near Medication Events")
    lines.push("")
    lines.push("Dates within 7 days of medication start/stop/dose change:")
    lines.push("")
    lines.push("| Date | Event | Medication | Avg Poop Before | Avg Poop After | Avg Itch Before | Avg Itch After |")
    lines.push("|------|-------|------------|-----------------|----------------|-----------------|----------------|")
    for (const e of data.itchChangeEvents) {
      lines.push(`| ${e.date} | ${e.event} | ${e.medication} | ${round1(e.avgPoopBefore)} | ${round1(e.avgPoopAfter)} | ${round1(e.avgItchBefore)} | ${round1(e.avgItchAfter)} |`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

export function buildExportMarkdown(
  data: ExportData,
  excludeSections: Set<ExportSection>,
): string {
  const dedup = new ProductDedup()
  dedup.prePopulate(data.feedingPeriods, data.products)
  const sections: string[] = []

  // Preamble — always included
  sections.push(formatPreamble(data))

  // Scoring & Coverage — always included
  sections.push(formatScoringAndCoverage(data))

  if (!excludeSections.has("profile")) {
    sections.push(formatProfile(data))
  }

  if (!excludeSections.has("current-diet")) {
    sections.push(formatCurrentDiet(data, dedup))
  }

  if (!excludeSections.has("supplements")) {
    sections.push(formatSupplements(data, dedup))
  }

  if (!excludeSections.has("medications")) {
    sections.push(formatCurrentMedications(data))
  }

  if (!excludeSections.has("daily-log")) {
    sections.push(formatDailyLogTable(data))
  }

  if (!excludeSections.has("food-history")) {
    sections.push(formatFoodHistory(data, dedup))
  }

  if (!excludeSections.has("medication-history")) {
    sections.push(formatMedicationHistory(data))
  }

  if (!excludeSections.has("correlation")) {
    sections.push(formatCorrelationData(data))
  }

  if (!excludeSections.has("medication-confounding")) {
    const confoundingSection = formatMedicationConfounding(data)
    if (confoundingSection) sections.push(confoundingSection)
  }

  if (!excludeSections.has("pollen") && data.dog.environmentEnabled) {
    sections.push(formatPollenSymptomTable(data))
  }

  if (!excludeSections.has("links")) {
    sections.push(formatResearchLinks(data))
  }

  if (!excludeSections.has("cross-reactivity")) {
    sections.push(formatCrossReactivity(data))
  }

  if (!excludeSections.has("reference-stats")) {
    sections.push(formatReferenceStats(data))
  }

  return sections.join("\n\n") + "\n"
}
