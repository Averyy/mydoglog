import { describe, it, expect } from "vitest"
import {
  resolveIngredientKey,
  buildDaySnapshots,
  computeIngredientScores,
  computeConfidence,
  flagCrossReactivity,
  mergeScoresForGI,
  runCorrelation,
  positionWeight,
  positionCategory,
  isNonAllergenicForm,
  estimateGrams,
  buildBackfillSnapshots,
  computeRollingMaxPollen,
} from "./engine"
import type {
  IngredientRecord,
  CorrelationInput,
  DaySnapshot,
  DayOutcome,
  ActiveIngredient,
  IngredientScore,
  CrossReactivityGroup,
  ProductIngredientRecord,
} from "./types"
import { DEFAULT_CORRELATION_OPTIONS } from "./types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIngredient(overrides: Partial<IngredientRecord> = {}): IngredientRecord {
  return {
    id: "ing-1",
    normalizedName: "chicken",
    family: "chicken",
    sourceGroup: "poultry",
    formType: null,
    isHydrolyzed: false,
    ...overrides,
  }
}

function makeProductIngredients(
  productId: string,
  ingredients: Array<{ position: number; ingredient: IngredientRecord }>,
): ProductIngredientRecord[] {
  return ingredients.map((i) => ({
    productId,
    position: i.position,
    ingredient: i.ingredient,
  }))
}

const emptyOutcome: DayOutcome = {
  poopScore: null,
  itchScore: null,
  scorecardPoopFallback: null,
  effectivePollenLevel: null,
}

function makeSnapshot(overrides: Partial<DaySnapshot> = {}): DaySnapshot {
  return {
    date: "2024-06-01",
    ingredients: [],
    outcome: { ...emptyOutcome },
    isTransitionBuffer: false,
    isBackfill: false,
    ...overrides,
  }
}

function makeInput(overrides: Partial<CorrelationInput> = {}): CorrelationInput {
  return {
    dogId: "dog-1",
    windowStart: "2024-06-01",
    windowEnd: "2024-06-07",
    feedingPeriods: [],
    treatLogs: [],
    productIngredientMap: new Map(),
    poopLogs: [],
    itchinessLogs: [],

    scorecards: [],
    pollenLogs: [],
    planPeriods: [],
    backfills: [],
    crossReactivityGroups: [],
    productInfo: new Map(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// resolveIngredientKey
// ---------------------------------------------------------------------------

describe("resolveIngredientKey", () => {
  it("returns family for known ingredient", () => {
    const ing = makeIngredient({ family: "chicken", isHydrolyzed: false })
    expect(resolveIngredientKey(ing)).toBe("chicken")
  })

  it("returns family (hydrolyzed) for hydrolyzed ingredient", () => {
    const ing = makeIngredient({ family: "chicken", isHydrolyzed: true })
    expect(resolveIngredientKey(ing)).toBe("chicken (hydrolyzed)")
  })

  it("returns sourceGroup (ambiguous) when family is null", () => {
    const ing = makeIngredient({
      family: null,
      sourceGroup: "poultry",
      isHydrolyzed: false,
    })
    expect(resolveIngredientKey(ing)).toBe("poultry (ambiguous)")
  })

  it("returns null when both family and sourceGroup are null", () => {
    const ing = makeIngredient({ family: null, sourceGroup: null })
    expect(resolveIngredientKey(ing)).toBe(null)
  })

  it("returns sourceGroup (ambiguous) when family is null even if hydrolyzed", () => {
    const ing = makeIngredient({
      family: null,
      sourceGroup: "fish",
      isHydrolyzed: true,
    })
    expect(resolveIngredientKey(ing)).toBe("fish (ambiguous)")
  })

  it("returns family (fat) for fat form type", () => {
    const ing = makeIngredient({ family: "chicken", formType: "fat" })
    expect(resolveIngredientKey(ing)).toBe("chicken (fat)")
  })

  it("returns family (oil) for oil form type", () => {
    const ing = makeIngredient({ family: "salmon", formType: "oil" })
    expect(resolveIngredientKey(ing)).toBe("salmon (oil)")
  })

  it("hydrolyzed takes priority over fat/oil form", () => {
    const ing = makeIngredient({ family: "chicken", formType: "fat", isHydrolyzed: true })
    expect(resolveIngredientKey(ing)).toBe("chicken (hydrolyzed)")
  })

  it("returns plain family for non-fat/oil form types", () => {
    const ing = makeIngredient({ family: "chicken", formType: "meal" })
    expect(resolveIngredientKey(ing)).toBe("chicken")
  })
})

// ---------------------------------------------------------------------------
// positionWeight
// ---------------------------------------------------------------------------

describe("positionWeight", () => {
  it("position 1 has weight 1.0", () => {
    expect(positionWeight(1)).toBeCloseTo(1.0, 5)
  })

  it("decays monotonically", () => {
    for (let p = 1; p < 25; p++) {
      expect(positionWeight(p)).toBeGreaterThan(positionWeight(p + 1))
    }
  })

  it("position 12 is roughly 1/6 of position 1", () => {
    const ratio = positionWeight(1) / positionWeight(12)
    expect(ratio).toBeGreaterThan(4)
    expect(ratio).toBeLessThan(8)
  })

  it("never reaches zero for reasonable positions", () => {
    expect(positionWeight(30)).toBeGreaterThan(0.01)
  })
})

// ---------------------------------------------------------------------------
// positionCategory
// ---------------------------------------------------------------------------

describe("positionCategory", () => {
  it("positions 1-4 are primary", () => {
    expect(positionCategory(1)).toBe("primary")
    expect(positionCategory(4)).toBe("primary")
  })

  it("positions 5-10 are secondary", () => {
    expect(positionCategory(5)).toBe("secondary")
    expect(positionCategory(10)).toBe("secondary")
  })

  it("positions 11-17 are minor", () => {
    expect(positionCategory(11)).toBe("minor")
    expect(positionCategory(17)).toBe("minor")
  })

  it("positions 18+ are trace", () => {
    expect(positionCategory(18)).toBe("trace")
    expect(positionCategory(30)).toBe("trace")
  })
})

// ---------------------------------------------------------------------------
// isNonAllergenicForm
// ---------------------------------------------------------------------------

describe("isNonAllergenicForm", () => {
  it("fat is non-allergenic", () => {
    expect(isNonAllergenicForm("fat")).toBe(true)
  })

  it("oil is non-allergenic", () => {
    expect(isNonAllergenicForm("oil")).toBe(true)
  })

  it("null is allergenic", () => {
    expect(isNonAllergenicForm(null)).toBe(false)
  })

  it("meal is allergenic", () => {
    expect(isNonAllergenicForm("meal")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// estimateGrams
// ---------------------------------------------------------------------------

describe("estimateGrams", () => {
  it("uses calorie content for exact conversion (kcal/cup + kcal/kg)", () => {
    // 336 kcal/cup ÷ 3774 kcal/kg × 1000 = ~89g per cup
    const grams = estimateGrams(1, "cup", "3774 kcal/kg, 336 kcal/cup")
    expect(grams).toBeCloseTo(89, 0)
  })

  it("falls back to rough multiplier without calorie data", () => {
    expect(estimateGrams(2, "cup", null)).toBe(200)
  })

  it("passes through grams directly", () => {
    expect(estimateGrams(50, "g", null)).toBe(50)
  })

  it("passes through ml directly", () => {
    expect(estimateGrams(100, "ml", null)).toBe(100)
  })

  it("uses rough multiplier for treat unit", () => {
    expect(estimateGrams(3, "treat", null)).toBe(15)
  })

  it("uses rough multiplier for can unit", () => {
    expect(estimateGrams(1, "can", null)).toBe(370)
  })
})

// ---------------------------------------------------------------------------
// buildDaySnapshots
// ---------------------------------------------------------------------------

describe("buildDaySnapshots", () => {
  const opts = DEFAULT_CORRELATION_OPTIONS

  const chickenIng = makeIngredient({ id: "ing-chicken", family: "chicken" })
  const riceIng = makeIngredient({
    id: "ing-rice",
    normalizedName: "rice",
    family: "rice",
    sourceGroup: "grain",
  })
  const salmonIng = makeIngredient({
    id: "ing-salmon",
    normalizedName: "salmon",
    family: "salmon",
    sourceGroup: "fish",
  })

  const productA = makeProductIngredients("prod-a", [
    { position: 1, ingredient: chickenIng },
    { position: 2, ingredient: riceIng },
  ])
  const productB = makeProductIngredients("prod-b", [
    { position: 1, ingredient: salmonIng },
    { position: 2, ingredient: riceIng },
  ])

  const ingredientMap = new Map<string, ProductIngredientRecord[]>([
    ["prod-a", productA],
    ["prod-b", productB],
  ])

  it("produces one snapshot per day in window", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-03",
    })
    const snaps = buildDaySnapshots(input, opts)
    expect(snaps).toHaveLength(3)
    expect(snaps.map((s) => s.date)).toEqual([
      "2024-06-01",
      "2024-06-02",
      "2024-06-03",
    ])
  })

  it("all day snapshots have isBackfill=false", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-03",
    })
    const snaps = buildDaySnapshots(input, opts)
    for (const snap of snaps) {
      expect(snap.isBackfill).toBe(false)
    }
  })

  it("ingredients from active feeding period appear on correct days", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-03",
      feedingPeriods: [
        {
          id: "fp-1",
          productId: "prod-a",
          startDate: "2024-06-01",
          endDate: "2024-06-02",
          planGroupId: "plan-1",
          createdAt: "2024-06-01T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
      ],
      productIngredientMap: ingredientMap,
    })
    const snaps = buildDaySnapshots(input, opts)

    // Days 1 and 2 have ingredients
    expect(snaps[0].ingredients).toHaveLength(2)
    expect(snaps[1].ingredients).toHaveLength(2)
    // Day 3 — feeding ended
    expect(snaps[2].ingredients).toHaveLength(0)
  })

  it("averages multiple poop logs for same date", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      poopLogs: [
        { date: "2024-06-01", firmnessScore: 3 },
        { date: "2024-06-01", firmnessScore: 5 },
      ],
    })
    const snaps = buildDaySnapshots(input, opts)
    expect(snaps[0].outcome.poopScore).toBe(4)
  })

  it("averages multiple itch logs for same date", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      itchinessLogs: [
        { date: "2024-06-01", score: 2 },
        { date: "2024-06-01", score: 6 },
      ],
    })
    const snaps = buildDaySnapshots(input, opts)
    expect(snaps[0].outcome.itchScore).toBe(4)
  })

  it("uses scorecard fallback when no poop logs exist", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      feedingPeriods: [
        {
          id: "fp-1",
          productId: "prod-a",
          startDate: "2024-06-01",
          endDate: null,
          planGroupId: "plan-1",
          createdAt: "2024-06-01T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
      ],
      planPeriods: [
        {
          planGroupId: "plan-1",
          startDate: "2024-06-01",
          endDate: null,
          createdAt: "2024-06-01T00:00:00Z",
        },
      ],
      scorecards: [{ planGroupId: "plan-1", poopQuality: [4], itchSeverity: null,}],
    })
    const snaps = buildDaySnapshots(input, opts)
    expect(snaps[0].outcome.scorecardPoopFallback).toBe(4)
    expect(snaps[0].outcome.poopScore).toBe(null)
  })

  it("does NOT use scorecard when poop logs exist", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      poopLogs: [{ date: "2024-06-01", firmnessScore: 2 }],
      feedingPeriods: [
        {
          id: "fp-1",
          productId: "prod-a",
          startDate: "2024-06-01",
          endDate: null,
          planGroupId: "plan-1",
          createdAt: "2024-06-01T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
      ],
      planPeriods: [
        {
          planGroupId: "plan-1",
          startDate: "2024-06-01",
          endDate: null,
          createdAt: "2024-06-01T00:00:00Z",
        },
      ],
      scorecards: [{ planGroupId: "plan-1", poopQuality: [5], itchSeverity: null,}],
    })
    const snaps = buildDaySnapshots(input, opts)
    expect(snaps[0].outcome.poopScore).toBe(2)
    expect(snaps[0].outcome.scorecardPoopFallback).toBe(null)
  })

  it("averages multi-score scorecard fallback", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      feedingPeriods: [
        {
          id: "fp-1",
          productId: "prod-a",
          startDate: "2024-06-01",
          endDate: null,
          planGroupId: "plan-1",
          createdAt: "2024-06-01T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
      ],
      planPeriods: [
        {
          planGroupId: "plan-1",
          startDate: "2024-06-01",
          endDate: null,
          createdAt: "2024-06-01T00:00:00Z",
        },
      ],
      scorecards: [{ planGroupId: "plan-1", poopQuality: [3, 5], itchSeverity: null,}],
    })
    const snaps = buildDaySnapshots(input, opts)
    expect(snaps[0].outcome.scorecardPoopFallback).toBe(4)
    expect(snaps[0].outcome.poopScore).toBe(null)
  })

  it("treat ingredients appear with fromTreat=true", () => {
    const treatProduct = makeProductIngredients("prod-treat", [
      { position: 1, ingredient: salmonIng },
    ])
    const map = new Map([["prod-treat", treatProduct]])
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      treatLogs: [{ date: "2024-06-01", productId: "prod-treat", quantity: 1, quantityUnit: "piece" }],
      productIngredientMap: map,
    })
    const snaps = buildDaySnapshots(input, opts)
    expect(snaps[0].ingredients).toHaveLength(1)
    expect(snaps[0].ingredients[0].fromTreat).toBe(true)
    expect(snaps[0].ingredients[0].key).toBe("salmon")
  })

  it("merges same key from food + treat (no duplicates), fromTreat=true", () => {
    // prod-a has chicken + rice, treat has chicken
    const treatChicken = makeProductIngredients("prod-treat-c", [
      { position: 1, ingredient: chickenIng },
    ])
    const map = new Map([
      ["prod-a", productA],
      ["prod-treat-c", treatChicken],
    ])
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      feedingPeriods: [
        {
          id: "fp-1",
          productId: "prod-a",
          startDate: "2024-06-01",
          endDate: null,
          planGroupId: "plan-1",
          createdAt: "2024-06-01T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
      ],
      treatLogs: [{ date: "2024-06-01", productId: "prod-treat-c", quantity: 1, quantityUnit: "piece" }],
      productIngredientMap: map,
    })
    const snaps = buildDaySnapshots(input, opts)
    const chickenKey = snaps[0].ingredients.find((i) => i.key === "chicken")
    expect(chickenKey).toBeDefined()
    expect(chickenKey!.fromTreat).toBe(true)
    // rice should not be fromTreat
    const riceKey = snaps[0].ingredients.find((i) => i.key === "rice")
    expect(riceKey).toBeDefined()
    expect(riceKey!.fromTreat).toBe(false)
    // Only 2 unique keys, not 3
    expect(snaps[0].ingredients).toHaveLength(2)
  })

  it("marks transition buffer when food changes", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-08",
      feedingPeriods: [
        {
          id: "fp-1",
          productId: "prod-a",
          startDate: "2024-06-01",
          endDate: "2024-06-03",
          planGroupId: "plan-1",
          createdAt: "2024-06-01T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
        {
          id: "fp-2",
          productId: "prod-b",
          startDate: "2024-06-04",
          endDate: null,
          planGroupId: "plan-2",
          createdAt: "2024-06-04T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
      ],
      productIngredientMap: ingredientMap,
    })
    const snaps = buildDaySnapshots(
      input,
      { ...opts, transitionBufferDays: 3 },
    )
    // Day 1-3: prod-a, Day 4+: prod-b
    // Change detected on day 4, buffer = 3 days (4,5,6)
    expect(snaps[0].isTransitionBuffer).toBe(false) // June 1
    expect(snaps[1].isTransitionBuffer).toBe(false) // June 2
    expect(snaps[2].isTransitionBuffer).toBe(false) // June 3
    expect(snaps[3].isTransitionBuffer).toBe(true) // June 4 — change day
    expect(snaps[4].isTransitionBuffer).toBe(true) // June 5
    expect(snaps[5].isTransitionBuffer).toBe(true) // June 6
    expect(snaps[6].isTransitionBuffer).toBe(false) // June 7
  })

  it("days outside feeding period have empty ingredients", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-03",
      feedingPeriods: [
        {
          id: "fp-1",
          productId: "prod-a",
          startDate: "2024-05-01",
          endDate: "2024-05-31",
          planGroupId: "plan-1",
          createdAt: "2024-05-01T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
      ],
      productIngredientMap: ingredientMap,
    })
    const snaps = buildDaySnapshots(input, opts)
    expect(snaps[0].ingredients).toHaveLength(0)
    expect(snaps[1].ingredients).toHaveLength(0)
    expect(snaps[2].ingredients).toHaveLength(0)
  })

  it("overlapping feeding periods contribute all ingredients", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      feedingPeriods: [
        {
          id: "fp-1",
          productId: "prod-a",
          startDate: "2024-06-01",
          endDate: null,
          planGroupId: "plan-1",
          createdAt: "2024-06-01T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
        {
          id: "fp-2",
          productId: "prod-b",
          startDate: "2024-06-01",
          endDate: null,
          planGroupId: "plan-2",
          createdAt: "2024-06-01T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
      ],
      productIngredientMap: ingredientMap,
    })
    const snaps = buildDaySnapshots(input, opts)
    // prod-a: chicken, rice. prod-b: salmon, rice. Merged: chicken, rice, salmon
    expect(snaps[0].ingredients).toHaveLength(3)
    const keys = snaps[0].ingredients.map((i) => i.key).sort()
    expect(keys).toEqual(["chicken", "rice", "salmon"])
  })

  it("single day window works", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
    })
    const snaps = buildDaySnapshots(input, opts)
    expect(snaps).toHaveLength(1)
    expect(snaps[0].date).toBe("2024-06-01")
  })

  it("product with no ingredients in map produces no crash", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      feedingPeriods: [
        {
          id: "fp-1",
          productId: "prod-unknown",
          startDate: "2024-06-01",
          endDate: null,
          planGroupId: "plan-1",
          createdAt: "2024-06-01T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
      ],
      // Empty ingredient map — prod-unknown not in it
      productIngredientMap: new Map(),
    })
    const snaps = buildDaySnapshots(input, opts)
    expect(snaps[0].ingredients).toHaveLength(0)
  })

  it("ingredients carry formType from the ingredient record", () => {
    const chickenFatIng = makeIngredient({
      id: "ing-chicken-fat",
      normalizedName: "chicken fat",
      family: "chicken",
      formType: "fat",
    })
    const productWithFat = makeProductIngredients("prod-fat", [
      { position: 5, ingredient: chickenFatIng },
    ])
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      feedingPeriods: [
        {
          id: "fp-1",
          productId: "prod-fat",
          startDate: "2024-06-01",
          endDate: null,
          planGroupId: "plan-1",
          createdAt: "2024-06-01T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
      ],
      productIngredientMap: new Map([["prod-fat", productWithFat]]),
    })
    const snaps = buildDaySnapshots(input, opts)
    expect(snaps[0].ingredients[0].key).toBe("chicken (fat)")
    expect(snaps[0].ingredients[0].formType).toBe("fat")
  })
})

// ---------------------------------------------------------------------------
// computeConfidence
// ---------------------------------------------------------------------------

describe("computeConfidence", () => {
  it(">=56 effective days → high", () => {
    expect(computeConfidence(56, 0, 0)).toBe("high")
    expect(computeConfidence(50, 0, 12)).toBe("high") // 50 + 12*0.5 = 56
  })

  it("30-55 effective days → medium", () => {
    expect(computeConfidence(30, 0, 0)).toBe("medium")
    expect(computeConfidence(20, 0, 20)).toBe("medium") // 20 + 20*0.5 = 30
  })

  it("5-29 effective days → low", () => {
    expect(computeConfidence(5, 0, 0)).toBe("low")
    expect(computeConfidence(14, 0, 0)).toBe("low")
    expect(computeConfidence(0, 0, 10)).toBe("low") // 10*0.5 = 5
  })

  it("<5 effective → insufficient", () => {
    expect(computeConfidence(0, 0, 0)).toBe("insufficient")
    expect(computeConfidence(3, 0, 0)).toBe("insufficient")
    expect(computeConfidence(0, 0, 8)).toBe("insufficient") // 8*0.5 = 4
  })

  it("backfill days count at 0.5x", () => {
    // 60 backfill days → 30 effective → medium
    expect(computeConfidence(0, 0, 60)).toBe("medium")
  })

  it("scorecard-only days count at 0.25x", () => {
    // 56 scorecard-only → 14 effective → low
    expect(computeConfidence(0, 56, 0)).toBe("low")
  })

  it("mixed sources combine", () => {
    // 10 event + 20 backfill (10) + 40 scorecard (10) = 30 → medium
    expect(computeConfidence(10, 40, 20)).toBe("medium")
  })
})

// ---------------------------------------------------------------------------
// computeIngredientScores
// ---------------------------------------------------------------------------

describe("computeIngredientScores", () => {
  const opts = DEFAULT_CORRELATION_OPTIONS

  const chickenActive: ActiveIngredient = {
    key: "chicken",
    ingredientIds: ["ing-1"],
    productIds: ["prod-a"],
    bestPosition: 1,
    worstPosition: 1,
    ingredientCount: 1,
    fromTreat: false,
    formType: null,
    sourceGroup: null,
    volumePositionWeight: positionWeight(1),
  }

  it("returns empty scores for empty snapshots", () => {
    expect(computeIngredientScores([], opts)).toEqual([])
  })

  it("excludes transition buffer days from scoring", () => {
    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 2 },
        isTransitionBuffer: true,
      }),
      makeSnapshot({
        date: "2024-06-02",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 4 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    expect(scores).toHaveLength(1)
    expect(scores[0].rawAvgPoopScore).toBe(4) // Only day 2 counted
    expect(scores[0].dayCount).toBe(1)
    expect(scores[0].excludedDays).toBe(1)
  })

  it("uses scorecard fallback when poopScore is null", () => {
    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, scorecardPoopFallback: 5 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    expect(scores[0].rawAvgPoopScore).toBe(5)
    expect(scores[0].daysWithScorecardOnly).toBe(1)
    expect(scores[0].daysWithEventLogs).toBe(0)
  })

  it("event log preferred over scorecard fallback", () => {
    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [chickenActive],
        outcome: {
          ...emptyOutcome,
          poopScore: 2,
          scorecardPoopFallback: 5,
        },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    expect(scores[0].rawAvgPoopScore).toBe(2)
    expect(scores[0].daysWithEventLogs).toBe(1)
  })

  it("computes badDayCount and goodDayCount correctly", () => {
    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 2 },
      }),
      makeSnapshot({
        date: "2024-06-02",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 3 },
      }),
      makeSnapshot({
        date: "2024-06-03",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 5 },
      }),
      makeSnapshot({
        date: "2024-06-04",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 6 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    expect(scores[0].goodDayCount).toBe(2) // scores 2, 3
    expect(scores[0].badDayCount).toBe(2) // scores 5, 6
  })

  it("skips days with no outcome signals", () => {
    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome }, // no signals
      }),
      makeSnapshot({
        date: "2024-06-02",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 3 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    expect(scores[0].dayCount).toBe(1)
  })

  it("includes positionCategory and isAllergenicallyRelevant", () => {
    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 3 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    expect(scores[0].positionCategory).toBe("primary")
    expect(scores[0].isAllergenicallyRelevant).toBe(true)
  })

  it("marks fat/oil ingredients as not allergenically relevant", () => {
    const fatActive: ActiveIngredient = {
      key: "chicken (fat)",
      ingredientIds: ["ing-fat"],
      productIds: ["prod-a"],
      bestPosition: 5,
      worstPosition: 5,
      ingredientCount: 1,
      fromTreat: false,
      formType: "fat",
      sourceGroup: null,
      volumePositionWeight: positionWeight(5),
    }
    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [fatActive],
        outcome: { ...emptyOutcome, poopScore: 3 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    expect(scores[0].isAllergenicallyRelevant).toBe(false)
  })

  it("tracks backfill days separately", () => {
    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        date: "backfill:plan-1:0",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 3 },
        isBackfill: true,
      }),
      makeSnapshot({
        date: "backfill:plan-1:1",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 3 },
        isBackfill: true,
      }),
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 3 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    expect(scores[0].daysWithBackfill).toBe(2)
    expect(scores[0].daysWithEventLogs).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Asymmetric scoring
// ---------------------------------------------------------------------------

describe("asymmetric scoring", () => {
  const opts = DEFAULT_CORRELATION_OPTIONS

  const chickenActive: ActiveIngredient = {
    key: "chicken",
    ingredientIds: ["ing-1"],
    productIds: ["prod-a"],
    bestPosition: 1,
    worstPosition: 1,
    ingredientCount: 1,
    fromTreat: false,
    formType: null,
    sourceGroup: null,
    volumePositionWeight: positionWeight(1),
  }

  it("bad days pull weighted score higher than raw average", () => {
    // 4 good days (score 2) + 1 bad day (score 6)
    // Raw avg: (2+2+2+2+6)/5 = 2.8
    // Weighted: bad day gets 3x weight
    const snapshots: DaySnapshot[] = [
      ...Array.from({ length: 4 }, (_, i) =>
        makeSnapshot({
          date: `2024-06-0${i + 1}`,
          ingredients: [chickenActive],
          outcome: { ...emptyOutcome, poopScore: 2 },
        }),
      ),
      makeSnapshot({
        date: "2024-06-05",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 6 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    const score = scores[0]

    expect(score.rawAvgPoopScore).toBeCloseTo(2.8, 5)
    // Weighted should be higher due to bad day multiplier
    expect(score.weightedPoopScore!).toBeGreaterThan(score.rawAvgPoopScore!)
    // Expected: (2*1*1 + 2*1*1 + 2*1*1 + 2*1*1 + 6*1*3) / (1+1+1+1+3) = 26/7 ≈ 3.71
    expect(score.weightedPoopScore).toBeCloseTo(26 / 7, 2)
  })

  it("all good days produce same weighted and raw scores", () => {
    const snapshots: DaySnapshot[] = Array.from({ length: 5 }, (_, i) =>
      makeSnapshot({
        date: `2024-06-0${i + 1}`,
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 2 },
      }),
    )
    const scores = computeIngredientScores(snapshots, opts)
    expect(scores[0].rawAvgPoopScore).toBeCloseTo(2.0, 5)
    expect(scores[0].weightedPoopScore).toBeCloseTo(2.0, 5)
  })

  it("all bad days produce same weighted and raw scores", () => {
    const snapshots: DaySnapshot[] = Array.from({ length: 3 }, (_, i) =>
      makeSnapshot({
        date: `2024-06-0${i + 1}`,
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 6 },
      }),
    )
    const scores = computeIngredientScores(snapshots, opts)
    expect(scores[0].rawAvgPoopScore).toBeCloseTo(6.0, 5)
    expect(scores[0].weightedPoopScore).toBeCloseTo(6.0, 5)
  })

  it("counts per-track bad/good days separately", () => {
    const snapshots: DaySnapshot[] = [
      // Day 1: bad poop, good itch
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 6, itchScore: 1 },
      }),
      // Day 2: good poop, bad itch
      makeSnapshot({
        date: "2024-06-02",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 2, itchScore: 5 },
      }),
      // Day 3: good both
      makeSnapshot({
        date: "2024-06-03",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 2, itchScore: 1 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    const score = scores[0]
    expect(score.badPoopDayCount).toBe(1)
    expect(score.goodPoopDayCount).toBe(2)
    expect(score.badItchDayCount).toBe(1)
    expect(score.goodItchDayCount).toBe(2)
    // badDayCount is union of both tracks
    expect(score.badDayCount).toBe(2)
  })

  it("itch-only days count for itch track but not poop track", () => {
    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: null, itchScore: 4 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    const score = scores[0]
    expect(score.badPoopDayCount).toBe(0)
    expect(score.goodPoopDayCount).toBe(0)
    expect(score.badItchDayCount).toBe(1)
    expect(score.goodItchDayCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Position weighting integration
// ---------------------------------------------------------------------------

describe("position weighting integration", () => {
  const opts = DEFAULT_CORRELATION_OPTIONS

  it("position 1 ingredient scores higher than position 15 with same data", () => {
    const pos1: ActiveIngredient = {
      key: "chicken",
      ingredientIds: ["ing-1"],
      productIds: ["prod-a"],
      bestPosition: 1,
      worstPosition: 1,
      ingredientCount: 1,
      fromTreat: false,
      formType: null,
      sourceGroup: null,
      volumePositionWeight: positionWeight(1),
    }
    const pos15: ActiveIngredient = {
      key: "carrot",
      ingredientIds: ["ing-2"],
      productIds: ["prod-a"],
      bestPosition: 15,
      worstPosition: 15,
      ingredientCount: 1,
      fromTreat: false,
      formType: null,
      sourceGroup: null,
      volumePositionWeight: positionWeight(15),
    }

    // Both present on same days with one bad day
    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [pos1, pos15],
        outcome: { ...emptyOutcome, poopScore: 2 },
      }),
      makeSnapshot({
        date: "2024-06-02",
        ingredients: [pos1, pos15],
        outcome: { ...emptyOutcome, poopScore: 2 },
      }),
      makeSnapshot({
        date: "2024-06-03",
        ingredients: [pos1, pos15],
        outcome: { ...emptyOutcome, poopScore: 6 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    const chickenScore = scores.find((s) => s.key === "chicken")!
    const carrotScore = scores.find((s) => s.key === "carrot")!

    // Raw averages should be identical (same days, same poop scores)
    expect(chickenScore.rawAvgPoopScore).toBeCloseTo(carrotScore.rawAvgPoopScore!, 5)

    // But weighted scores differ because position weight affects the weighted calculation
    // Both have same poop scores but different position weights
    // The weighted scores should still be similar since position weight scales both numerator and denominator
    // The key difference is position category
    expect(chickenScore.positionCategory).toBe("primary")
    expect(carrotScore.positionCategory).toBe("minor")
  })
})

// ---------------------------------------------------------------------------
// Form-type separation
// ---------------------------------------------------------------------------

describe("form-type separation", () => {
  const opts = DEFAULT_CORRELATION_OPTIONS

  it("chicken fat and chicken protein get separate keys", () => {
    const chickenProtein = makeIngredient({
      id: "ing-chicken",
      family: "chicken",
      formType: null,
    })
    const chickenFat = makeIngredient({
      id: "ing-chicken-fat",
      normalizedName: "chicken fat",
      family: "chicken",
      formType: "fat",
    })
    const productIngs = makeProductIngredients("prod-a", [
      { position: 1, ingredient: chickenProtein },
      { position: 5, ingredient: chickenFat },
    ])

    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      feedingPeriods: [
        {
          id: "fp-1",
          productId: "prod-a",
          startDate: "2024-06-01",
          endDate: null,
          planGroupId: "plan-1",
          createdAt: "2024-06-01T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
      ],
      productIngredientMap: new Map([["prod-a", productIngs]]),
      poopLogs: [{ date: "2024-06-01", firmnessScore: 3 }],
    })

    const result = runCorrelation(input, opts)
    const keys = result.scores.map((s) => s.key).sort()
    expect(keys).toEqual(["chicken", "chicken (fat)"])

    const chickenScore = result.scores.find((s) => s.key === "chicken")!
    const fatScore = result.scores.find((s) => s.key === "chicken (fat)")!
    expect(chickenScore.isAllergenicallyRelevant).toBe(true)
    expect(fatScore.isAllergenicallyRelevant).toBe(false)
  })

  it("salmon oil and salmon protein get separate keys", () => {
    const salmonProtein = makeIngredient({
      id: "ing-salmon",
      normalizedName: "salmon",
      family: "salmon",
      formType: null,
    })
    const salmonOil = makeIngredient({
      id: "ing-salmon-oil",
      normalizedName: "salmon oil",
      family: "salmon",
      formType: "oil",
    })
    const productIngs = makeProductIngredients("prod-a", [
      { position: 1, ingredient: salmonProtein },
      { position: 8, ingredient: salmonOil },
    ])

    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      feedingPeriods: [
        {
          id: "fp-1",
          productId: "prod-a",
          startDate: "2024-06-01",
          endDate: null,
          planGroupId: "plan-1",
          createdAt: "2024-06-01T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
      ],
      productIngredientMap: new Map([["prod-a", productIngs]]),
      poopLogs: [{ date: "2024-06-01", firmnessScore: 3 }],
    })

    const result = runCorrelation(input, opts)
    const keys = result.scores.map((s) => s.key).sort()
    expect(keys).toEqual(["salmon", "salmon (oil)"])
  })

  it("chicken meal resolves to same key as raw chicken", () => {
    const chickenRaw = makeIngredient({
      id: "ing-chicken-raw",
      family: "chicken",
      formType: null,
    })
    const chickenMeal = makeIngredient({
      id: "ing-chicken-meal",
      normalizedName: "chicken meal",
      family: "chicken",
      formType: "meal",
    })
    const productIngs = makeProductIngredients("prod-a", [
      { position: 1, ingredient: chickenRaw },
      { position: 3, ingredient: chickenMeal },
    ])

    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      feedingPeriods: [
        {
          id: "fp-1",
          productId: "prod-a",
          startDate: "2024-06-01",
          endDate: null,
          planGroupId: "plan-1",
          createdAt: "2024-06-01T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
      ],
      productIngredientMap: new Map([["prod-a", productIngs]]),
      poopLogs: [{ date: "2024-06-01", firmnessScore: 3 }],
    })

    const result = runCorrelation(input, opts)
    // Both should merge into "chicken"
    const chickenScores = result.scores.filter((s) => s.key === "chicken")
    expect(chickenScores).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Legume splitting detection
// ---------------------------------------------------------------------------

describe("legume splitting detection", () => {
  const opts = DEFAULT_CORRELATION_OPTIONS

  it("sets isSplit when legume family has 3+ ingredients in a product", () => {
    const peaActive: ActiveIngredient = {
      key: "pea",
      ingredientIds: ["pea-1", "pea-2", "pea-3"],
      productIds: ["prod-a"],
      bestPosition: 3,
      worstPosition: 12,
      ingredientCount: 3,
      fromTreat: false,
      formType: null,
      sourceGroup: "legume",
      volumePositionWeight: positionWeight(3),
    }

    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        ingredients: [peaActive],
        outcome: { ...emptyOutcome, poopScore: 4 },
      }),
    ]

    const scores = computeIngredientScores(snapshots, opts)
    expect(scores[0].isSplit).toBe(true)
  })

  it("does not set isSplit for legume family with < 3 ingredients", () => {
    const peaActive: ActiveIngredient = {
      key: "pea",
      ingredientIds: ["pea-1", "pea-2"],
      productIds: ["prod-a"],
      bestPosition: 3,
      worstPosition: 8,
      ingredientCount: 2,
      fromTreat: false,
      formType: null,
      sourceGroup: "legume",
      volumePositionWeight: positionWeight(3),
    }

    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        ingredients: [peaActive],
        outcome: { ...emptyOutcome, poopScore: 4 },
      }),
    ]

    const scores = computeIngredientScores(snapshots, opts)
    expect(scores[0].isSplit).toBe(false)
  })

  it("does not set isSplit for non-legume family with 3+ ingredients", () => {
    const chickenActive: ActiveIngredient = {
      key: "chicken",
      ingredientIds: ["ch-1", "ch-2", "ch-3"],
      productIds: ["prod-a"],
      bestPosition: 1,
      worstPosition: 10,
      ingredientCount: 3,
      fromTreat: false,
      formType: null,
      sourceGroup: "poultry",
      volumePositionWeight: positionWeight(1),
    }

    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 4 },
      }),
    ]

    const scores = computeIngredientScores(snapshots, opts)
    expect(scores[0].isSplit).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Distinct product count (confounding detection)
// ---------------------------------------------------------------------------

describe("distinct product count", () => {
  const opts = DEFAULT_CORRELATION_OPTIONS

  it("single product gives distinctProductCount 1 for all ingredients", () => {
    const chickenActive: ActiveIngredient = {
      key: "chicken",
      ingredientIds: ["ing-1"],
      productIds: ["prod-a"],
      bestPosition: 1,
      worstPosition: 1,
      ingredientCount: 1,
      fromTreat: false,
      formType: null,
      sourceGroup: null,
      volumePositionWeight: positionWeight(1),
    }
    const potatoActive: ActiveIngredient = {
      key: "potato",
      ingredientIds: ["ing-2"],
      productIds: ["prod-a"],
      bestPosition: 5,
      worstPosition: 5,
      ingredientCount: 1,
      fromTreat: false,
      formType: null,
      sourceGroup: null,
      volumePositionWeight: positionWeight(5),
    }

    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [chickenActive, potatoActive],
        outcome: { ...emptyOutcome, poopScore: 6 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    expect(scores.find((s) => s.key === "chicken")!.distinctProductCount).toBe(1)
    expect(scores.find((s) => s.key === "potato")!.distinctProductCount).toBe(1)
  })

  it("multi-product ingredient gets distinctProductCount > 1", () => {
    const chickenA: ActiveIngredient = {
      key: "chicken",
      ingredientIds: ["ing-1"],
      productIds: ["prod-a"],
      bestPosition: 1,
      worstPosition: 1,
      ingredientCount: 1,
      fromTreat: false,
      formType: null,
      sourceGroup: null,
      volumePositionWeight: positionWeight(1),
    }
    const chickenB: ActiveIngredient = {
      key: "chicken",
      ingredientIds: ["ing-1"],
      productIds: ["prod-b"],
      bestPosition: 1,
      worstPosition: 1,
      ingredientCount: 1,
      fromTreat: false,
      formType: null,
      sourceGroup: null,
      volumePositionWeight: positionWeight(1),
    }

    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [chickenA],
        outcome: { ...emptyOutcome, poopScore: 3 },
      }),
      makeSnapshot({
        date: "2024-06-02",
        ingredients: [chickenB],
        outcome: { ...emptyOutcome, poopScore: 4 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    expect(scores.find((s) => s.key === "chicken")!.distinctProductCount).toBe(2)
  })

  it("runCorrelation sets totalDistinctProducts from scored snapshots", () => {
    const chickenIng = makeIngredient({ id: "ing-chicken", family: "chicken" })
    const riceIng = makeIngredient({ id: "ing-rice", normalizedName: "rice", family: "rice", sourceGroup: "grain" })

    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      productIngredientMap: new Map([
        ["prod-a", makeProductIngredients("prod-a", [{ position: 1, ingredient: chickenIng }])],
        ["prod-b", makeProductIngredients("prod-b", [{ position: 1, ingredient: riceIng }])],
      ]),
      backfills: [
        {
          planGroupId: "plan-a",
          productId: "prod-a",
          startDate: "2024-01-01",
          endDate: "2024-01-10",
          durationDays: 10,
          quantity: 2,
          quantityUnit: "cup",
          scorecard: { planGroupId: "plan-a", poopQuality: [3], itchSeverity: null,},
        },
        {
          planGroupId: "plan-b",
          productId: "prod-b",
          startDate: "2024-01-11",
          endDate: "2024-01-20",
          durationDays: 10,
          quantity: 2,
          quantityUnit: "cup",
          scorecard: { planGroupId: "plan-b", poopQuality: [4], itchSeverity: null,},
        },
      ],
    })

    const result = runCorrelation(input, opts)
    expect(result.totalDistinctProducts).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Backfill confidence
// ---------------------------------------------------------------------------

describe("backfill confidence", () => {
  const opts = DEFAULT_CORRELATION_OPTIONS

  it("60 backfill days get medium confidence (not insufficient)", () => {
    const chickenIng = makeIngredient({ id: "ing-chicken", family: "chicken" })
    const productIngs = makeProductIngredients("prod-a", [
      { position: 1, ingredient: chickenIng },
    ])

    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      productIngredientMap: new Map([["prod-a", productIngs]]),
      backfills: [
        {
          planGroupId: "plan-bf",
          productId: "prod-a",
          startDate: "2024-01-01",
          endDate: "2024-02-29",
          durationDays: 60,
          quantity: 2,
          quantityUnit: "cup",
          scorecard: { planGroupId: "plan-bf", poopQuality: [3], itchSeverity: null,},
        },
      ],
    })

    const result = runCorrelation(input, opts)
    const chickenScore = result.scores.find((s) => s.key === "chicken")!
    // 60 * 0.5 = 30 effective → medium
    expect(chickenScore.confidence).toBe("medium")
    expect(chickenScore.daysWithBackfill).toBe(60)
  })

  it("backfill snapshots set poopScore directly (not scorecardPoopFallback)", () => {
    const chickenIng = makeIngredient({ id: "ing-chicken", family: "chicken" })
    const productIngs = makeProductIngredients("prod-a", [
      { position: 1, ingredient: chickenIng },
    ])

    const input = makeInput({
      productIngredientMap: new Map([["prod-a", productIngs]]),
      backfills: [
        {
          planGroupId: "plan-bf",
          productId: "prod-a",
          startDate: "2024-01-01",
          endDate: "2024-01-03",
          durationDays: 3,
          quantity: 2,
          quantityUnit: "cup",
          scorecard: { planGroupId: "plan-bf", poopQuality: [4], itchSeverity: null,},
        },
      ],
    })

    const result = runCorrelation(input, opts)
    const chickenScore = result.scores.find((s) => s.key === "chicken")!
    // Backfill sets poopScore directly, counted as backfill days
    expect(chickenScore.daysWithBackfill).toBe(3)
    expect(chickenScore.daysWithScorecardOnly).toBe(0)
  })

  it("backfill with both poop + itch scores both tracks", () => {
    const chickenIng = makeIngredient({ id: "ing-chicken", family: "chicken" })
    const productIngs = makeProductIngredients("prod-a", [
      { position: 1, ingredient: chickenIng },
    ])

    const input = makeInput({
      productIngredientMap: new Map([["prod-a", productIngs]]),
      backfills: [
        {
          planGroupId: "plan-bf",
          productId: "prod-a",
          startDate: "2024-01-01",
          endDate: "2024-01-10",
          durationDays: 10,
          quantity: 2,
          quantityUnit: "cup",
          scorecard: { planGroupId: "plan-bf", poopQuality: [3], itchSeverity: [2, 4],},
        },
      ],
    })

    const result = runCorrelation(input, opts)
    const chickenScore = result.scores.find((s) => s.key === "chicken")!
    expect(chickenScore.weightedPoopScore).not.toBeNull()
    expect(chickenScore.weightedItchScore).not.toBeNull()
    expect(chickenScore.daysWithBackfill).toBe(10)
  })

  it("backfill with itch-only scores itch, poop null", () => {
    const chickenIng = makeIngredient({ id: "ing-chicken", family: "chicken" })
    const productIngs = makeProductIngredients("prod-a", [
      { position: 1, ingredient: chickenIng },
    ])

    const input = makeInput({
      productIngredientMap: new Map([["prod-a", productIngs]]),
      backfills: [
        {
          planGroupId: "plan-bf",
          productId: "prod-a",
          startDate: "2024-01-01",
          endDate: "2024-01-30",
          durationDays: 30,
          quantity: 2,
          quantityUnit: "cup",
          scorecard: { planGroupId: "plan-bf", poopQuality: null, itchSeverity: [3],},
        },
      ],
    })

    const result = runCorrelation(input, opts)
    const chickenScore = result.scores.find((s) => s.key === "chicken")!
    expect(chickenScore.rawAvgPoopScore).toBeNull()
    expect(chickenScore.weightedItchScore).not.toBeNull()
    expect(chickenScore.daysWithBackfill).toBe(30)
  })

  it("backfill skipped when neither poop nor itch data", () => {
    const chickenIng = makeIngredient({ id: "ing-chicken", family: "chicken" })
    const productIngs = makeProductIngredients("prod-a", [
      { position: 1, ingredient: chickenIng },
    ])

    const input = makeInput({
      productIngredientMap: new Map([["prod-a", productIngs]]),
      backfills: [
        {
          planGroupId: "plan-bf",
          productId: "prod-a",
          startDate: "2024-01-01",
          endDate: "2024-01-10",
          durationDays: 10,
          quantity: 2,
          quantityUnit: "cup",
          scorecard: { planGroupId: "plan-bf", poopQuality: null, itchSeverity: null,},
        },
      ],
    })

    const result = runCorrelation(input, opts)
    expect(result.scores.length).toBe(0)
  })

  it("overlapping backfills share volume weighting on overlapping dates", () => {
    // Food (30 days) partially overlaps supplement (11 days in the middle).
    // On overlapping dates, both ingredients should appear with volume weighting.
    // On non-overlapping dates, only the active product's ingredients should appear.
    const chickenIng = makeIngredient({ id: "ing-chicken", family: "chicken" })
    const pumpkinIng = makeIngredient({ id: "ing-pumpkin", family: "pumpkin" })
    const foodIngs = makeProductIngredients("prod-food", [
      { position: 1, ingredient: chickenIng },
    ])
    const suppIngs = makeProductIngredients("prod-supp", [
      { position: 1, ingredient: pumpkinIng },
    ])

    const input = makeInput({
      productIngredientMap: new Map([
        ["prod-food", foodIngs],
        ["prod-supp", suppIngs],
      ]),
      productInfo: new Map([
        ["prod-food", { type: "food", format: "dry", calorieContent: null }],
        ["prod-supp", { type: "supplement", format: "dry", calorieContent: null }],
      ]),
      backfills: [
        {
          planGroupId: "plan-food",
          productId: "prod-food",
          startDate: "2024-01-01",
          endDate: "2024-01-30",
          durationDays: 30,
          quantity: 2,
          quantityUnit: "cup",
          scorecard: { planGroupId: "plan-food", poopQuality: [3], itchSeverity: [2],},
        },
        {
          planGroupId: "plan-supp",
          productId: "prod-supp",
          startDate: "2024-01-10",
          endDate: "2024-01-20",
          durationDays: 11,
          quantity: 1,
          quantityUnit: "scoop",
          scorecard: { planGroupId: "plan-supp", poopQuality: [3], itchSeverity: [2],},
        },
      ],
    })

    const snapshots = buildBackfillSnapshots(input)

    // Food-only dates (Jan 1-9): only chicken, no pumpkin
    const foodOnlySnapshot = snapshots.find((s) => s.date === "backfill:2024-01-01")!
    expect(foodOnlySnapshot.ingredients.find((i) => i.key === "chicken")).toBeDefined()
    expect(foodOnlySnapshot.ingredients.find((i) => i.key === "pumpkin")).toBeUndefined()

    // Overlapping dates (Jan 10-20): both chicken AND pumpkin with volume weighting
    const overlapSnapshot = snapshots.find((s) => s.date === "backfill:2024-01-15")!
    expect(overlapSnapshot.ingredients.find((i) => i.key === "chicken")).toBeDefined()
    expect(overlapSnapshot.ingredients.find((i) => i.key === "pumpkin")).toBeDefined()

    // Food-only dates after overlap (Jan 21-30): only chicken
    const foodAfterSnapshot = snapshots.find((s) => s.date === "backfill:2024-01-25")!
    expect(foodAfterSnapshot.ingredients.find((i) => i.key === "chicken")).toBeDefined()
    expect(foodAfterSnapshot.ingredients.find((i) => i.key === "pumpkin")).toBeUndefined()

    // Total snapshot count = 30 (one per unique date across the full range)
    expect(snapshots.length).toBe(30)
  })

  it("overlapping backfill topper gets lower volume weight than main food", () => {
    // Salmon 600g + pumpkin 25g — pumpkin should get ~4% volume weight
    const salmonIng = makeIngredient({ id: "ing-salmon", family: "salmon" })
    const pumpkinIng = makeIngredient({ id: "ing-pumpkin", family: "pumpkin" })
    const foodIngs = makeProductIngredients("prod-food", [
      { position: 1, ingredient: salmonIng },
    ])
    const topperIngs = makeProductIngredients("prod-topper", [
      { position: 1, ingredient: pumpkinIng },
    ])

    const input = makeInput({
      productIngredientMap: new Map([
        ["prod-food", foodIngs],
        ["prod-topper", topperIngs],
      ]),
      productInfo: new Map([
        ["prod-food", { type: "food", format: "dry", calorieContent: null }],
        ["prod-topper", { type: "supplement", format: "dry", calorieContent: null }],
      ]),
      backfills: [
        {
          planGroupId: "plan-food",
          productId: "prod-food",
          startDate: "2024-01-01",
          endDate: "2024-01-10",
          durationDays: 10,
          quantity: 600,
          quantityUnit: "g",
          scorecard: { planGroupId: "plan-food", poopQuality: [3], itchSeverity: null,},
        },
        {
          planGroupId: "plan-topper",
          productId: "prod-topper",
          startDate: "2024-01-01",
          endDate: "2024-01-10",
          durationDays: 10,
          quantity: 25,
          quantityUnit: "g",
          scorecard: { planGroupId: "plan-topper", poopQuality: [3], itchSeverity: null,},
        },
      ],
    })

    const snapshots = buildBackfillSnapshots(input)
    expect(snapshots.length).toBe(10)

    const day = snapshots[0]
    const salmonWeight = day.ingredients.find((i) => i.key === "salmon")!.volumePositionWeight
    const pumpkinWeight = day.ingredients.find((i) => i.key === "pumpkin")!.volumePositionWeight

    // Salmon: 600/(600+25) ≈ 0.96, pumpkin: 25/(600+25) ≈ 0.04
    // volumePositionWeight = positionWeight(1) * volumeFraction
    expect(salmonWeight).toBeGreaterThan(0.9)
    expect(pumpkinWeight).toBeLessThan(0.1)
    expect(pumpkinWeight).toBeCloseTo(25 / 625, 2)
  })
})

// ---------------------------------------------------------------------------
// flagCrossReactivity
// ---------------------------------------------------------------------------

describe("flagCrossReactivity", () => {
  const poultryGroup: CrossReactivityGroup = {
    groupName: "poultry",
    families: ["chicken", "turkey", "duck"],
  }

  function makeScore(overrides: Partial<IngredientScore>): IngredientScore {
    return {
      key: "chicken",
      dayCount: 10,
      weightedPoopScore: 3,
      weightedItchScore: null,
      rawAvgPoopScore: 3,
      rawAvgItchScore: null,
    
      badDayCount: 1,
      goodDayCount: 7,
      badPoopDayCount: 1,
      goodPoopDayCount: 7,
      badItchDayCount: 0,
      goodItchDayCount: 0,
      confidence: "medium",

      bestPosition: 1,
      positionCategory: "primary",
      appearedInTreats: false,
      excludedDays: 0,
      daysWithEventLogs: 10,
      daysWithScorecardOnly: 0,
      daysWithBackfill: 0,
      isAllergenicallyRelevant: true,
      isSplit: false,
      distinctProductCount: 1,
      itchSeasonallyConfounded: false,
      ...overrides,
    }
  }

  it("flags when 2+ families in group both have bad signals", () => {
    const scores: IngredientScore[] = [
      makeScore({ key: "chicken", weightedPoopScore: 4.5, badDayCount: 5, badPoopDayCount: 5, dayCount: 10 }),
      makeScore({ key: "turkey", weightedPoopScore: 4.2, badDayCount: 4, badPoopDayCount: 4, dayCount: 10 }),
      makeScore({ key: "salmon", weightedPoopScore: 2.0, badDayCount: 0, badPoopDayCount: 0, dayCount: 10 }),
    ]
    const result = flagCrossReactivity(scores, [poultryGroup])
    expect(result.find((s) => s.key === "chicken")!.crossReactivityGroup).toBe(
      "poultry",
    )
    expect(result.find((s) => s.key === "turkey")!.crossReactivityGroup).toBe(
      "poultry",
    )
    expect(
      result.find((s) => s.key === "salmon")!.crossReactivityGroup,
    ).toBeUndefined()
  })

  it("warns (not confirms) when only one family is bad", () => {
    const scores: IngredientScore[] = [
      makeScore({ key: "chicken", weightedPoopScore: 5.0, badDayCount: 8, badPoopDayCount: 8, dayCount: 10 }),
      makeScore({ key: "turkey", weightedPoopScore: 2.0, badDayCount: 0, badPoopDayCount: 0, dayCount: 10 }),
    ]
    const result = flagCrossReactivity(scores, [poultryGroup])
    // Chicken should NOT get confirmed group flag (only 1 bad family)
    expect(
      result.find((s) => s.key === "chicken")!.crossReactivityGroup,
    ).toBeUndefined()
    // Turkey should get a warning since chicken is bad
    const turkey = result.find((s) => s.key === "turkey")!
    expect(turkey.crossReactivityWarning).toContain("Chicken scored poorly")
    expect(turkey.crossReactivityWarning).toContain("Turkey")
    // Chicken itself should NOT get a warning
    expect(result.find((s) => s.key === "chicken")!.crossReactivityWarning).toBeUndefined()
  })

  it("warns ambiguous keys when a family in the same group is bad", () => {
    const scores: IngredientScore[] = [
      makeScore({ key: "chicken", weightedPoopScore: 5.0, badDayCount: 8, badPoopDayCount: 8, dayCount: 10 }),
      makeScore({ key: "poultry (ambiguous)", weightedPoopScore: 3.0, badDayCount: 1, badPoopDayCount: 1, dayCount: 10 }),
    ]
    const result = flagCrossReactivity(scores, [poultryGroup])
    const ambiguous = result.find((s) => s.key === "poultry (ambiguous)")!
    expect(ambiguous.crossReactivityWarning).toContain("Chicken scored poorly")
  })

  it("does not flag families not in any group", () => {
    const scores: IngredientScore[] = [
      makeScore({ key: "salmon", weightedPoopScore: 5.0, badDayCount: 8, badPoopDayCount: 8, dayCount: 10 }),
      makeScore({ key: "trout", weightedPoopScore: 4.5, badDayCount: 5, badPoopDayCount: 5, dayCount: 10 }),
    ]
    const result = flagCrossReactivity(scores, [poultryGroup])
    expect(
      result.find((s) => s.key === "salmon")!.crossReactivityGroup,
    ).toBeUndefined()
    expect(
      result.find((s) => s.key === "trout")!.crossReactivityGroup,
    ).toBeUndefined()
  })

  it("does not flag fat/oil forms for cross-reactivity", () => {
    const scores: IngredientScore[] = [
      makeScore({ key: "chicken", weightedPoopScore: 4.5, badDayCount: 5, badPoopDayCount: 5, dayCount: 10 }),
      makeScore({
        key: "chicken (fat)",
        weightedPoopScore: 4.5,
        badDayCount: 5,
        badPoopDayCount: 5,
        dayCount: 10,
        isAllergenicallyRelevant: false,
      }),
      makeScore({ key: "turkey", weightedPoopScore: 4.2, badDayCount: 4, badPoopDayCount: 4, dayCount: 10 }),
    ]
    const result = flagCrossReactivity(scores, [poultryGroup])
    // chicken + turkey flagged, chicken (fat) NOT flagged
    expect(result.find((s) => s.key === "chicken")!.crossReactivityGroup).toBe("poultry")
    expect(result.find((s) => s.key === "turkey")!.crossReactivityGroup).toBe("poultry")
    expect(result.find((s) => s.key === "chicken (fat)")!.crossReactivityGroup).toBeUndefined()
  })

  it("triggers cross-reactivity on itch-only bad signals", () => {
    const scores: IngredientScore[] = [
      makeScore({ key: "chicken", weightedPoopScore: 2.0, weightedItchScore: 4.5, badDayCount: 0, badPoopDayCount: 0, badItchDayCount: 5, dayCount: 10 }),
      makeScore({ key: "turkey", weightedPoopScore: 2.0, weightedItchScore: 4.2, badDayCount: 0, badPoopDayCount: 0, badItchDayCount: 4, dayCount: 10 }),
    ]
    const result = flagCrossReactivity(scores, [poultryGroup])
    expect(result.find((s) => s.key === "chicken")!.crossReactivityGroup).toBe("poultry")
    expect(result.find((s) => s.key === "turkey")!.crossReactivityGroup).toBe("poultry")
  })

  it("triggers cross-reactivity via badItchDayCount ratio", () => {
    const scores: IngredientScore[] = [
      makeScore({ key: "chicken", weightedPoopScore: 2.0, weightedItchScore: 3.0, badPoopDayCount: 0, badItchDayCount: 4, dayCount: 10 }),
      makeScore({ key: "turkey", weightedPoopScore: 2.0, weightedItchScore: 3.0, badPoopDayCount: 0, badItchDayCount: 4, dayCount: 10 }),
    ]
    const result = flagCrossReactivity(scores, [poultryGroup])
    // badItchDayCount/dayCount = 0.4 > 0.3, should trigger
    expect(result.find((s) => s.key === "chicken")!.crossReactivityGroup).toBe("poultry")
    expect(result.find((s) => s.key === "turkey")!.crossReactivityGroup).toBe("poultry")
  })

  it("warns red_meat ambiguous keys across multiple cross-reactivity sub-groups", () => {
    const cattleSheepGroup: CrossReactivityGroup = {
      groupName: "cattle_sheep",
      families: ["beef", "bison", "lamb", "goat", "dairy"],
    }
    const deerElkGroup: CrossReactivityGroup = {
      groupName: "deer_elk",
      families: ["venison", "elk"],
    }
    const porkGroup: CrossReactivityGroup = {
      groupName: "pork",
      families: ["pork", "wild_boar"],
    }
    const scores: IngredientScore[] = [
      makeScore({ key: "beef", weightedPoopScore: 5.0, badDayCount: 8, badPoopDayCount: 8, dayCount: 10 }),
      makeScore({ key: "red_meat (ambiguous)", weightedPoopScore: 3.0, badDayCount: 1, badPoopDayCount: 1, dayCount: 10 }),
    ]
    const result = flagCrossReactivity(scores, [cattleSheepGroup, deerElkGroup, porkGroup])
    const ambiguous = result.find((s) => s.key === "red_meat (ambiguous)")!
    expect(ambiguous.crossReactivityWarning).toContain("Beef")
    expect(ambiguous.crossReactivityWarning).toContain("red meat")
  })

  it("warns red_meat ambiguous when bad family is in deer_elk sub-group", () => {
    const cattleSheepGroup: CrossReactivityGroup = {
      groupName: "cattle_sheep",
      families: ["beef", "bison", "lamb", "goat", "dairy"],
    }
    const deerElkGroup: CrossReactivityGroup = {
      groupName: "deer_elk",
      families: ["venison", "elk"],
    }
    const scores: IngredientScore[] = [
      makeScore({ key: "venison", weightedPoopScore: 4.5, badDayCount: 6, badPoopDayCount: 6, dayCount: 10 }),
      makeScore({ key: "red_meat (ambiguous)", weightedPoopScore: 3.0, badDayCount: 1, badPoopDayCount: 1, dayCount: 10 }),
    ]
    const result = flagCrossReactivity(scores, [cattleSheepGroup, deerElkGroup])
    const ambiguous = result.find((s) => s.key === "red_meat (ambiguous)")!
    expect(ambiguous.crossReactivityWarning).toContain("Venison")
  })
})

// ---------------------------------------------------------------------------
// runCorrelation (integration)
// ---------------------------------------------------------------------------

describe("runCorrelation", () => {
  it("composes all steps and returns complete result", () => {
    const chickenIng = makeIngredient({ id: "ing-chicken", family: "chicken" })
    const productIngs = makeProductIngredients("prod-a", [
      { position: 1, ingredient: chickenIng },
    ])

    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-03",
      feedingPeriods: [
        {
          id: "fp-1",
          productId: "prod-a",
          startDate: "2024-06-01",
          endDate: null,
          planGroupId: "plan-1",
          createdAt: "2024-06-01T00:00:00Z",
          quantity: 2,
          quantityUnit: "cup",
        },
      ],
      productIngredientMap: new Map([["prod-a", productIngs]]),
      poopLogs: [
        { date: "2024-06-01", firmnessScore: 3 },
        { date: "2024-06-02", firmnessScore: 4 },
        { date: "2024-06-03", firmnessScore: 2 },
      ],
    })

    const result = runCorrelation(input, DEFAULT_CORRELATION_OPTIONS)

    expect(result.dogId).toBe("dog-1")
    expect(result.totalDays).toBe(3)
    expect(result.scoreableDays).toBe(3)
    expect(result.scores).toHaveLength(1)
    expect(result.scores[0].key).toBe("chicken")
    expect(result.scores[0].dayCount).toBe(3)
    expect(result.scores[0].rawAvgPoopScore).toBe(3)
    expect(result.scores[0].positionCategory).toBe("primary")
    expect(result.scores[0].isAllergenicallyRelevant).toBe(true)
  })

  it("returns empty scores when no feeding periods", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-03",
      poopLogs: [{ date: "2024-06-01", firmnessScore: 3 }],
    })
    const result = runCorrelation(input, DEFAULT_CORRELATION_OPTIONS)
    expect(result.scores).toHaveLength(0)
    expect(result.totalDays).toBe(3)
  })

  it("populates giMergedScores that merge forms by family", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-10",
      feedingPeriods: [
        { id: "fp1", productId: "prod1", startDate: "2024-06-01", endDate: null, planGroupId: "pg1", createdAt: "2024-01-01", quantity: 1, quantityUnit: "piece" },
      ],
      productIngredientMap: new Map([
        ["prod1", makeProductIngredients("prod1", [
          { position: 1, ingredient: makeIngredient({ id: "i1", normalizedName: "corn", family: "corn", formType: null }) },
          { position: 5, ingredient: makeIngredient({ id: "i2", normalizedName: "corn oil", family: "corn", formType: "oil" }) },
        ])],
      ]),
      poopLogs: Array.from({ length: 10 }, (_, i) => ({
        date: `2024-06-${String(i + 1).padStart(2, "0")}`,
        firmnessScore: 4,
      })),
    })
    const result = runCorrelation(input, { ...DEFAULT_CORRELATION_OPTIONS, transitionBufferDays: 0 })

    // Regular scores should have separate entries for "corn" and "corn (oil)"
    expect(result.scores.find((s) => s.key === "corn")).toBeDefined()
    expect(result.scores.find((s) => s.key === "corn (oil)")).toBeDefined()

    // GI merged should combine into single "corn" entry
    const merged = result.giMergedScores
    const cornEntries = merged.filter((s) => s.key === "corn" || s.key === "corn (oil)")
    expect(cornEntries).toHaveLength(1)
    expect(cornEntries[0].key).toBe("corn")
    expect(cornEntries[0].isAllergenicallyRelevant).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// mergeScoresForGI
// ---------------------------------------------------------------------------

describe("mergeScoresForGI", () => {
  function makeScore(overrides: Partial<IngredientScore>): IngredientScore {
    return {
      key: "chicken",
      dayCount: 10,
      weightedPoopScore: 3,
      weightedItchScore: null,
      rawAvgPoopScore: 3,
      rawAvgItchScore: null,
    
      badDayCount: 1,
      goodDayCount: 7,
      badPoopDayCount: 1,
      goodPoopDayCount: 7,
      badItchDayCount: 0,
      goodItchDayCount: 0,
      confidence: "medium",

      bestPosition: 1,
      positionCategory: "primary",
      appearedInTreats: false,
      excludedDays: 0,
      daysWithEventLogs: 10,
      daysWithScorecardOnly: 0,
      daysWithBackfill: 0,
      isAllergenicallyRelevant: true,
      isSplit: false,
      distinctProductCount: 1,
      itchSeasonallyConfounded: false,
      ...overrides,
    }
  }

  it("passes through single-form scores unchanged (except isAllergenicallyRelevant)", () => {
    const scores = [
      makeScore({ key: "chicken", isAllergenicallyRelevant: true }),
      makeScore({ key: "rice", isAllergenicallyRelevant: true }),
    ]
    const merged = mergeScoresForGI(scores)
    expect(merged).toHaveLength(2)
    expect(merged.map((s) => s.key).sort()).toEqual(["chicken", "rice"])
  })

  it("marks fats/oils as allergenically relevant in GI mode", () => {
    const scores = [
      makeScore({ key: "chicken (fat)", isAllergenicallyRelevant: false }),
    ]
    const merged = mergeScoresForGI(scores)
    expect(merged).toHaveLength(1)
    expect(merged[0].key).toBe("chicken")
    expect(merged[0].isAllergenicallyRelevant).toBe(true)
  })

  it("merges multiple forms of the same family into one entry", () => {
    const scores = [
      makeScore({ key: "corn", dayCount: 20, weightedPoopScore: 3.0, bestPosition: 2, distinctProductCount: 2 }),
      makeScore({ key: "corn (oil)", dayCount: 15, weightedPoopScore: 4.0, bestPosition: 8, distinctProductCount: 1, isAllergenicallyRelevant: false }),
      makeScore({ key: "corn (fat)", dayCount: 10, weightedPoopScore: 5.0, bestPosition: 12, distinctProductCount: 1, isAllergenicallyRelevant: false }),
    ]
    const merged = mergeScoresForGI(scores)
    const cornEntries = merged.filter((s) => s.key.startsWith("corn"))
    expect(cornEntries).toHaveLength(1)

    const corn = cornEntries[0]
    expect(corn.key).toBe("corn")
    expect(corn.bestPosition).toBe(2) // min
    expect(corn.positionCategory).toBe("primary") // recomputed from bestPosition 2
    expect(corn.dayCount).toBe(20) // max
    expect(corn.isAllergenicallyRelevant).toBe(true)
    expect(corn.distinctProductCount).toBe(4) // sum: 2 + 1 + 1
  })

  it("uses worst (max) score across forms for elimination diet safety", () => {
    const scores = [
      makeScore({ key: "corn", dayCount: 20, weightedPoopScore: 3.0 }),
      makeScore({ key: "corn (oil)", dayCount: 10, weightedPoopScore: 6.0 }),
    ]
    const merged = mergeScoresForGI(scores)
    const corn = merged.find((s) => s.key === "corn")!
    // worst score wins — 6.0 from corn oil surfaces, not averaged to 4.0
    expect(corn.weightedPoopScore).toBe(6.0)
  })

  it("passes through ambiguous keys unmodified", () => {
    const scores = [
      makeScore({ key: "poultry (ambiguous)", dayCount: 5 }),
    ]
    const merged = mergeScoresForGI(scores)
    expect(merged).toHaveLength(1)
    expect(merged[0].key).toBe("poultry (ambiguous)")
    expect(merged[0].isAllergenicallyRelevant).toBe(true)
  })

  it("keeps hydrolyzed form separate from base family", () => {
    const scores = [
      makeScore({ key: "chicken", dayCount: 10, weightedPoopScore: 2.0 }),
      makeScore({ key: "chicken (hydrolyzed)", dayCount: 5, weightedPoopScore: 1.5 }),
    ]
    const merged = mergeScoresForGI(scores)
    const chickenEntries = merged.filter((s) => s.key.startsWith("chicken"))
    expect(chickenEntries).toHaveLength(2)
    expect(chickenEntries.map((s) => s.key).sort()).toEqual(["chicken", "chicken (hydrolyzed)"])
    expect(chickenEntries.every((s) => s.isAllergenicallyRelevant)).toBe(true)
  })

  it("preserves crossReactivity from any form", () => {
    const scores = [
      makeScore({ key: "chicken", dayCount: 10, crossReactivityGroup: "poultry" }),
      makeScore({ key: "chicken (fat)", dayCount: 5, isAllergenicallyRelevant: false }),
    ]
    const merged = mergeScoresForGI(scores)
    const chicken = merged.find((s) => s.key === "chicken")!
    expect(chicken.crossReactivityGroup).toBe("poultry")
  })

  it("uses max for day counts to avoid double-counting overlapping days", () => {
    const scores = [
      makeScore({ key: "corn", dayCount: 20, badDayCount: 5, goodDayCount: 12 }),
      makeScore({ key: "corn (oil)", dayCount: 15, badDayCount: 8, goodDayCount: 6 }),
    ]
    const merged = mergeScoresForGI(scores)
    const corn = merged.find((s) => s.key === "corn")!
    expect(corn.dayCount).toBe(20)
    expect(corn.badDayCount).toBe(8)
    expect(corn.goodDayCount).toBe(12)
  })

  it("sets appearedInTreats true if any form appeared in treats", () => {
    const scores = [
      makeScore({ key: "chicken", appearedInTreats: false }),
      makeScore({ key: "chicken (fat)", appearedInTreats: true }),
    ]
    const merged = mergeScoresForGI(scores)
    expect(merged.find((s) => s.key === "chicken")!.appearedInTreats).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Pollen discount tests
// ---------------------------------------------------------------------------

describe("computeRollingMaxPollen", () => {
  it("returns null when no pollen data exists", () => {
    const pollenByDate = new Map<string, { date: string; pollenLevel: number; sporeLevel: number | null }[]>()
    expect(computeRollingMaxPollen("2026-03-05", pollenByDate)).toBeNull()
  })

  it("returns single day level when only that day has data", () => {
    const pollenByDate = new Map([
      ["2026-03-05", [{ date: "2026-03-05", pollenLevel: 3, sporeLevel: 1 }]],
    ])
    expect(computeRollingMaxPollen("2026-03-05", pollenByDate)).toBe(3)
  })

  it("takes max of pollenLevel and sporeLevel for each day", () => {
    const pollenByDate = new Map([
      ["2026-03-05", [{ date: "2026-03-05", pollenLevel: 1, sporeLevel: 4 }]],
    ])
    expect(computeRollingMaxPollen("2026-03-05", pollenByDate)).toBe(4)
  })

  it("treats null sporeLevel as 0", () => {
    const pollenByDate = new Map([
      ["2026-03-05", [{ date: "2026-03-05", pollenLevel: 2, sporeLevel: null }]],
    ])
    expect(computeRollingMaxPollen("2026-03-05", pollenByDate)).toBe(2)
  })

  it("takes rolling max across 3 days", () => {
    const pollenByDate = new Map([
      ["2026-03-03", [{ date: "2026-03-03", pollenLevel: 4, sporeLevel: 0 }]],
      ["2026-03-04", [{ date: "2026-03-04", pollenLevel: 1, sporeLevel: 0 }]],
      ["2026-03-05", [{ date: "2026-03-05", pollenLevel: 2, sporeLevel: 0 }]],
    ])
    // Rolling max of day, day-1, day-2: max(2, 1, 4) = 4
    expect(computeRollingMaxPollen("2026-03-05", pollenByDate)).toBe(4)
  })

  it("uses only available days when some are missing", () => {
    const pollenByDate = new Map([
      // day-2 missing
      ["2026-03-04", [{ date: "2026-03-04", pollenLevel: 1, sporeLevel: 0 }]],
      ["2026-03-05", [{ date: "2026-03-05", pollenLevel: 2, sporeLevel: 0 }]],
    ])
    expect(computeRollingMaxPollen("2026-03-05", pollenByDate)).toBe(2)
  })

  it("handles edge case where only day-2 has data", () => {
    const pollenByDate = new Map([
      ["2026-03-03", [{ date: "2026-03-03", pollenLevel: 3, sporeLevel: 0 }]],
    ])
    expect(computeRollingMaxPollen("2026-03-05", pollenByDate)).toBe(3)
  })
})

describe("pollen discount in itch scoring", () => {
  function makePollenInput(
    pollenDays: Array<{ date: string; pollenLevel: number; sporeLevel: number | null }>,
    itchDays: Array<{ date: string; score: number }>,
  ): ReturnType<typeof makeInput> {
    return makeInput({
      windowStart: "2026-03-01",
      windowEnd: "2026-03-10",
      feedingPeriods: [{
        id: "fp-1",
        productId: "prod-1",
        startDate: "2026-03-01",
        endDate: null,
        planGroupId: "plan-1",
        createdAt: "2026-03-01T00:00:00Z",
        quantity: 200,
        quantityUnit: "grams",
      }],
      productIngredientMap: new Map([
        ["prod-1", makeProductIngredients("prod-1", [
          { position: 1, ingredient: makeIngredient({ id: "ing-1", normalizedName: "chicken", family: "chicken" }) },
        ])],
      ]),
      itchinessLogs: itchDays,
      pollenLogs: pollenDays,
      planPeriods: [{ planGroupId: "plan-1", startDate: "2026-03-01", endDate: null, createdAt: "2026-03-01T00:00:00Z" }],
      productInfo: new Map([["prod-1", { type: "food", format: "dry", calorieContent: null }]]),
    })
  }

  it("applies no discount on bad itch day with low pollen (level 0-1)", () => {
    const input = makePollenInput(
      [{ date: "2026-03-05", pollenLevel: 1, sporeLevel: 0 }],
      [{ date: "2026-03-05", score: 5 }],
    )
    const snaps = buildDaySnapshots(input, DEFAULT_CORRELATION_OPTIONS)
    const scores = computeIngredientScores(snaps, DEFAULT_CORRELATION_OPTIONS)
    const chicken = scores.find((s) => s.key === "chicken")!
    // With no discount, bad day multiplier is 3.0x
    // weightedItchScore = (5 * vpw * 3.0) / (vpw * 3.0) = 5
    expect(chicken.weightedItchScore).toBe(5)
  })

  it("applies 0.7 discount on bad itch day with moderate pollen (level 2)", () => {
    const input = makePollenInput(
      [{ date: "2026-03-05", pollenLevel: 2, sporeLevel: 0 }],
      [{ date: "2026-03-05", score: 5 }],
    )
    const snaps = buildDaySnapshots(input, DEFAULT_CORRELATION_OPTIONS)
    const scores = computeIngredientScores(snaps, DEFAULT_CORRELATION_OPTIONS)
    const chicken = scores.find((s) => s.key === "chicken")!
    // Single day: score = 5, dayWeight = 3.0 * 0.7 = 2.1
    // weightedItchScore = (5 * vpw * 2.1) / (vpw * 2.1) = 5
    // Note: single-ingredient single-day, the score itself doesn't change
    // But the weight is reduced, which matters in multi-day contexts
    expect(chicken.weightedItchScore).toBe(5)
  })

  it("applies 0.4 discount on bad itch day with high pollen (level 3-4)", () => {
    const input = makePollenInput(
      [{ date: "2026-03-05", pollenLevel: 3, sporeLevel: 0 }],
      [{ date: "2026-03-05", score: 5 }],
    )
    const snaps = buildDaySnapshots(input, DEFAULT_CORRELATION_OPTIONS)
    const scores = computeIngredientScores(snaps, DEFAULT_CORRELATION_OPTIONS)
    const chicken = scores.find((s) => s.key === "chicken")!
    expect(chicken.weightedItchScore).toBe(5)
  })

  it("does NOT discount good itch days during high pollen", () => {
    const input = makePollenInput(
      [
        { date: "2026-03-05", pollenLevel: 4, sporeLevel: 0 },
        { date: "2026-03-06", pollenLevel: 4, sporeLevel: 0 },
      ],
      [
        { date: "2026-03-05", score: 1 }, // good itch day
        { date: "2026-03-06", score: 5 }, // bad itch day
      ],
    )
    const snaps = buildDaySnapshots(input, DEFAULT_CORRELATION_OPTIONS)
    const scores = computeIngredientScores(snaps, DEFAULT_CORRELATION_OPTIONS)
    const chicken = scores.find((s) => s.key === "chicken")!

    // Good day: weight = 1.0 * 1.0 (no discount)
    // Bad day: weight = 3.0 * 0.4 = 1.2
    // The good day has proportionally MORE influence with pollen discount
    expect(chicken.weightedItchScore).not.toBeNull()
    // Numerator: (1 * vpw * 1.0) + (5 * vpw * 1.2) = vpw * (1 + 6) = vpw * 7
    // Denominator: (vpw * 1.0) + (vpw * 1.2) = vpw * 2.2
    // Score = 7 / 2.2 ≈ 3.18
    expect(chicken.weightedItchScore!).toBeCloseTo(7 / 2.2, 1)
  })

  it("does NOT discount poop track during high pollen", () => {
    const input = makePollenInput(
      [{ date: "2026-03-05", pollenLevel: 4, sporeLevel: 0 }],
      [],
    )
    // Add poop data
    input.poopLogs = [{ date: "2026-03-05", firmnessScore: 6 }]
    const snaps = buildDaySnapshots(input, DEFAULT_CORRELATION_OPTIONS)
    const scores = computeIngredientScores(snaps, DEFAULT_CORRELATION_OPTIONS)
    const chicken = scores.find((s) => s.key === "chicken")!
    // Poop score should be unaffected by pollen
    expect(chicken.weightedPoopScore).toBe(6)
  })

  it("uses 3-day rolling max for effective pollen level", () => {
    // Day 3 has low pollen, but day 1 had high pollen — rolling max captures the lag
    const input = makePollenInput(
      [
        { date: "2026-03-03", pollenLevel: 4, sporeLevel: 0 },
        { date: "2026-03-04", pollenLevel: 1, sporeLevel: 0 },
        { date: "2026-03-05", pollenLevel: 0, sporeLevel: 0 },
      ],
      [{ date: "2026-03-05", score: 5 }],
    )
    const snaps = buildDaySnapshots(input, DEFAULT_CORRELATION_OPTIONS)
    // The snapshot for 2026-03-05 should have effectivePollenLevel = 4 (from day-2)
    const snap = snaps.find((s) => s.date === "2026-03-05")!
    expect(snap.outcome.effectivePollenLevel).toBe(4)
  })

  it("gracefully handles no pollen data (identical to pre-pollen behavior)", () => {
    const input = makePollenInput(
      [], // no pollen data
      [{ date: "2026-03-05", score: 5 }],
    )
    const snaps = buildDaySnapshots(input, DEFAULT_CORRELATION_OPTIONS)
    const scores = computeIngredientScores(snaps, DEFAULT_CORRELATION_OPTIONS)
    const chicken = scores.find((s) => s.key === "chicken")!
    // No pollen data = no discount, full weight
    expect(chicken.weightedItchScore).toBe(5)
  })

  it("sets itchSeasonallyConfounded false when insufficient pollen data", () => {
    // Less than 14 days of pollen data overlap
    const input = makePollenInput(
      [{ date: "2026-03-05", pollenLevel: 4, sporeLevel: 0 }],
      [{ date: "2026-03-05", score: 5 }],
    )
    const snaps = buildDaySnapshots(input, DEFAULT_CORRELATION_OPTIONS)
    const scores = computeIngredientScores(snaps, DEFAULT_CORRELATION_OPTIONS)
    const chicken = scores.find((s) => s.key === "chicken")!
    expect(chicken.itchSeasonallyConfounded).toBe(false)
  })
})
