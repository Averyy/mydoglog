/** Human-readable labels for product type enum values. */
export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  food: "Food",
  treat: "Treat",
  supplement: "Supplement",
}

/** Human-readable labels for product format enum values. */
export const PRODUCT_FORMAT_LABELS: Record<string, string> = {
  dry: "Kibble",
  wet: "Wet",
}

/** Product types that are not primary food. */
export const NON_FOOD_TYPES = new Set(["treat", "supplement"])

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

/** Human-readable labels for dosing interval enum values. */
export const DOSING_INTERVAL_LABELS: Record<string, string> = {
  four_times_daily: "4x daily",
  three_times_daily: "3x daily",
  twice_daily: "Twice daily",
  daily: "Daily",
  every_other_day: "Every other day",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  every_6_weeks: "Every 6 weeks",
  every_8_weeks: "Every 8 weeks",
  every_12_weeks: "Every 12 weeks",
  every_3_months: "Every 3 months",
  every_6_months: "Every 6 months",
  every_8_months: "Every 8 months",
  annually: "Annually",
  as_needed: "As needed",
}

/** Human-readable labels for medication category enum values. */
export const MEDICATION_CATEGORY_LABELS: Record<string, string> = {
  allergy: "Allergies",
  parasite: "Parasite Prevention",
  gi: "GI / Stomach",
  pain: "Pain / NSAID",
  steroid: "Steroids",
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
