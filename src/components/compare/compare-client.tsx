"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import type { ProductSummary, ProductDetail } from "@/lib/types"
import type { MedicationProduct } from "@/lib/db/schema"
import { cn } from "@/lib/utils"
import { ProductCatalogGrid } from "./product-catalog-grid"
import { MedicationCatalogTable } from "./medication-catalog-table"
import { CompareTray } from "./compare-tray"
import { CompareDrawer } from "./compare-drawer"

const MAX_COMPARE = 4

type CompareMode = "food" | "meds"

export function CompareClient(): React.ReactElement {
  // ── Mode ──────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<CompareMode>("food")

  // ── Food state ────────────────────────────────────────────────────────
  const [selectedProducts, setSelectedProducts] = useState<ProductSummary[]>([])
  const [pendingFoodIds, setPendingFoodIds] = useState<string[]>([])
  const [detailProducts, setDetailProducts] = useState<ProductDetail[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(false)

  // ── Medication state ──────────────────────────────────────────────────
  const [selectedMedications, setSelectedMedications] = useState<MedicationProduct[]>([])
  const [pendingMedIds, setPendingMedIds] = useState<string[]>([])

  // ── Shared state ──────────────────────────────────────────────────────
  const [compareOpen, setCompareOpen] = useState(false)
  const initializedRef = useRef(false)

  // ── Derived IDs ───────────────────────────────────────────────────────

  const foodIds = useMemo(() => {
    const productIds = selectedProducts.map((p) => p.id)
    const pending = pendingFoodIds.filter((id) => !productIds.includes(id))
    return [...productIds, ...pending]
  }, [selectedProducts, pendingFoodIds])

  const medIds = useMemo(() => {
    const medProductIds = selectedMedications.map((m) => m.id)
    const pending = pendingMedIds.filter((id) => !medProductIds.includes(id))
    return [...medProductIds, ...pending]
  }, [selectedMedications, pendingMedIds])

  const currentIds = mode === "food" ? foodIds : medIds

  // ── URL restore on mount ──────────────────────────────────────────────

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    const params = new URLSearchParams(window.location.search)

    const modeParam = params.get("mode")
    if (modeParam === "meds") setMode("meds")

    const idsParam = params.get("ids")
    if (idsParam) {
      const ids = idsParam.split(",").filter(Boolean).slice(0, MAX_COMPARE)
      if (ids.length > 0) {
        if (modeParam === "meds") {
          setPendingMedIds(ids)
        } else {
          setPendingFoodIds(ids)
        }
      }
    }
  }, [])

  // ── URL sync ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!initializedRef.current) return
    const url = new URL(window.location.href)
    if (mode === "meds") {
      url.searchParams.set("mode", "meds")
    } else {
      url.searchParams.delete("mode")
    }
    if (currentIds.length > 0) {
      url.searchParams.set("ids", currentIds.join(","))
    } else {
      url.searchParams.delete("ids")
    }
    window.history.replaceState(null, "", url.toString())
  }, [mode, currentIds])

  // ── Food actions ──────────────────────────────────────────────────────

  const toggleProduct = useCallback((product: ProductSummary) => {
    setSelectedProducts((prev) => {
      if (prev.some((p) => p.id === product.id)) return prev.filter((p) => p.id !== product.id)
      if (prev.length >= MAX_COMPARE) return prev
      return [...prev, product]
    })
    setPendingFoodIds((prev) => prev.filter((id) => id !== product.id))
  }, [])

  const removeProduct = useCallback((id: string) => {
    setSelectedProducts((prev) => prev.filter((p) => p.id !== id))
    setPendingFoodIds((prev) => prev.filter((pid) => pid !== id))
  }, [])

  // ── Medication actions ────────────────────────────────────────────────

  const toggleMedication = useCallback((med: MedicationProduct) => {
    setSelectedMedications((prev) => {
      if (prev.some((m) => m.id === med.id)) return prev.filter((m) => m.id !== med.id)
      if (prev.length >= MAX_COMPARE) return prev
      return [...prev, med]
    })
    setPendingMedIds((prev) => prev.filter((id) => id !== med.id))
  }, [])

  const removeMedication = useCallback((id: string) => {
    setSelectedMedications((prev) => prev.filter((m) => m.id !== id))
    setPendingMedIds((prev) => prev.filter((mid) => mid !== id))
  }, [])

  // ── Shared actions ────────────────────────────────────────────────────

  const handleRemove = useCallback((id: string) => {
    if (mode === "food") {
      removeProduct(id)
      setDetailProducts((prev) => {
        const next = prev.filter((p) => p.id !== id)
        if (next.length < 2) setCompareOpen(false)
        return next
      })
    } else {
      removeMedication(id)
      setSelectedMedications((prev) => {
        const next = prev.filter((m) => m.id !== id)
        if (next.length < 2) setCompareOpen(false)
        return next
      })
    }
  }, [mode, removeProduct, removeMedication])

  const openCompare = useCallback(async () => {
    if (currentIds.length < 2) return
    setCompareOpen(true)

    if (mode === "meds") {
      // No fetch needed — medication catalog already has all data
      return
    }

    // Food mode: fetch full product details
    setDetailLoading(true)
    setDetailError(false)
    try {
      const res = await fetch("/api/products/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: currentIds }),
      })
      if (!res.ok) throw new Error("Failed to fetch product details")
      const data = await res.json() as { items: ProductDetail[] }
      setDetailProducts(data.items)
    } catch {
      setDetailProducts([])
      setDetailError(true)
    } finally {
      setDetailLoading(false)
    }
  }, [currentIds, mode])

  // ── Mode switch handler ───────────────────────────────────────────────

  function handleModeChange(newMode: CompareMode): void {
    if (newMode === mode) return
    setCompareOpen(false)
    setMode(newMode)
  }

  return (
    <>
      {/* Header + mode toggle */}
      <div className="mb-4 flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold text-foreground">
          {mode === "food" ? "Compare Food" : "Compare Medications"}
        </h1>
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
          <button
            type="button"
            onClick={() => handleModeChange("food")}
            className={cn(
              "px-3.5 py-1.5 text-xs font-medium transition-colors",
              mode === "food"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-item-hover",
            )}
          >
            Food
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("meds")}
            className={cn(
              "px-3.5 py-1.5 text-xs font-medium transition-colors",
              mode === "meds"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-item-hover",
            )}
          >
            Medications
          </button>
        </div>
      </div>

      {/* Mode-specific catalog */}
      <div className={currentIds.length > 0 ? "pb-40 md:pb-24" : undefined}>
        {mode === "food" ? (
          <ProductCatalogGrid
            selectedIds={foodIds}
            onToggle={toggleProduct}
            onProductsLoaded={(products) => {
              if (pendingFoodIds.length > 0) {
                const matched = pendingFoodIds
                  .map((id) => products.find((p) => p.id === id))
                  .filter((p): p is ProductSummary => !!p)
                if (matched.length > 0) {
                  setSelectedProducts((prev) => {
                    const existingIds = new Set(prev.map((p) => p.id))
                    const newProducts = matched.filter((p) => !existingIds.has(p.id))
                    return [...prev, ...newProducts]
                  })
                }
                setPendingFoodIds([])
              }
            }}
            maxCompare={MAX_COMPARE}
          />
        ) : (
          <MedicationCatalogTable
            selectedIds={medIds}
            onToggle={toggleMedication}
            onMedicationsLoaded={(meds) => {
              if (pendingMedIds.length > 0) {
                const matched = pendingMedIds
                  .map((id) => meds.find((m) => m.id === id))
                  .filter((m): m is MedicationProduct => !!m)
                if (matched.length > 0) {
                  setSelectedMedications((prev) => {
                    const existingIds = new Set(prev.map((m) => m.id))
                    const newMeds = matched.filter((m) => !existingIds.has(m.id))
                    return [...prev, ...newMeds]
                  })
                }
                setPendingMedIds([])
              }
            }}
            maxCompare={MAX_COMPARE}
          />
        )}
      </div>

      {/* Compare tray */}
      {currentIds.length > 0 && (
        <CompareTray
          mode={mode}
          selectedProducts={selectedProducts}
          selectedMedications={selectedMedications}
          onRemove={mode === "food" ? removeProduct : removeMedication}
          onCompare={openCompare}
        />
      )}

      {/* Compare drawer */}
      <CompareDrawer
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        mode={mode}
        products={detailProducts}
        medications={selectedMedications}
        loading={detailLoading}
        error={detailError}
        onRetry={openCompare}
        onRemove={handleRemove}
      />
    </>
  )
}
