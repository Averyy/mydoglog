/** Pollen-sparr provider identifiers and location slugs. */
export const AEROBIOLOGY_PROVIDER = "aerobiology"
export const TWN_PROVIDER = "twn"

export const HAMILTON_LOCATION = "hamilton-on"
export const NIAGARA_LOCATION = "niagara-on"

/** Pollen-sparr location IDs (hardcoded — no runtime lookup). */
export const HAMILTON_LOCATION_ID = 10 // aerobiology, 52.3km from St. Catharines
export const TWN_NIAGARA_LOCATION_ID = 32 // twn, 14.4km from St. Catharines

/** Valid source types from pollen-sparr. */
export const VALID_SOURCES = new Set(["actual", "forecast", "today"])
