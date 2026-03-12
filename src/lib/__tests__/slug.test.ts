import { describe, it, expect } from "vitest"
import { sanitizeDogName, validateDogName, slugify, RESERVED_SLUGS } from "../slug"

describe("sanitizeDogName", () => {
  it("strips numbers", () => {
    expect(sanitizeDogName("Buddy123")).toBe("Buddy")
  })

  it("strips emoji", () => {
    expect(sanitizeDogName("Peaches 🐶")).toBe("Peaches")
  })

  it("strips punctuation", () => {
    expect(sanitizeDogName("Mr. Barkley!")).toBe("Mr Barkley")
  })

  it("collapses multiple spaces", () => {
    expect(sanitizeDogName("  Good   Boy  ")).toBe("Good Boy")
  })

  it("caps at 20 characters", () => {
    expect(sanitizeDogName("A".repeat(30))).toBe("A".repeat(20))
  })

  it("returns empty for numbers-only input", () => {
    expect(sanitizeDogName("12345")).toBe("")
  })

  it("handles mixed valid/invalid chars", () => {
    expect(sanitizeDogName("B-u-d-d-y")).toBe("Buddy")
  })
})

describe("validateDogName", () => {
  it("returns null for valid names", () => {
    expect(validateDogName("Buddy")).toBeNull()
    expect(validateDogName("Good Boy")).toBeNull()
  })

  it("rejects too-short names", () => {
    expect(validateDogName("Ab")).toBe("Name must be at least 3 characters")
  })

  it("rejects names that sanitize to empty", () => {
    expect(validateDogName("!!!")).toBe("Name must be at least 3 characters")
  })

  it("rejects names that sanitize to < 3 chars", () => {
    expect(validateDogName("A1B")).toBe("Name must be at least 3 characters")
  })
})

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Good Boy")).toBe("good-boy")
  })

  it("lowercases single word", () => {
    expect(slugify("Peaches")).toBe("peaches")
  })
})

describe("RESERVED_SLUGS", () => {
  it("contains expected route names", () => {
    expect(RESERVED_SLUGS.has("api")).toBe(true)
    expect(RESERVED_SLUGS.has("settings")).toBe(true)
    expect(RESERVED_SLUGS.has("food")).toBe(true)
    expect(RESERVED_SLUGS.has("meds")).toBe(true)
    expect(RESERVED_SLUGS.has("insights")).toBe(true)
  })

  it("does not contain normal dog names", () => {
    expect(RESERVED_SLUGS.has("buddy")).toBe(false)
    expect(RESERVED_SLUGS.has("peaches")).toBe(false)
  })
})
