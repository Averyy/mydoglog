/** Human-readable labels for product type enum values. */
export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  dry_food: "Kibble",
  wet_food: "Wet food",
  treat: "Treat",
  topper: "Topper",
  supplement: "Supplement",
  probiotic: "Probiotic",
  freeze_dried: "Freeze-dried",
  whole_food: "Whole food",
}

/** Product types that are supplements/toppers (not primary food). */
export const SUPPLEMENT_PRODUCT_TYPES = new Set(["supplement", "probiotic", "topper", "treat"])

/** Short human-readable labels for Purina 1–7 fecal scores. */
export const FECAL_SCORE_LABELS: Record<number, string> = {
  1: "Hard pellets",
  2: "Ideal",
  3: "Soft",
  4: "Soggy",
  5: "Soft piles",
  6: "No shape",
  7: "Liquid",
}

/** Short human-readable labels for itch scores. */
export const ITCH_SCORE_LABELS: Record<number, string> = {
  0: "None",
  1: "Very mild",
  2: "Mild",
  3: "Moderate",
  4: "Severe",
  5: "Extreme",
}

/** Human-readable labels for medication reason enum values. */
export const MEDICATION_REASON_LABELS: Record<string, string> = {
  itchiness: "Itchiness",
  digestive: "Digestive",
  other: "Other",
}

/** Shared quantity unit options for feeding/routine editors. */
export const QUANTITY_UNIT_OPTIONS = [
  { value: "cup", label: "cup" },
  { value: "can", label: "can" },
  { value: "g", label: "g" },
  { value: "scoop", label: "scoop" },
  { value: "piece", label: "piece" },
  { value: "treat", label: "treat" },
  { value: "tbsp", label: "tbsp" },
  { value: "tsp", label: "tsp" },
  { value: "ml", label: "ml" },
] as const
