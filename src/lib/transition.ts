/**
 * Food transition schedule computation.
 * Pure functions — no DB access.
 */

import { shiftDate } from "@/lib/date-utils"

/** Product types that are NOT main food — passed through at full quantity. */
const NON_MAIN_FOOD_TYPES = new Set(["supplement", "treat", "topper"])

/** Returns true if the product type is a main food (not supplement/treat/topper). */
export function isMainFoodType(type: string | null): boolean {
  if (!type) return true // default to food if unknown
  return !NON_MAIN_FOOD_TYPES.has(type)
}

export interface TransitionItem {
  productId: string
  quantity: string
  quantityUnit: string
  mealSlot?: string
  type?: string | null
}

export interface TransitionDayRow {
  date: string
  items: TransitionItem[]
}

/**
 * Compute the daily feeding schedule for a gradual food transition.
 *
 * Day d of N: newFraction = d / (N + 1), oldFraction = 1 - newFraction
 * Supplements/toppers from the NEW plan pass through at full quantity.
 * Rounds quantities to 2 decimal places.
 *
 * Returns empty array when transitionDays <= 0.
 */
export function computeTransitionSchedule(
  oldItems: TransitionItem[],
  newItems: TransitionItem[],
  transitionDays: number,
  startDate: string,
): TransitionDayRow[] {
  if (transitionDays <= 0) return []

  const rows: TransitionDayRow[] = []

  for (let d = 1; d <= transitionDays; d++) {
    const date = shiftDate(startDate, d - 1)
    const newFraction = d / (transitionDays + 1)
    const oldFraction = 1 - newFraction

    const dayItems: TransitionItem[] = []

    // Old main food items at reduced quantity
    for (const item of oldItems) {
      if (!isMainFoodType(item.type ?? null)) continue
      const qty = Math.round(parseFloat(item.quantity) * oldFraction * 100) / 100
      if (qty <= 0) continue
      dayItems.push({
        productId: item.productId,
        quantity: String(qty),
        quantityUnit: item.quantityUnit,
        mealSlot: item.mealSlot,
        type: item.type,
      })
    }

    // New main food items at increasing quantity
    for (const item of newItems) {
      if (!isMainFoodType(item.type ?? null)) continue
      const qty = Math.round(parseFloat(item.quantity) * newFraction * 100) / 100
      if (qty <= 0) continue
      dayItems.push({
        productId: item.productId,
        quantity: String(qty),
        quantityUnit: item.quantityUnit,
        mealSlot: item.mealSlot,
        type: item.type,
      })
    }

    // Supplements/toppers from NEW items at full quantity
    for (const item of newItems) {
      if (isMainFoodType(item.type ?? null)) continue
      dayItems.push({
        productId: item.productId,
        quantity: item.quantity,
        quantityUnit: item.quantityUnit,
        mealSlot: item.mealSlot,
        type: item.type,
      })
    }

    rows.push({ date, items: dayItems })
  }

  return rows
}
