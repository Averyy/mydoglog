import { NextRequest, NextResponse } from "next/server"
import { requireLogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, medications, dosingIntervalEnum } from "@/lib/db"
import { eq } from "drizzle-orm"

const VALID_INTERVALS = new Set<string>(dosingIntervalEnum.enumValues)

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + "T00:00:00Z")
  return d.toISOString().slice(0, 10) === s
}

type RouteParams = { params: Promise<{ id: string }> }

interface MedicationPatchBody {
  name?: string
  dosage?: string | null
  endDate?: string | null
  medicationProductId?: string | null
  interval?: string | null
  notes?: string | null
  suppressesItch?: boolean
  hasGiSideEffects?: boolean
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: medicationId } = await params
    const ownership = await requireLogOwnership(medications, medicationId)
    if (isNextResponse(ownership)) return ownership

    const body = (await request.json()) as MedicationPatchBody

    if (body.endDate && !isValidDate(body.endDate)) {
      return NextResponse.json({ error: "Invalid date format (expected YYYY-MM-DD)" }, { status: 400 })
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (body.name !== undefined) {
      if (!body.name?.trim()) {
        return NextResponse.json({ error: "name cannot be empty" }, { status: 400 })
      }
      updates.name = body.name.trim()
    }
    if (body.dosage !== undefined) updates.dosage = body.dosage?.trim() || null
    if (body.endDate !== undefined) updates.endDate = body.endDate
    if (body.notes !== undefined) updates.notes = body.notes?.trim() || null
    if (body.medicationProductId !== undefined) {
      updates.medicationProductId = body.medicationProductId
      // Switching to catalog med → clear stale custom flags
      if (body.medicationProductId != null) {
        updates.suppressesItch = null
        updates.hasGiSideEffects = null
      }
    }
    if (body.interval !== undefined) updates.interval = body.interval && VALID_INTERVALS.has(body.interval) ? body.interval : null
    // Only accept custom flags for non-catalog medications
    if (body.suppressesItch !== undefined && !body.medicationProductId) updates.suppressesItch = body.suppressesItch ?? null
    if (body.hasGiSideEffects !== undefined && !body.medicationProductId) updates.hasGiSideEffects = body.hasGiSideEffects ?? null

    const [updated] = await db
      .update(medications)
      .set(updates)
      .where(eq(medications.id, medicationId))
      .returning()

    return NextResponse.json(updated)
  } catch (error) {
    console.error("Error updating medication:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}

/**
 * DELETE — hard delete: permanently removes the medication record.
 * Stopping a medication (soft-delete via endDate) is handled by PATCH.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: medicationId } = await params
    const ownership = await requireLogOwnership(medications, medicationId)
    if (isNextResponse(ownership)) return ownership

    await db
      .delete(medications)
      .where(eq(medications.id, medicationId))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting medication:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
