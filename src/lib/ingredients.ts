/**
 * Shared ingredient utilities — used by both API routes and UI.
 */

export interface CommonTrigger {
  family: string
  percentage: number
  note?: string
}

/**
 * Most common cutaneous adverse food reaction triggers in dogs.
 * Source: Mueller et al. 2016, BMC Vet Research — skin reactions only.
 */
export const COMMON_SKIN_TRIGGERS: CommonTrigger[] = [
  { family: "beef", percentage: 34, note: "Most common skin allergen" },
  { family: "dairy", percentage: 17, note: "Includes milk, cheese, whey" },
  { family: "chicken", percentage: 15, note: "All poultry forms (meal, by-product)" },
  { family: "wheat", percentage: 13, note: "Gluten-containing grain" },
  { family: "soy", percentage: 6 },
  { family: "lamb", percentage: 5 },
  { family: "corn", percentage: 4 },
  { family: "egg", percentage: 4 },
  { family: "pork", percentage: 2 },
  { family: "fish", percentage: 2 },
  { family: "rice", percentage: 2 },
]

const COMMON_SKIN_TRIGGER_FAMILIES = new Set(COMMON_SKIN_TRIGGERS.map((t) => t.family))

export function isCommonSkinTrigger(family: string): boolean {
  return COMMON_SKIN_TRIGGER_FAMILIES.has(family)
}

/**
 * Find the position of salt in a raw ingredient string.
 * Ingredients after salt are generally present at < 1% by weight.
 * Uses bracket-aware comma splitting to handle parenthetical notes.
 *
 * Returns 1-indexed position or null if salt not found.
 */
export function findSaltPosition(rawIngredientString: string): number | null {
  if (!rawIngredientString) return null

  const items = splitIngredients(rawIngredientString)
  for (let i = 0; i < items.length; i++) {
    const normalized = items[i].toLowerCase().trim()
    if (normalized === "salt" || normalized === "salt." || normalized === "sea salt") {
      return i + 1
    }
  }
  return null
}

/**
 * Bracket-aware comma split for ingredient strings.
 * Handles parenthetical sub-ingredients like "Chicken Meal (source of Glucosamine)".
 */
export function splitIngredients(rawIngredientString: string): string[] {
  const items: string[] = []
  let current = ""
  let depth = 0

  for (const char of rawIngredientString) {
    if (char === "(" || char === "[") {
      depth++
      current += char
    } else if (char === ")" || char === "]") {
      depth = Math.max(0, depth - 1)
      current += char
    } else if (char === "," && depth === 0) {
      const trimmed = current.trim()
      if (trimmed) items.push(trimmed)
      current = ""
    } else {
      current += char
    }
  }

  const trimmed = current.trim()
  // Strip trailing period from last ingredient
  if (trimmed) items.push(trimmed.replace(/\.$/, ""))

  return items
}
