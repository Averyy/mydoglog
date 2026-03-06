"use client"

import { useState, useEffect, useCallback, useRef } from "react"
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
import { ChevronsUpDown, Loader2 } from "lucide-react"
import { cn, smallImageUrl } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-is-mobile"
import type { ProductSummary } from "@/lib/types"
import { PRODUCT_TYPE_LABELS } from "@/lib/labels"
import { parseCalorieContent } from "@/lib/nutrition"

const PAGE_SIZE = 30

interface BrandInfo {
  id: string
  name: string
  logoUrl: string | null
  productCount: number
}

interface ProductPickerProps {
  value: ProductSummary | null
  onChange: (product: ProductSummary | null) => void
  productType?: string
  placeholder?: string
  /** Render dropdown inline instead of in a portal. Use inside Dialog/Drawer. */
  inline?: boolean
}

export function ProductPicker({
  value,
  onChange,
  productType,
  placeholder = "Search products...",
  inline = false,
}: ProductPickerProps): React.ReactElement {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ProductSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [brands, setBrands] = useState<BrandInfo[]>([])
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const queryRef = useRef(query)
  const brandIdRef = useRef(selectedBrandId)

  queryRef.current = query
  brandIdRef.current = selectedBrandId

  const search = useCallback(
    async (q: string, brandId: string | null) => {
      setLoading(true)
      setPage(1)
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: "1" })
        if (q) params.set("q", q)
        if (productType) params.set("type", productType)
        if (brandId) params.set("brand_id", brandId)
        const res = await fetch(`/api/products?${params}`)
        if (res.ok) {
          const data = await res.json()
          setResults(data.items ?? [])
          setHasMore(data.page < data.totalPages)
          setLoaded(true)
          setLoadError(false)
        } else {
          setLoadError(true)
        }
      } catch {
        setLoadError(true)
      } finally {
        setLoading(false)
      }
    },
    [productType],
  )

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    const q = queryRef.current
    const brandId = brandIdRef.current
    const nextPage = page + 1
    setLoadingMore(true)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(nextPage) })
      if (q) params.set("q", q)
      if (productType) params.set("type", productType)
      if (brandId) params.set("brand_id", brandId)
      const res = await fetch(`/api/products?${params}`)
      if (res.ok) {
        const data = await res.json()
        setResults((prev) => [...prev, ...(data.items ?? [])])
        setPage(nextPage)
        setHasMore(data.page < data.totalPages)
      }
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, page, productType])

  // Eagerly fetch brands and initial products on mount (warms API routes in dev)
  useEffect(() => {
    fetch("/api/brands")
      .then((r) => r.json())
      .then((data: BrandInfo[]) => {
        setBrands(data.filter((b) => b.productCount > 0))
      })
      .catch(() => {})
    search("", null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Retry on error when opened
  useEffect(() => {
    if (open && loadError) {
      search(query, selectedBrandId)
    }
  }, [open, loadError, search, query, selectedBrandId])

  // Debounced search on query text change
  useEffect(() => {
    if (!open || !loaded) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(query, selectedBrandId), 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, search, open, loaded])

  // IntersectionObserver for infinite scroll — root must be the scroll container
  useEffect(() => {
    const sentinel = sentinelRef.current
    const root = listRef.current
    if (!sentinel || !root) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore()
        }
      },
      { root, threshold: 0.1 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore])

  /** Show packaging-aware label when possible (e.g. "Can" instead of "Wet food"). */
  function formatType(type: string | null, calorieContent: string | null): string {
    if (!type) return ""
    if (type === "wet_food") {
      if (calorieContent) {
        const parsed = parseCalorieContent(calorieContent)
        if (parsed.pouch !== undefined) return "Pouch"
        if (parsed.box !== undefined) return "Box"
      }
      // Default wet food to "Can" — virtually all wet dog food is canned
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

  function handleBrandToggle(brandId: string): void {
    const next = selectedBrandId === brandId ? null : brandId
    setSelectedBrandId(next)
    search(query, next)
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
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={setQuery}
            className="h-11"
          />
          {brands.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto border-b px-2 py-2">
              {brands.map((brand) => (
                <button
                  key={brand.id}
                  type="button"
                  onClick={() => handleBrandToggle(brand.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    selectedBrandId === brand.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border hover:bg-item-hover",
                  )}
                >
                  {brand.logoUrl && (
                    <img
                      src={brand.logoUrl}
                      alt=""
                      className="size-4 shrink-0 rounded-sm object-contain"
                    />
                  )}
                  {brand.name}
                </button>
              ))}
            </div>
          )}
          <CommandList ref={listRef} className="min-h-[200px]">
            {loading && results.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && loadError && results.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Failed to load products.{" "}
                <button
                  type="button"
                  onClick={() => search(query, selectedBrandId)}
                  className="text-primary underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            )}
            {loaded && !loading && !loadError && results.length === 0 && (
              <CommandEmpty>No products found.</CommandEmpty>
            )}
            {results.length > 0 && (
              <CommandGroup className={cn(loading && "opacity-50 transition-opacity")}>
                {results.map((product) => {
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
                      className="min-h-[48px] gap-3"
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
            {hasMore && (
              <div ref={sentinelRef} className="flex items-center justify-center py-2">
                {loadingMore && (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                )}
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
