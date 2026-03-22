import type { MedicationProduct } from "@/lib/db/schema"

// ── Module-level cache ──────────────────────────────────────────────────────

let cache: { items: MedicationProduct[]; at: number } | null = null
let inflight: Promise<MedicationProduct[]> | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function fetchMedicationCatalog(): Promise<MedicationProduct[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL) {
    return cache.items
  }
  if (inflight) return inflight

  inflight = fetch("/api/medication-products")
    .then((r) => {
      if (!r.ok) throw new Error("Failed to fetch medication catalog")
      return r.json()
    })
    .then((items: MedicationProduct[]) => {
      cache = { items, at: Date.now() }
      inflight = null
      return items
    })
    .catch((err) => {
      inflight = null
      throw err
    })

  return inflight
}

export function getMedicationCached(): MedicationProduct[] | null {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.items
  return null
}
