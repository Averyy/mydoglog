import { describe, it, expect } from "vitest"
import {
  computeTransitionSchedule,
  isMainFoodType,
  type TransitionItem,
} from "./transition"

describe("isMainFoodType", () => {
  it("returns true for food type", () => {
    expect(isMainFoodType("food")).toBe(true)
  })

  it("returns true for null type (defaults to food)", () => {
    expect(isMainFoodType(null)).toBe(true)
  })

  it("returns false for supplement", () => {
    expect(isMainFoodType("supplement")).toBe(false)
  })

  it("returns false for treat", () => {
    expect(isMainFoodType("treat")).toBe(false)
  })

  it("returns false for topper", () => {
    expect(isMainFoodType("topper")).toBe(false)
  })
})

describe("computeTransitionSchedule", () => {
  const oldFood: TransitionItem[] = [
    { productId: "old-food", quantity: "2", quantityUnit: "cup", type: "food" },
  ]

  const newFood: TransitionItem[] = [
    { productId: "new-food", quantity: "1.5", quantityUnit: "cup", type: "food" },
  ]

  it("returns empty array when transitionDays <= 0", () => {
    expect(computeTransitionSchedule(oldFood, newFood, 0, "2026-03-01")).toEqual([])
    expect(computeTransitionSchedule(oldFood, newFood, -1, "2026-03-01")).toEqual([])
  })

  it("computes 1-day transition correctly", () => {
    const result = computeTransitionSchedule(oldFood, newFood, 1, "2026-03-01")
    expect(result).toHaveLength(1)
    expect(result[0].date).toBe("2026-03-01")
    // Day 1 of 1: newFraction = 1/2 = 0.5, oldFraction = 0.5
    const oldItem = result[0].items.find((i) => i.productId === "old-food")
    const newItem = result[0].items.find((i) => i.productId === "new-food")
    expect(oldItem?.quantity).toBe("1") // 2 * 0.5
    expect(newItem?.quantity).toBe("0.75") // 1.5 * 0.5
  })

  it("computes 3-day transition with correct fractions", () => {
    const result = computeTransitionSchedule(oldFood, newFood, 3, "2026-03-10")
    expect(result).toHaveLength(3)

    // Day 1: newFraction = 1/4 = 0.25, oldFraction = 0.75
    expect(result[0].date).toBe("2026-03-10")
    expect(result[0].items.find((i) => i.productId === "old-food")?.quantity).toBe("1.5") // 2 * 0.75
    expect(result[0].items.find((i) => i.productId === "new-food")?.quantity).toBe("0.38") // 1.5 * 0.25

    // Day 2: newFraction = 2/4 = 0.5, oldFraction = 0.5
    expect(result[1].date).toBe("2026-03-11")
    expect(result[1].items.find((i) => i.productId === "old-food")?.quantity).toBe("1") // 2 * 0.5
    expect(result[1].items.find((i) => i.productId === "new-food")?.quantity).toBe("0.75") // 1.5 * 0.5

    // Day 3: newFraction = 3/4 = 0.75, oldFraction = 0.25
    expect(result[2].date).toBe("2026-03-12")
    expect(result[2].items.find((i) => i.productId === "old-food")?.quantity).toBe("0.5") // 2 * 0.25
    expect(result[2].items.find((i) => i.productId === "new-food")?.quantity).toBe("1.13") // 1.5 * 0.75
  })

  it("computes 7-day transition", () => {
    const result = computeTransitionSchedule(oldFood, newFood, 7, "2026-03-01")
    expect(result).toHaveLength(7)
    // Day 7: newFraction = 7/8 = 0.875
    const lastDay = result[6]
    expect(lastDay.date).toBe("2026-03-07")
    expect(lastDay.items.find((i) => i.productId === "new-food")?.quantity).toBe("1.31") // 1.5 * 0.875
    expect(lastDay.items.find((i) => i.productId === "old-food")?.quantity).toBe("0.25") // 2 * 0.125
  })

  it("passes supplements through from NEW items at full quantity", () => {
    const newWithSupplement: TransitionItem[] = [
      { productId: "new-food", quantity: "1.5", quantityUnit: "cup", type: "food" },
      { productId: "probiotic", quantity: "1", quantityUnit: "scoop", type: "supplement" },
    ]

    const result = computeTransitionSchedule(oldFood, newWithSupplement, 3, "2026-03-01")

    // Every day should have the supplement at full quantity
    for (const day of result) {
      const supp = day.items.find((i) => i.productId === "probiotic")
      expect(supp).toBeDefined()
      expect(supp?.quantity).toBe("1")
      expect(supp?.quantityUnit).toBe("scoop")
    }
  })

  it("excludes old supplements (only passes NEW supplements)", () => {
    const oldWithSupplement: TransitionItem[] = [
      { productId: "old-food", quantity: "2", quantityUnit: "cup", type: "food" },
      { productId: "old-supp", quantity: "1", quantityUnit: "scoop", type: "supplement" },
    ]

    const result = computeTransitionSchedule(oldWithSupplement, newFood, 2, "2026-03-01")

    for (const day of result) {
      expect(day.items.find((i) => i.productId === "old-supp")).toBeUndefined()
    }
  })

  it("handles mixed units correctly", () => {
    const oldItems: TransitionItem[] = [
      { productId: "old-dry", quantity: "1", quantityUnit: "cup", type: "food" },
    ]
    const newItems: TransitionItem[] = [
      { productId: "new-wet", quantity: "400", quantityUnit: "g", type: "food" },
    ]

    const result = computeTransitionSchedule(oldItems, newItems, 3, "2026-03-01")
    expect(result).toHaveLength(3)
    // Day 1: old = 1 * 0.75 = 0.75 cup, new = 400 * 0.25 = 100g
    expect(result[0].items.find((i) => i.productId === "old-dry")?.quantity).toBe("0.75")
    expect(result[0].items.find((i) => i.productId === "old-dry")?.quantityUnit).toBe("cup")
    expect(result[0].items.find((i) => i.productId === "new-wet")?.quantity).toBe("100")
    expect(result[0].items.find((i) => i.productId === "new-wet")?.quantityUnit).toBe("g")
  })

  it("rounds to 2 decimal places", () => {
    const old: TransitionItem[] = [
      { productId: "a", quantity: "3", quantityUnit: "cup", type: "food" },
    ]
    const nw: TransitionItem[] = [
      { productId: "b", quantity: "3", quantityUnit: "cup", type: "food" },
    ]

    const result = computeTransitionSchedule(old, nw, 7, "2026-03-01")
    // Day 1: 1/8 = 0.125, 3 * 0.125 = 0.375... should round to 0.38
    for (const day of result) {
      for (const item of day.items) {
        const parts = item.quantity.split(".")
        if (parts.length > 1) {
          expect(parts[1].length).toBeLessThanOrEqual(2)
        }
      }
    }
  })

  it("handles multiple old and new foods", () => {
    const oldItems: TransitionItem[] = [
      { productId: "old-a", quantity: "1", quantityUnit: "cup", type: "food" },
      { productId: "old-b", quantity: "0.5", quantityUnit: "can", type: "food" },
    ]
    const newItems: TransitionItem[] = [
      { productId: "new-a", quantity: "200", quantityUnit: "g", type: "food" },
      { productId: "new-b", quantity: "1", quantityUnit: "cup", type: "food" },
    ]

    const result = computeTransitionSchedule(oldItems, newItems, 3, "2026-03-01")
    expect(result).toHaveLength(3)
    // Day 1 should have 4 items (2 old + 2 new)
    expect(result[0].items).toHaveLength(4)
  })
})
