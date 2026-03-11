import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, treatLogs, dogs } from "@/lib/db"
import { eq, and } from "drizzle-orm"

type RouteParams = { params: Promise<{ id: string }> }

async function verifyTreatOwnership(
  treatId: string,
): Promise<{ treatLog: typeof treatLogs.$inferSelect } | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [log] = await db
    .select()
    .from(treatLogs)
    .where(eq(treatLogs.id, treatId))

  if (!log) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const [dog] = await db
    .select({ id: dogs.id })
    .from(dogs)
    .where(and(eq(dogs.id, log.dogId), eq(dogs.ownerId, session.user.id)))

  if (!dog) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return { treatLog: log }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id } = await params
    const ownerResult = await verifyTreatOwnership(id)
    if (ownerResult instanceof NextResponse) return ownerResult

    const body = await request.json()
    const updates: Record<string, unknown> = {}

    if (body.productId !== undefined) updates.productId = body.productId
    if (body.quantity !== undefined) updates.quantity = body.quantity
    if (body.quantityUnit !== undefined) updates.quantityUnit = body.quantityUnit
    if (body.notes !== undefined) updates.notes = body.notes?.trim() || null
    if (body.date !== undefined) updates.date = body.date
    if (body.datetime !== undefined) {
      updates.datetime = body.datetime ? new Date(body.datetime) : null
    }

    const [updated] = await db
      .update(treatLogs)
      .set(updates)
      .where(eq(treatLogs.id, id))
      .returning()

    return NextResponse.json(updated)
  } catch (error) {
    console.error("Error updating treat log:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id } = await params
    const ownerResult = await verifyTreatOwnership(id)
    if (ownerResult instanceof NextResponse) return ownerResult

    await db.delete(treatLogs).where(eq(treatLogs.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting treat log:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
