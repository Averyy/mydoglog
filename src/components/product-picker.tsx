"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronsUpDown } from "lucide-react"
import { cn, smallImageUrl } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-is-mobile"
import type { ProductSummary } from "@/lib/types"
import { PRODUCT_TYPE_LABELS } from "@/lib/labels"
import { parseCalorieContent } from "@/lib/nutrition"

// ── Module-level cache ──────────────────────────────────────────────────────

interface CacheEntry {
  items: ProductSummary[]
  timestamp: number
}

const productCache = new Map<string, CacheEntry>()
const CACHE_TTL = 2 * 60 * 1000 // 2 minutes

function getCacheKey(productType?: string): string {
  return productType ?? "__all__"
}

/** In-flight fetch promises to avoid duplicate requests */
const inflight = new Map<string, Promise<ProductSummary[]>>()

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
    .catch(() => {
      inflight.delete(cacheKey)
      return [] as ProductSummary[]
    })

  inflight.set(cacheKey, promise)
}

// ── Types ───────────────────────────────────────────────────────────────────

interface ProductPickerProps {
  value: ProductSummary | null
  onChange: (product: ProductSummary | null) => void
  productType?: string
  placeholder?: string
  /** Render dropdown inline instead of in a portal. Use inside Dialog/Drawer. */
  inline?: boolean
  /** Enables "Recent" filter chip; fetches recent product IDs for this dog */
  dogId?: string
}

export function ProductPicker({
  value,
  onChange,
  productType,
  placeholder = "Search products...",
  inline = false,
  dogId,
}: ProductPickerProps): React.ReactElement {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [allProducts, setAllProducts] = useState<ProductSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string>("all")
  const [recentProductIds, setRecentProductIds] = useState<string[]>([])
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)
  const filterBarRef = useRef<HTMLDivElement>(null)

  /** Fetch (or re-fetch) products into state from cache/network. */
  function fetchProducts(): void {
    setLoading(true)
    setLoadError(false)
    productCache.delete(getCacheKey(productType))
    prefetchProducts(productType)
    const promise = inflight.get(getCacheKey(productType))
    if (promise) {
      promise
        .then((items) => {
          setAllProducts(items)
          setLoadError(false)
        })
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false))
    }
  }

  // Smart default filter each time popover opens
  const valueRef = useRef(value)
  valueRef.current = value
  const recentIdsRef = useRef(recentProductIds)
  recentIdsRef.current = recentProductIds
  const allProductsRef = useRef(allProducts)
  allProductsRef.current = allProducts

  useEffect(() => {
    if (!open) return
    if (productType === "treat") {
      setActiveFilter("all")
    } else if (valueRef.current) {
      // Resolve brandId — value may have empty brandId if constructed without it
      const brandId = valueRef.current.brandId
        || allProductsRef.current.find((p) => p.id === valueRef.current!.id)?.brandId
      if (brandId) {
        setActiveFilter(brandId)
      } else if (dogId && recentIdsRef.current.length > 0) {
        setActiveFilter("recent")
      } else {
        setActiveFilter("all")
      }
    } else if (dogId && recentIdsRef.current.length > 0) {
      setActiveFilter("recent")
    } else {
      setActiveFilter("all")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Scroll active filter chip to center (RAF ensures DOM has painted)
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      const bar = filterBarRef.current
      if (!bar) return
      const active = bar.querySelector("[data-active-filter]") as HTMLElement | null
      if (!active) return
      const barRect = bar.getBoundingClientRect()
      const chipRect = active.getBoundingClientRect()
      const scrollLeft = active.offsetLeft - barRect.width / 2 + chipRect.width / 2
      bar.scrollTo({ left: scrollLeft, behavior: "instant" })
    })
    return () => cancelAnimationFrame(id)
  }, [open, activeFilter])

  // Fetch all products (with cache) + brands on mount
  useEffect(() => {
    const cacheKey = getCacheKey(productType)
    const cached = productCache.get(cacheKey)

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setAllProducts(cached.items)
      setLoading(false)
    } else {
      // Reuse in-flight prefetch if one exists, otherwise start a new fetch
      const existing = inflight.get(cacheKey)
      const promise = existing ?? (() => {
        prefetchProducts(productType)
        return inflight.get(cacheKey)!
      })()

      promise
        .then((items) => {
          setAllProducts(items)
          setLoadError(false)
        })
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false))
    }

  }, [productType])

  // Fetch recent product IDs when dogId is provided
  useEffect(() => {
    if (!dogId) return
    const params = new URLSearchParams()
    if (productType) params.set("type", productType)
    const qs = params.toString()
    fetch(`/api/dogs/${dogId}/products/recent${qs ? `?${qs}` : ""}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Recent products fetch failed: ${r.status}`)
        return r.json()
      })
      .then((ids: string[]) => setRecentProductIds(ids))
      .catch(() => {})
  }, [dogId, productType])

  // Retry on error when opened
  useEffect(() => {
    if (open && loadError) fetchProducts()
  }, [open, loadError, productType])

  // Client-side filtering
  const filteredProducts = useMemo(() => {
    let list = allProducts

    // Apply filter
    if (activeFilter === "recent") {
      list = recentProductIds
        .map((id) => list.find((p) => p.id === id))
        .filter((p): p is ProductSummary => !!p)
    } else if (activeFilter !== "all") {
      // brandId filter
      list = list.filter((p) => p.brandId === activeFilter)
    }

    // Apply text search
    if (query.trim()) {
      const terms = query
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
      list = list.filter((p) => {
        const haystack = `${p.name} ${p.brandName}`.toLowerCase()
        return terms.every((t) => haystack.includes(t))
      })
    }

    return list
  }, [allProducts, activeFilter, recentProductIds, query])

  // Derive brands from loaded products — no separate fetch needed
  const brands = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>()
    for (const p of allProducts) {
      const existing = map.get(p.brandId)
      if (existing) {
        existing.count++
      } else {
        map.set(p.brandId, { name: p.brandName, count: 1 })
      }
    }
    return Array.from(map.entries())
      .filter(([, v]) => v.count > 0)
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, v]) => ({ id, name: v.name }))
  }, [allProducts])

  const showRecentChip = !!dogId && recentProductIds.length > 0

  /** Show packaging-aware label when possible (e.g. "Can" instead of "Wet food"). */
  function formatType(type: string | null, calorieContent: string | null): string {
    if (!type) return ""
    if (type === "wet_food") {
      if (calorieContent) {
        const parsed = parseCalorieContent(calorieContent)
        if (parsed.pouch !== undefined) return "Pouch"
        if (parsed.box !== undefined) return "Box"
      }
      return "Can"
    }
    return PRODUCT_TYPE_LABELS[type] ?? type.replace(/_/g, " ")
  }

  function stripBrandPrefix(name: string, brandName: string): string {
    if (name.toLowerCase().startsWith(brandName.toLowerCase())) {
      const stripped = name.slice(brandName.length).replace(/^[\s\-–—]+/, "")
      if (stripped.length > 0) return stripped
    }
    return name
  }

  function handleImageError(productId: string): void {
    setFailedImages((prev) => new Set(prev).add(productId))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal hover:bg-item-hover-subtle",
            value ? "h-auto min-h-11 py-1.5 whitespace-normal" : "text-muted-foreground",
          )}
        >
          {value ? (
            <span className="flex items-start gap-2.5 text-left">
              {value.imageUrl && !failedImages.has(value.id) && (
                <span className="size-9 shrink-0 rounded-md bg-muted-subtle">
                  <img
                    src={smallImageUrl(value.imageUrl)}
                    alt=""
                    className="size-full rounded-md object-contain mix-blend-multiply"
                    onError={() => handleImageError(value.id)}
                  />
                </span>
              )}
              <span>
                <span className="block text-sm font-medium">{value.brandName}</span>
                <span className="block whitespace-normal text-xs text-muted-foreground">
                  {stripBrandPrefix(value.name, value.brandName)}
                </span>
              </span>
            </span>
          ) : (
            placeholder
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 text-text-tertiary" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        disablePortal={inline && isMobile}
        onWheel={inline && !isMobile ? (e) => e.stopPropagation() : undefined}
      >
        <Command shouldFilter={false} value={value?.id ?? ""}>
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={setQuery}
            className="h-11"
          />
          {(brands.length > 0 || showRecentChip) && (
            <div ref={filterBarRef} className="flex gap-1.5 overflow-x-auto border-b px-2 py-2">
              <button
                type="button"
                onClick={() => setActiveFilter("all")}
                aria-pressed={activeFilter === "all"}
                {...(activeFilter === "all" ? { "data-active-filter": "" } : {})}
                className={cn(
                  "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  activeFilter === "all"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border hover:bg-item-hover",
                )}
              >
                All
              </button>
              {showRecentChip && (
                <button
                  type="button"
                  onClick={() => setActiveFilter("recent")}
                  aria-pressed={activeFilter === "recent"}
                  {...(activeFilter === "recent" ? { "data-active-filter": "" } : {})}
                  className={cn(
                    "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    activeFilter === "recent"
                      ? "border-foreground bg-foreground text-background"
                      : "border-border hover:bg-item-hover",
                  )}
                >
                  Recent
                </button>
              )}
              {brands.map((brand) => (
                <button
                  key={brand.id}
                  type="button"
                  onClick={() =>
                    setActiveFilter(activeFilter === brand.id ? "all" : brand.id)
                  }
                  aria-pressed={activeFilter === brand.id}
                  {...(activeFilter === brand.id ? { "data-active-filter": "" } : {})}
                  className={cn(
                    "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    activeFilter === brand.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border hover:bg-item-hover",
                  )}
                >
                  {brand.name}
                </button>
              ))}
            </div>
          )}
          <CommandList ref={listRef} className="min-h-[200px]">
            {loading && (
              <div className="p-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex min-h-[48px] items-center gap-3 px-2 py-1.5">
                    <div className="size-10 shrink-0 animate-pulse rounded bg-muted" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
                      <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!loading && loadError && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Failed to load products.{" "}
                <button
                  type="button"
                  onClick={fetchProducts}
                  className="text-primary underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            )}
            {!loading && !loadError && filteredProducts.length === 0 && (
              <CommandEmpty>No products found.</CommandEmpty>
            )}
            {filteredProducts.length > 0 && (
              <CommandGroup>
                {filteredProducts.map((product) => {
                  const imgFailed = failedImages.has(product.id)
                  return (
                    <CommandItem
                      key={product.id}
                      value={product.id}
                      onSelect={() => {
                        onChange(product)
                        setOpen(false)
                        setQuery("")
                      }}
                      className="min-h-[48px] gap-3 [content-visibility:auto] [contain-intrinsic-size:auto_48px]"
                      title={`${product.brandName} — ${product.name}`}
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted-subtle [&_img]:mix-blend-multiply">
                        {product.imageUrl && !imgFailed ? (
                          <img
                            src={smallImageUrl(product.imageUrl)}
                            alt=""
                            className="size-full object-cover"
                            onError={() => handleImageError(product.id)}
                          />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">?</span>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-0.5 truncate">
                        <span className="truncate text-sm font-medium">
                          {stripBrandPrefix(product.name, product.brandName)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {product.brandName}
                        </span>
                      </div>
                      {product.type && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {formatType(product.type, product.calorieContent)}
                        </Badge>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
