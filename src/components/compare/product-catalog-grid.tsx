"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { ProductSummary } from "@/lib/types"
import {
  prefetchProducts,
  getCacheKey,
  getCached,
  getInflight,
  isCacheValid,
} from "@/lib/product-cache"
import { FORMAT_KEYWORDS } from "@/lib/labels"
import { CompareProductCard } from "./compare-product-card"
import { LiaSearchSolid } from "react-icons/lia"

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border hover:bg-item-hover",
      )}
    >
      {label}
    </button>
  )
}

interface ProductCatalogGridProps {
  selectedIds: string[]
  onToggle: (product: ProductSummary) => void
  onProductsLoaded?: (products: ProductSummary[]) => void
  maxCompare: number
}

export function ProductCatalogGrid({
  selectedIds,
  onToggle,
  onProductsLoaded,
  maxCompare,
}: ProductCatalogGridProps): React.ReactElement {
  const onProductsLoadedRef = useRef(onProductsLoaded)
  onProductsLoadedRef.current = onProductsLoaded
  const [allProducts, setAllProducts] = useState<ProductSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [query, setQuery] = useState("")
  const [activeFormat, setActiveFormat] = useState<string>("all")
  const [activeType, setActiveType] = useState<string>("all")
  const [activeChannel, setActiveChannel] = useState<string>("all")
  const [activeBrand, setActiveBrand] = useState<string>("all")
  const [renderLimit, setRenderLimit] = useState(60)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Fetch all products on mount
  useEffect(() => {
    const cacheKey = getCacheKey()
    if (isCacheValid(cacheKey)) {
      const items = getCached(cacheKey)!.items
      setAllProducts(items)
      setLoading(false)
      onProductsLoadedRef.current?.(items)
    } else {
      const existing = getInflight(cacheKey)
      const promise = existing ?? (() => {
        prefetchProducts()
        return getInflight(cacheKey)!
      })()
      promise
        .then((items) => {
          setAllProducts(items)
          onProductsLoadedRef.current?.(items)
        })
        .catch(() => {
          setLoadError(true)
        })
        .finally(() => setLoading(false))
    }
  }, [])

  // Infinite scroll via IntersectionObserver — re-attaches when loading state changes
  // so the sentinel can be found after products load
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setRenderLimit((prev) => prev + 60)
        }
      },
      { rootMargin: "400px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loading, allProducts.length])

  // Reset render limit on filter change
  useEffect(() => {
    setRenderLimit(60)
  }, [query, activeFormat, activeType, activeChannel, activeBrand])

  // Derive brands from filtered products (respecting type/channel/format)
  const brands = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>()
    for (const p of allProducts) {
      if (p.type === "treat") continue
      const existing = map.get(p.brandId)
      if (existing) existing.count++
      else map.set(p.brandId, { name: p.brandName, count: 1 })
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, v]) => ({ id, name: v.name }))
  }, [allProducts])

  // Filter products
  const filteredProducts = useMemo(() => {
    // Only show food + supplements (not treats)
    let list = allProducts.filter((p) => p.type === "food" || p.type === "supplement")

    // Type filter
    if (activeType !== "all") {
      list = list.filter((p) => p.type === activeType)
    }

    // Format filter
    if (activeFormat !== "all") {
      list = list.filter((p) => p.format === activeFormat)
    }

    // Channel filter
    if (activeChannel !== "all") {
      list = list.filter((p) => p.channel === activeChannel)
    }

    // Brand filter
    if (activeBrand !== "all") {
      list = list.filter((p) => p.brandId === activeBrand)
    }

    // Text search
    if (query.trim()) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
      const formatFilters = terms.map((t) => FORMAT_KEYWORDS[t]).filter(Boolean)
      const textTerms = terms.filter((t) => !FORMAT_KEYWORDS[t])
      if (formatFilters.length > 0) {
        list = list.filter((p) => formatFilters.some((f) => p.format === f))
      }
      if (textTerms.length > 0) {
        const strip = (s: string): string => s.toLowerCase().replace(/'/g, "")
        const normalizedTerms = textTerms.map(strip)
        list = list.filter((p) => {
          const haystack = strip(`${p.name} ${p.brandName}`)
          const haystackNoSlash = haystack.replace(/\//g, "")
          return normalizedTerms.every((t) =>
            haystack.includes(t) || (!t.includes("/") && haystackNoSlash.includes(t)),
          )
        })
      }
    }

    return list
  }, [allProducts, activeFormat, activeType, activeChannel, activeBrand, query])

  const visibleProducts = filteredProducts.slice(0, renderLimit)
  const hasMore = filteredProducts.length > renderLimit
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const atMax = selectedIds.length >= maxCompare

  const GRID_COLS = "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"

  return (
    <div className="flex flex-col gap-4">
      {/* Search bar */}
      <div className="relative">
        <LiaSearchSolid className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search foods..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 pl-9"
        />
      </div>

      {/* Filter row: Format | Type | Channel */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Format */}
        <div className="flex gap-1.5">
          {[
            { key: "all", label: "All" },
            { key: "dry", label: "Dry" },
            { key: "wet", label: "Wet" },
          ].map((tab) => (
            <FilterChip
              key={tab.key}
              label={tab.label}
              active={activeFormat === tab.key}
              onClick={() => setActiveFormat(tab.key)}
            />
          ))}
        </div>

        <span className="text-border">|</span>

        {/* Channel */}
        <div className="flex gap-1.5">
          {[
            { key: "all", label: "All" },
            { key: "retail", label: "Retail" },
            { key: "vet", label: "Vet" },
          ].map((tab) => (
            <FilterChip
              key={tab.key}
              label={tab.label}
              active={activeChannel === tab.key}
              onClick={() => setActiveChannel(tab.key)}
            />
          ))}
        </div>

        <span className="text-border">|</span>

        {/* Type */}
        <div className="flex gap-1.5">
          {[
            { key: "all", label: "All" },
            { key: "food", label: "Food" },
            { key: "supplement", label: "Supplements" },
          ].map((tab) => (
            <FilterChip
              key={tab.key}
              label={tab.label}
              active={activeType === tab.key}
              onClick={() => setActiveType(tab.key)}
            />
          ))}
        </div>
      </div>

      {/* Brand chips */}
      {brands.length > 0 && (
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-1">
          <FilterChip
            label="All Brands"
            active={activeBrand === "all"}
            onClick={() => setActiveBrand("all")}
          />
          {brands.map((brand) => (
            <FilterChip
              key={brand.id}
              label={brand.name}
              active={activeBrand === brand.id}
              onClick={() => setActiveBrand(activeBrand === brand.id ? "all" : brand.id)}
            />
          ))}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className={cn("grid gap-3", GRID_COLS)}>
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
              <div className="aspect-square animate-pulse bg-muted-subtle" />
              <div className="flex flex-col gap-2 p-3">
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
              </div>
              <div className="px-3 pb-3">
                <div className="h-8 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Failed to load products.{" "}
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              setLoadError(false)
              prefetchProducts()
              const cacheKey = getCacheKey()
              getInflight(cacheKey)!
                .then((items) => {
                  setAllProducts(items)
                  setLoadError(false)
                  onProductsLoadedRef.current?.(items)
                })
                .catch(() => setLoadError(true))
                .finally(() => setLoading(false))
            }}
            className="text-primary underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No products found.
        </div>
      ) : (
        <>
          <div className={cn("grid gap-3", GRID_COLS)}>
            {visibleProducts.map((product) => (
              <CompareProductCard
                key={product.id}
                product={product}
                isSelected={selectedIdSet.has(product.id)}
                onToggle={onToggle}
                disabled={atMax}
              />
            ))}
          </div>
          {hasMore && (
            <div ref={sentinelRef} className="h-1" />
          )}
          <p className="text-center text-xs text-muted-foreground">
            {filteredProducts.length} products
          </p>
        </>
      )}
    </div>
  )
}
