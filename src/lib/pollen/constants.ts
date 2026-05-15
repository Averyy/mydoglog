/** Pollen-sparr provider identifiers and location slugs. */
export const AEROBIOLOGY_PROVIDER = "aerobiology"

export const HAMILTON_LOCATION = "hamilton-on"

/** Pollen-sparr location IDs (hardcoded — no runtime lookup). */
export const HAMILTON_LOCATION_ID = 10 // aerobiology, 52.3km from St. Catharines

/** Valid source types from pollen-sparr. */
export const VALID_SOURCES = new Set(["actual", "forecast"])
