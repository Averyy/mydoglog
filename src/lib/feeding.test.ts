import { describe, it, expect } from "vitest"
import {
  resolveActivePlan,
  parseDuration,
  type PlanPeriod,
} from "./feeding"

describe("resolveActivePlan", () => {
  const base: PlanPeriod = {
    planGroupId: "ongoing-1",
    startDate: "2024-01-01",
    endDate: null,
    createdAt: "2024-01-01T00:00:00Z",
  }

  it("returns null for empty periods", () => {
    expect(resolveActivePlan([], "2024-06-01")).toBe(null)
  })

  it("returns null if no plan covers the date", () => {
    const periods: PlanPeriod[] = [
      { ...base, startDate: "2024-07-01" },
    ]
    expect(resolveActivePlan(periods, "2024-06-01")).toBe(null)
  })

  it("returns the only ongoing plan", () => {
    expect(resolveActivePlan([base], "2024-06-01")).toBe("ongoing-1")
  })

  it("prefers single-day over date-range", () => {
    const periods: PlanPeriod[] = [
      {
        planGroupId: "range-1",
        startDate: "2024-06-01",
        endDate: "2024-06-30",
        createdAt: "2024-06-01T00:00:00Z",
      },
      {
        planGroupId: "single-1",
        startDate: "2024-06-15",
        endDate: "2024-06-15",
        createdAt: "2024-06-14T00:00:00Z",
      },
    ]
    expect(resolveActivePlan(periods, "2024-06-15")).toBe("single-1")
  })

  it("prefers date-range over ongoing", () => {
    const periods: PlanPeriod[] = [
      {
        planGroupId: "ongoing-1",
        startDate: "2024-01-01",
        endDate: null,
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        planGroupId: "range-1",
        startDate: "2024-06-01",
        endDate: "2024-06-30",
        createdAt: "2024-06-01T00:00:00Z",
      },
    ]
    expect(resolveActivePlan(periods, "2024-06-15")).toBe("range-1")
  })

  it("most recently created wins ties within same tier", () => {
    const periods: PlanPeriod[] = [
      {
        planGroupId: "old",
        startDate: "2024-01-01",
        endDate: null,
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        planGroupId: "new",
        startDate: "2024-01-01",
        endDate: null,
        createdAt: "2024-03-01T00:00:00Z",
      },
    ]
    expect(resolveActivePlan(periods, "2024-06-01")).toBe("new")
  })

  it("excludes plans that ended before the date", () => {
    const periods: PlanPeriod[] = [
      {
        planGroupId: "ended",
        startDate: "2024-01-01",
        endDate: "2024-05-31",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ]
    expect(resolveActivePlan(periods, "2024-06-01")).toBe(null)
  })

  it("includes plans that end exactly on the date", () => {
    const periods: PlanPeriod[] = [
      {
        planGroupId: "ends-today",
        startDate: "2024-01-01",
        endDate: "2024-06-01",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ]
    expect(resolveActivePlan(periods, "2024-06-01")).toBe("ends-today")
  })

  it("includes plans that start exactly on the date", () => {
    const periods: PlanPeriod[] = [
      {
        planGroupId: "starts-today",
        startDate: "2024-06-01",
        endDate: null,
        createdAt: "2024-06-01T00:00:00Z",
      },
    ]
    expect(resolveActivePlan(periods, "2024-06-01")).toBe("starts-today")
  })

  it("full priority: single-day > date-range > ongoing", () => {
    const periods: PlanPeriod[] = [
      {
        planGroupId: "ongoing",
        startDate: "2024-01-01",
        endDate: null,
        createdAt: "2024-06-14T00:00:00Z",
      },
      {
        planGroupId: "range",
        startDate: "2024-06-01",
        endDate: "2024-06-30",
        createdAt: "2024-06-14T00:00:00Z",
      },
      {
        planGroupId: "single",
        startDate: "2024-06-15",
        endDate: "2024-06-15",
        createdAt: "2024-06-14T00:00:00Z",
      },
    ]
    expect(resolveActivePlan(periods, "2024-06-15")).toBe("single")
  })

  // -- endDatetime boundary tests --

  it("excludes plan ending today when datetime is after endDatetime", () => {
    const periods: PlanPeriod[] = [{
      ...base,
      planGroupId: "old",
      endDate: "2024-06-15",
      endDatetime: "2024-06-15T14:00:00Z",
      createdAt: "2024-01-01T00:00:00Z",
    }]
    expect(resolveActivePlan(periods, "2024-06-15", "2024-06-15T15:00:00Z")).toBe(null)
  })

  it("includes plan ending today when datetime is before endDatetime", () => {
    const periods: PlanPeriod[] = [{
      ...base,
      planGroupId: "old",
      endDate: "2024-06-15",
      endDatetime: "2024-06-15T14:00:00Z",
      createdAt: "2024-01-01T00:00:00Z",
    }]
    expect(resolveActivePlan(periods, "2024-06-15", "2024-06-15T13:00:00Z")).toBe("old")
  })

  it("ignores endDatetime when datetime param not provided", () => {
    const periods: PlanPeriod[] = [{
      ...base,
      planGroupId: "old",
      endDate: "2024-06-15",
      endDatetime: "2024-06-15T14:00:00Z",
      createdAt: "2024-01-01T00:00:00Z",
    }]
    expect(resolveActivePlan(periods, "2024-06-15")).toBe("old")
  })

  it("ignores endDatetime when query date is not the end date", () => {
    const periods: PlanPeriod[] = [{
      ...base,
      planGroupId: "old",
      endDate: "2024-06-15",
      endDatetime: "2024-06-15T14:00:00Z",
      createdAt: "2024-01-01T00:00:00Z",
    }]
    // Querying June 14 (not the end date) — endDatetime should not affect it
    expect(resolveActivePlan(periods, "2024-06-14", "2024-06-14T20:00:00Z")).toBe("old")
  })

  // -- startDatetime boundary tests --

  it("excludes plan starting today when datetime is before startDatetime", () => {
    const periods: PlanPeriod[] = [{
      ...base,
      planGroupId: "new",
      startDate: "2024-06-15",
      startDatetime: "2024-06-15T14:01:00Z",
      endDate: null,
      createdAt: "2024-06-15T14:01:00Z",
    }]
    expect(resolveActivePlan(periods, "2024-06-15", "2024-06-15T13:00:00Z")).toBe(null)
  })

  it("includes plan starting today when datetime is after startDatetime", () => {
    const periods: PlanPeriod[] = [{
      ...base,
      planGroupId: "new",
      startDate: "2024-06-15",
      startDatetime: "2024-06-15T14:01:00Z",
      endDate: null,
      createdAt: "2024-06-15T14:01:00Z",
    }]
    expect(resolveActivePlan(periods, "2024-06-15", "2024-06-15T15:00:00Z")).toBe("new")
  })

  it("same-day switch: old plan excluded, new plan selected", () => {
    const periods: PlanPeriod[] = [
      {
        ...base,
        planGroupId: "old",
        endDate: "2024-06-15",
        endDatetime: "2024-06-15T14:00:00Z",
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        ...base,
        planGroupId: "new",
        startDate: "2024-06-15",
        startDatetime: "2024-06-15T14:01:00Z",
        endDate: null,
        createdAt: "2024-06-15T14:01:00Z",
      },
    ]
    // After transition: old excluded, new selected
    expect(resolveActivePlan(periods, "2024-06-15", "2024-06-15T15:00:00Z")).toBe("new")
    // Before transition: new excluded, old selected
    expect(resolveActivePlan(periods, "2024-06-15", "2024-06-15T13:00:00Z")).toBe("old")
  })
})

describe("parseDuration", () => {
  it("parses days", () => {
    expect(parseDuration("14 days")).toEqual({ days: 14 })
    expect(parseDuration("1 day")).toEqual({ days: 1 })
  })

  it("parses weeks", () => {
    expect(parseDuration("3 weeks")).toEqual({ days: 21 })
    expect(parseDuration("1 week")).toEqual({ days: 7 })
  })

  it("parses months", () => {
    expect(parseDuration("2 months")).toEqual({ days: 60 })
    expect(parseDuration("1 month")).toEqual({ days: 30 })
  })

  it("parses years", () => {
    expect(parseDuration("1 year")).toEqual({ days: 365 })
  })

  it("parses 'about N weeks'", () => {
    expect(parseDuration("about 3 weeks")).toEqual({ days: 21 })
  })

  it("parses 'about N months'", () => {
    expect(parseDuration("about 2 months")).toEqual({ days: 60 })
  })

  it("parses 'a few weeks'", () => {
    expect(parseDuration("a few weeks")).toEqual({ days: 21 })
  })

  it("parses 'a couple months'", () => {
    expect(parseDuration("a couple months")).toEqual({ days: 60 })
  })

  it("parses 'a couple of weeks'", () => {
    expect(parseDuration("a couple of weeks")).toEqual({ days: 14 })
  })

  it("parses bare number as days", () => {
    expect(parseDuration("30")).toEqual({ days: 30 })
  })

  it("returns null for empty string", () => {
    expect(parseDuration("")).toBe(null)
  })

  it("returns null for unparseable input", () => {
    expect(parseDuration("forever")).toBe(null)
  })

  it("handles whitespace", () => {
    expect(parseDuration("  3 weeks  ")).toEqual({ days: 21 })
  })
})
