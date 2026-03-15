/**
 * Shared medication helpers.
 *
 * Catalog medications (medicationProductId != null) use flags from the
 * medication_products table. Custom medications use flags stored directly
 * on the medications row.
 */

/** Row shape returned by queries that join medications ← medication_products. */
export interface MedicationFlagRow {
  medicationProductId: string | null
  catalogSuppressesItch: boolean | null
  catalogHasGiSideEffects: boolean | null
  customSuppressesItch: boolean | null
  customHasGiSideEffects: boolean | null
}

/** Resolve catalog-vs-custom medication flags into concrete booleans. */
export function resolveMedicationFlags(row: MedicationFlagRow): {
  suppressesItch: boolean
  hasGiSideEffects: boolean
} {
  return {
    suppressesItch: row.medicationProductId != null
      ? (row.catalogSuppressesItch ?? false)
      : (row.customSuppressesItch ?? false),
    hasGiSideEffects: row.medicationProductId != null
      ? (row.catalogHasGiSideEffects ?? false)
      : (row.customHasGiSideEffects ?? false),
  }
}
