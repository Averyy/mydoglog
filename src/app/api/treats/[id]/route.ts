import { NextRequest, NextResponse } from "next/server"
import { requireLogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, treatLogs } from "@/lib/db"
import { eq } from "drizzle-orm"

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id } = await params
    const ownerResult = await requireLogOwnership(treatLogs, id)
    if (isNextResponse(ownerResult)) return ownerResult

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
    const ownerResult = await requireLogOwnership(treatLogs, id)
    if (isNextResponse(ownerResult)) return ownerResult

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
