import { describe, it, expect } from "vitest"
import {
  resolveIngredientKey,
  buildDaySnapshots,
  computeIngredientScores,
  computeConfidence,
  flagCrossReactivity,
  runCorrelation,
} from "./engine"
import type {
  IngredientRecord,
  CorrelationInput,
  CorrelationOptions,
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
  vomitCount: 0,
  scorecardPoopFallback: null,
  onItchinessMedication: false,
  onDigestiveMedication: false,
  pollenIndex: null,
  hasAccidentalExposure: false,
}

function makeSnapshot(overrides: Partial<DaySnapshot> = {}): DaySnapshot {
  return {
    date: "2024-06-01",
    ingredients: [],
    outcome: { ...emptyOutcome },
    isTransitionBuffer: false,
    isExposureBuffer: false,
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
    vomitLogs: [],
    accidentalExposures: [],
    medications: [],
    scorecards: [],
    pollenLogs: [],
    planPeriods: [],
    crossReactivityGroups: [],
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
      scorecards: [{ planGroupId: "plan-1", poopQuality: 4 }],
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
      scorecards: [{ planGroupId: "plan-1", poopQuality: 5 }],
    })
    const snaps = buildDaySnapshots(input, opts)
    expect(snaps[0].outcome.poopScore).toBe(2)
    expect(snaps[0].outcome.scorecardPoopFallback).toBe(null)
  })

  it("treat ingredients appear with fromTreat=true", () => {
    const treatProduct = makeProductIngredients("prod-treat", [
      { position: 1, ingredient: salmonIng },
    ])
    const map = new Map([["prod-treat", treatProduct]])
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-01",
      treatLogs: [{ date: "2024-06-01", productId: "prod-treat" }],
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
        },
      ],
      treatLogs: [{ date: "2024-06-01", productId: "prod-treat-c" }],
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
        },
        {
          id: "fp-2",
          productId: "prod-b",
          startDate: "2024-06-04",
          endDate: null,
          planGroupId: "plan-2",
          createdAt: "2024-06-04T00:00:00Z",
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

  it("marks exposure buffer after accidental exposure", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-07",
      accidentalExposures: [{ date: "2024-06-03" }],
    })
    const snaps = buildDaySnapshots(
      input,
      { ...opts, exposureBufferDays: 3 },
    )
    expect(snaps[0].isExposureBuffer).toBe(false) // June 1
    expect(snaps[1].isExposureBuffer).toBe(false) // June 2
    expect(snaps[2].isExposureBuffer).toBe(true) // June 3 — exposure day
    expect(snaps[3].isExposureBuffer).toBe(true) // June 4
    expect(snaps[4].isExposureBuffer).toBe(true) // June 5
    expect(snaps[5].isExposureBuffer).toBe(false) // June 6
  })

  it("sets medication flags correctly", () => {
    const input = makeInput({
      windowStart: "2024-06-01",
      windowEnd: "2024-06-03",
      medications: [
        {
          startDate: "2024-06-01",
          endDate: "2024-06-02",
          reason: "itchiness",
        },
        {
          startDate: "2024-06-02",
          endDate: null,
          reason: "digestive",
        },
      ],
    })
    const snaps = buildDaySnapshots(input, opts)
    // June 1: itchiness only
    expect(snaps[0].outcome.onItchinessMedication).toBe(true)
    expect(snaps[0].outcome.onDigestiveMedication).toBe(false)
    // June 2: both
    expect(snaps[1].outcome.onItchinessMedication).toBe(true)
    expect(snaps[1].outcome.onDigestiveMedication).toBe(true)
    // June 3: itchiness ended, digestive ongoing
    expect(snaps[2].outcome.onItchinessMedication).toBe(false)
    expect(snaps[2].outcome.onDigestiveMedication).toBe(true)
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
        },
        {
          id: "fp-2",
          productId: "prod-b",
          startDate: "2024-06-01",
          endDate: null,
          planGroupId: "plan-2",
          createdAt: "2024-06-01T00:00:00Z",
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
        },
      ],
      // Empty ingredient map — prod-unknown not in it
      productIngredientMap: new Map(),
    })
    const snaps = buildDaySnapshots(input, opts)
    expect(snaps[0].ingredients).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// computeConfidence
// ---------------------------------------------------------------------------

describe("computeConfidence", () => {
  it(">=14 event log days → high", () => {
    expect(computeConfidence(14, 0)).toBe("high")
    expect(computeConfidence(20, 5)).toBe("high")
  })

  it("7-13 event log days → medium", () => {
    expect(computeConfidence(7, 0)).toBe("medium")
    expect(computeConfidence(13, 10)).toBe("medium")
  })

  it("3-6 event log days → low", () => {
    expect(computeConfidence(3, 0)).toBe("low")
    expect(computeConfidence(6, 0)).toBe("low")
  })

  it("<3 event + some scorecard (total>=3) → low (not medium)", () => {
    expect(computeConfidence(2, 5)).toBe("low")
    expect(computeConfidence(1, 10)).toBe("low")
    expect(computeConfidence(0, 3)).toBe("low")
  })

  it("<3 total → insufficient", () => {
    expect(computeConfidence(0, 0)).toBe("insufficient")
    expect(computeConfidence(1, 1)).toBe("insufficient")
    expect(computeConfidence(2, 0)).toBe("insufficient")
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
    bestPosition: 1,
    fromTreat: false,
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
    expect(scores[0].avgPoopScore).toBe(4) // Only day 2 counted
    expect(scores[0].dayCount).toBe(1)
    expect(scores[0].excludedDays).toBe(1)
  })

  it("excludes exposure buffer days from scoring", () => {
    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 6 },
        isExposureBuffer: true,
      }),
      makeSnapshot({
        date: "2024-06-02",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 3 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    expect(scores[0].avgPoopScore).toBe(3)
    expect(scores[0].dayCount).toBe(1)
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
    expect(scores[0].avgPoopScore).toBe(5)
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
    // Note: scorecardPoopFallback should be null when poopScore exists (set by buildDayOutcome),
    // but computeIngredientScores should still prefer poopScore via ?? operator
    const scores = computeIngredientScores(snapshots, opts)
    expect(scores[0].avgPoopScore).toBe(2)
    expect(scores[0].daysWithEventLogs).toBe(1)
  })

  it("computes exposureFraction correctly", () => {
    const riceActive: ActiveIngredient = {
      key: "rice",
      ingredientIds: ["ing-2"],
      bestPosition: 2,
      fromTreat: false,
    }
    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [chickenActive, riceActive],
        outcome: { ...emptyOutcome, poopScore: 3 },
      }),
      makeSnapshot({
        date: "2024-06-02",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 4 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, opts)
    const chickenScore = scores.find((s) => s.key === "chicken")!
    const riceScore = scores.find((s) => s.key === "rice")!
    // chicken appeared on 2 of 2 scoreable days
    expect(chickenScore.exposureFraction).toBe(1)
    // rice appeared on 1 of 2 scoreable days
    expect(riceScore.exposureFraction).toBe(0.5)
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

  it("excludes medication periods when option enabled", () => {
    const snapshots: DaySnapshot[] = [
      makeSnapshot({
        date: "2024-06-01",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 6, onDigestiveMedication: true },
      }),
      makeSnapshot({
        date: "2024-06-02",
        ingredients: [chickenActive],
        outcome: { ...emptyOutcome, poopScore: 2 },
      }),
    ]
    const scores = computeIngredientScores(snapshots, {
      ...opts,
      excludeMedicationPeriods: true,
    })
    expect(scores[0].avgPoopScore).toBe(2)
    expect(scores[0].dayCount).toBe(1)
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
      avgPoopScore: 3,
      avgItchScore: null,
      vomitCount: 0,
      badDayCount: 1,
      goodDayCount: 7,
      confidence: "medium",
      exposureFraction: 0.5,
      bestPosition: 1,
      appearedInTreats: false,
      excludedDays: 0,
      daysWithEventLogs: 10,
      daysWithScorecardOnly: 0,
      ...overrides,
    }
  }

  it("flags when 2+ families in group both have bad signals", () => {
    const scores: IngredientScore[] = [
      makeScore({ key: "chicken", avgPoopScore: 4.5, badDayCount: 5, dayCount: 10 }),
      makeScore({ key: "turkey", avgPoopScore: 4.2, badDayCount: 4, dayCount: 10 }),
      makeScore({ key: "salmon", avgPoopScore: 2.0, badDayCount: 0, dayCount: 10 }),
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

  it("does not flag when only one family is bad", () => {
    const scores: IngredientScore[] = [
      makeScore({ key: "chicken", avgPoopScore: 5.0, badDayCount: 8, dayCount: 10 }),
      makeScore({ key: "turkey", avgPoopScore: 2.0, badDayCount: 0, dayCount: 10 }),
    ]
    const result = flagCrossReactivity(scores, [poultryGroup])
    expect(
      result.find((s) => s.key === "chicken")!.crossReactivityGroup,
    ).toBeUndefined()
  })

  it("does not flag families not in any group", () => {
    const scores: IngredientScore[] = [
      makeScore({ key: "salmon", avgPoopScore: 5.0, badDayCount: 8, dayCount: 10 }),
      makeScore({ key: "trout", avgPoopScore: 4.5, badDayCount: 5, dayCount: 10 }),
    ]
    const result = flagCrossReactivity(scores, [poultryGroup])
    expect(
      result.find((s) => s.key === "salmon")!.crossReactivityGroup,
    ).toBeUndefined()
    expect(
      result.find((s) => s.key === "trout")!.crossReactivityGroup,
    ).toBeUndefined()
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
    expect(result.scores[0].avgPoopScore).toBe(3)
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
})
