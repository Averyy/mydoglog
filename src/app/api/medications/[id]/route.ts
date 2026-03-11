import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, medications, dogs, dosingIntervalEnum } from "@/lib/db"
import { eq, and } from "drizzle-orm"

const VALID_INTERVALS = new Set<string>(dosingIntervalEnum.enumValues)

type RouteParams = { params: Promise<{ id: string }> }

/**
 * Verify that the current user owns the medication (medication -> dog -> owner).
 */
async function verifyMedicationOwnership(
  medicationId: string,
): Promise<{ error: NextResponse } | { medication: typeof medications.$inferSelect }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const [med] = await db
    .select()
    .from(medications)
    .where(eq(medications.id, medicationId))

  if (!med) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  }

  const [dog] = await db
    .select()
    .from(dogs)
    .where(and(eq(dogs.id, med.dogId), eq(dogs.ownerId, session.user.id)))

  if (!dog) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  }

  return { medication: med }
}

interface MedicationPatchBody {
  name?: string
  dosage?: string | null
  endDate?: string | null
  medicationProductId?: string | null
  interval?: string | null
  notes?: string | null
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: medicationId } = await params
    const ownership = await verifyMedicationOwnership(medicationId)
    if ("error" in ownership) return ownership.error

    const body = (await request.json()) as MedicationPatchBody

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
    if (body.medicationProductId !== undefined) updates.medicationProductId = body.medicationProductId
    if (body.interval !== undefined) updates.interval = body.interval && VALID_INTERVALS.has(body.interval) ? body.interval : null

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
    const ownership = await verifyMedicationOwnership(medicationId)
    if ("error" in ownership) return ownership.error

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
