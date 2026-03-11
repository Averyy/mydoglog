"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import { useActiveDog } from "@/components/active-dog-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MedicationCard } from "@/components/medication-card"
import { MedicationForm } from "@/components/medication-form"
import { LiaPlusSolid } from "react-icons/lia"
import type { MedicationSummary } from "@/lib/types"

export default function MedsPage(): React.ReactElement {
  const params = useParams<{ id: string }>()
  const dogId = params.id
  const { setActiveDogId } = useActiveDog()

  useEffect(() => { setActiveDogId(dogId) }, [dogId, setActiveDogId])

  const [medications, setMedications] = useState<MedicationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editingMed, setEditingMed] = useState<MedicationSummary | null>(null)

  const fetchMeds = useCallback(async () => {
    try {
      const res = await fetch(`/api/dogs/${dogId}/medications`)
      if (res.ok) {
        const data: MedicationSummary[] = await res.json()
        setMedications(data)
      }
    } catch {
      // Non-critical
    } finally {
      setLoading(false)
    }
  }, [dogId])

  useEffect(() => { fetchMeds() }, [fetchMeds])

  const activeMeds = medications.filter((m) => !m.endDate)
  const pastMeds = medications
    .filter((m) => m.endDate)
    .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))

  function handleAdd(): void {
    setEditingMed(null)
    setFormOpen(true)
  }

  function handleEdit(med: MedicationSummary): void {
    setEditingMed(med)
    setFormOpen(true)
  }

  function handleSaved(): void {
    setFormOpen(false)
    setEditingMed(null)
    fetchMeds()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        {loading ? (
          <>
            <div className="h-8 w-36 animate-pulse rounded bg-muted" />
            <div className="flex-1" />
            <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
          </>
        ) : (
          <>
            <h1 className="flex-1 text-2xl font-bold text-foreground">Medications</h1>
            <Button size="sm" onClick={handleAdd}>
              <LiaPlusSolid className="size-4" />
              Add medication
            </Button>
          </>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card">
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="mt-0.5 size-9 shrink-0 animate-pulse rounded-md bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-36 animate-pulse rounded bg-muted" />
                  <div className="h-2.5 w-44 animate-pulse rounded bg-muted" />
                </div>
                <div className="mt-0.5 flex shrink-0 items-center gap-3">
                  <div className="h-5 w-12 animate-pulse rounded-full bg-muted" />
                  <div className="h-8 w-12 animate-pulse rounded-md bg-muted" />
                </div>
              </div>
              <div className="border-t border-border px-4 py-2.5 space-y-1.5">
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-2.5 w-32 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Active medications */}
      {!loading && activeMeds.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Active
          </h2>
          {activeMeds.map((med) => (
            <MedicationCard key={med.id} medication={med} onEdit={() => handleEdit(med)} />
          ))}
        </div>
      )}

      {/* Past medications */}
      {!loading && pastMeds.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Past
          </h2>
          {pastMeds.map((med) => (
            <MedicationCard key={med.id} medication={med} onEdit={() => handleEdit(med)} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && medications.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">No medications logged yet</p>
            <Button onClick={handleAdd} size="sm">
              <LiaPlusSolid className="size-4" />
              Add medication
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Medication form */}
      <MedicationForm
        open={formOpen}
        onOpenChange={setFormOpen}
        dogId={dogId}
        medication={editingMed}
        onSaved={handleSaved}
      />
    </div>
  )
}
