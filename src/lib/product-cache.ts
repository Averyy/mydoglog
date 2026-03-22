import type { ProductSummary } from "@/lib/types"

// ── Module-level cache ──────────────────────────────────────────────────────

interface CacheEntry {
  items: ProductSummary[]
  timestamp: number
}

const productCache = new Map<string, CacheEntry>()
const CACHE_TTL = 4 * 60 * 60 * 1000 // 4 hours — products only change when scrapers run

export function getCacheKey(productType?: string): string {
  return productType ?? "__all__"
}

/** In-flight fetch promises to avoid duplicate requests */
const inflight = new Map<string, Promise<ProductSummary[]>>()

export function getInflight(key: string): Promise<ProductSummary[]> | undefined {
  return inflight.get(key)
}

export function getCached(key: string): CacheEntry | undefined {
  return productCache.get(key)
}

export function deleteCache(key: string): void {
  productCache.delete(key)
}

export function isCacheValid(key: string): boolean {
  const cached = productCache.get(key)
  return !!cached && Date.now() - cached.timestamp < CACHE_TTL
}

/** Prefetch products into the module-level cache. Safe to call multiple times. */
export function prefetchProducts(productType?: string): void {
  const cacheKey = getCacheKey(productType)
  const cached = productCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return
  if (inflight.has(cacheKey)) return

  const params = new URLSearchParams({ all: "true" })
  if (productType) params.set("type", productType)

  const promise = fetch(`/api/products?${params}`)
    .then((r) => {
      if (!r.ok) throw new Error(`Products fetch failed: ${r.status}`)
      return r.json()
    })
    .then((data: { items: ProductSummary[] }) => {
      const items = data.items ?? []
      productCache.set(cacheKey, { items, timestamp: Date.now() })
      inflight.delete(cacheKey)
      return items
    })
    .catch((err) => {
      inflight.delete(cacheKey)
      throw err
    })

  inflight.set(cacheKey, promise)
}

export { CACHE_TTL }
