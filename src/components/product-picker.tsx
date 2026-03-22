"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
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
import { LiaSortSolid } from "react-icons/lia"
import { cn, smallImageUrl, stripBrandPrefix } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-is-mobile"
import type { ProductSummary } from "@/lib/types"
import { PRODUCT_TYPE_LABELS, FORMAT_KEYWORDS } from "@/lib/labels"
import { parseCalorieContent } from "@/lib/nutrition"
import {
  prefetchProducts,
  getCacheKey,
  getCached,
  getInflight,
  deleteCache,
  isCacheValid,
} from "@/lib/product-cache"

export { prefetchProducts }

// ── Types ───────────────────────────────────────────────────────────────────

interface ProductPickerProps {
  value: ProductSummary | null
  onChange: (product: ProductSummary | null) => void
  productType?: string
  placeholder?: string
  /** Enables "Recent" filter chip; fetches recent product IDs for this dog */
  dogId?: string
}

export function ProductPicker({
  value,
  onChange,
  productType,
  placeholder = "Search products...",
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
  const [renderLimit, setRenderLimit] = useState(200)
  const listRef = useRef<HTMLDivElement>(null)
  const filterBarRef = useRef<HTMLDivElement>(null)
  /** True when the user manually clicked a filter chip (skip auto-scroll) */
  const userClickedFilterRef = useRef(false)

  /** Fetch (or re-fetch) products into state from cache/network. */
  function fetchProducts(): void {
    setLoading(true)
    setLoadError(false)
    deleteCache(getCacheKey(productType))
    prefetchProducts(productType)
    const promise = getInflight(getCacheKey(productType))
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
    userClickedFilterRef.current = false
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

  // Scroll active filter chip to center only on auto-select (not manual clicks)
  useEffect(() => {
    if (!open || userClickedFilterRef.current) return
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

    if (isCacheValid(cacheKey)) {
      setAllProducts(getCached(cacheKey)!.items)
      setLoading(false)
    } else {
      // Reuse in-flight prefetch if one exists, otherwise start a new fetch
      const existing = getInflight(cacheKey)
      const promise = existing ?? (() => {
        prefetchProducts(productType)
        return getInflight(cacheKey)!
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
  // When the user is actively searching, escape out of "recent" filter
  // so results aren't limited to just their recent products
  const effectiveFilter = (query.trim() && activeFilter === "recent") ? "all" : activeFilter

  const filteredProducts = useMemo(() => {
    let list = allProducts

    // Apply filter
    if (effectiveFilter === "recent") {
      const productMap = new Map(list.map((p) => [p.id, p]))
      list = recentProductIds
        .map((id) => productMap.get(id))
        .filter((p): p is ProductSummary => !!p)
    } else if (effectiveFilter !== "all") {
      // brandId filter
      list = list.filter((p) => p.brandId === effectiveFilter)
    }

    // Apply text search
    if (query.trim()) {
      const terms = query
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
      // Separate format-keyword terms from text-search terms
      const formatFilters = terms.map((t) => FORMAT_KEYWORDS[t]).filter(Boolean)
      const textTerms = terms.filter((t) => !FORMAT_KEYWORDS[t])
      if (formatFilters.length > 0) {
        list = list.filter((p) => formatFilters.some((f) => p.format === f))
      }
      if (textTerms.length > 0) {
        list = list.filter((p) => {
          const haystack = `${p.name} ${p.brandName}`.toLowerCase()
          return textTerms.every((t) => haystack.includes(t))
        })
      }
    }

    return list
  }, [allProducts, effectiveFilter, recentProductIds, query])

  // Reset render limit when filter/query changes
  useEffect(() => {
    setRenderLimit(200)
  }, [activeFilter, query])

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
  function formatType(type: string | null, format: string | null, calorieContent: string | null): string {
    if (!type) return ""
    if (format === "wet") {
      if (calorieContent) {
        const parsed = parseCalorieContent(calorieContent)
        if (parsed.pouch !== undefined) return "Pouch"
        if (parsed.box !== undefined) return "Box"
      }
      return "Can"
    }
    if (format === "dry" && type === "food") return "Kibble"
    if (type === "treat") return "Treat"
    if (type === "supplement") return "Supplement"
    return PRODUCT_TYPE_LABELS[type] ?? type
  }

  const visibleProducts = filteredProducts.slice(0, renderLimit)
  const hasMore = filteredProducts.length > renderLimit

  function handleListScroll(e: React.UIEvent<HTMLDivElement>): void {
    if (!hasMore) return
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      setRenderLimit((prev) => prev + 200)
    }
  }

  function handleImageError(productId: string): void {
    setFailedImages((prev) => new Set(prev).add(productId))
  }

  const triggerButton = (
    <Button
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className={cn(
        "w-full justify-between font-normal hover:bg-item-hover-subtle",
        value ? "h-auto min-h-11 py-1.5 whitespace-normal" : "text-muted-foreground",
      )}
      onClick={isMobile ? () => setOpen(true) : undefined}
    >
      {value ? (
        <span className="flex items-start gap-2.5 text-left">
          {value.imageUrl && !failedImages.has(value.id) && (
            <span className="size-9 shrink-0 rounded-md bg-muted-subtle">
              <img
                src={smallImageUrl(value.imageUrl)}
                alt=""
                className="size-full rounded-md object-contain mix-blend-multiply dark:mix-blend-normal"
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
      <LiaSortSolid className="ml-2 size-4 shrink-0 text-text-tertiary" />
    </Button>
  )

  const commandContent = (
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
            onClick={() => { userClickedFilterRef.current = true; setActiveFilter("all") }}
            aria-pressed={effectiveFilter === "all"}
            {...(effectiveFilter === "all" ? { "data-active-filter": "" } : {})}
            className={cn(
              "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              effectiveFilter === "all"
                ? "border-foreground bg-foreground text-background"
                : "border-border hover:bg-item-hover",
            )}
          >
            All
          </button>
          {showRecentChip && (
            <button
              type="button"
              onClick={() => { userClickedFilterRef.current = true; setActiveFilter("recent") }}
              aria-pressed={effectiveFilter === "recent"}
              {...(effectiveFilter === "recent" ? { "data-active-filter": "" } : {})}
              className={cn(
                "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                effectiveFilter === "recent"
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
              onClick={() => {
                userClickedFilterRef.current = true
                setActiveFilter(activeFilter === brand.id ? "all" : brand.id)
              }}
              aria-pressed={effectiveFilter === brand.id}
              {...(effectiveFilter === brand.id ? { "data-active-filter": "" } : {})}
              className={cn(
                "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                effectiveFilter === brand.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border hover:bg-item-hover",
              )}
            >
              {brand.name}
            </button>
          ))}
        </div>
      )}
      <CommandList ref={listRef} onScroll={handleListScroll} className={cn("min-h-[200px]", isMobile && "h-[60vh] max-h-[60vh]")}>
        {loading && (
          <div className="p-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex min-h-[48px] items-center gap-3 px-2 py-1.5">
                <div className="size-10 shrink-0 animate-pulse rounded bg-muted" />
                <div className="flex flex-1 flex-col gap-0.5">
                  <div className="h-3.5 animate-pulse rounded bg-muted" style={{ width: `${55 + (i * 17) % 30}%` }} />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                </div>
                <div className="h-5 w-12 animate-pulse rounded-full bg-muted shrink-0" />
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
        {visibleProducts.length > 0 && (
          <CommandGroup className="animate-in fade-in duration-200">
            {visibleProducts.map((product) => {
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
                  <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted-subtle [&_img]:mix-blend-multiply dark:[&_img]:mix-blend-normal">
                    {product.imageUrl && !imgFailed ? (
                      <img
                        src={smallImageUrl(product.imageUrl)}
                        alt=""
                        loading="lazy"
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
                      {formatType(product.type, product.format, product.calorieContent)}
                    </Badge>
                  )}
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )

  if (isMobile) {
    return (
      <>
        {triggerButton}
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent aria-describedby={undefined}>
            <div className="pb-4" />
            <DrawerHeader className="sr-only">
              <DrawerTitle>Select product</DrawerTitle>
            </DrawerHeader>
            <div className="flex flex-col px-2 pb-4" data-vaul-no-drag>
              {commandContent}
            </div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {triggerButton}
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
        align="start"
        onWheel={(e) => e.stopPropagation()}
      >
        {commandContent}
      </PopoverContent>
    </Popover>
  )
}
