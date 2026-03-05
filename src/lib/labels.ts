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
  { value: "tbsp", label: "tbsp" },
  { value: "tsp", label: "tsp" },
  { value: "ml", label: "ml" },
] as const
