import { NextRequest, NextResponse } from "next/server"
import { requireLogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, poopLogs } from "@/lib/db"
import { eq } from "drizzle-orm"

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id } = await params
    const ownerResult = await requireLogOwnership(poopLogs, id)
    if (isNextResponse(ownerResult)) return ownerResult

    const body = await request.json()
    const updates: Record<string, unknown> = {}

    if (body.firmnessScore !== undefined) {
      if (!Number.isInteger(body.firmnessScore) || body.firmnessScore < 1 || body.firmnessScore > 7) {
        return NextResponse.json(
          { error: "firmnessScore must be 1-7" },
          { status: 400 },
        )
      }
      updates.firmnessScore = body.firmnessScore
    }
    if (body.color !== undefined) updates.color = body.color
    if (body.urgency !== undefined) updates.urgency = body.urgency
    if (body.notes !== undefined) updates.notes = body.notes?.trim() || null
    if (body.photoUrl !== undefined) updates.photoUrl = body.photoUrl
    if (body.date !== undefined) updates.date = body.date
    if (body.datetime !== undefined) {
      updates.datetime = body.datetime ? new Date(body.datetime) : null
    }

    const [updated] = await db
      .update(poopLogs)
      .set(updates)
      .where(eq(poopLogs.id, id))
      .returning()

    return NextResponse.json(updated)
  } catch (error) {
    console.error("Error updating poop log:", error)
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
    const ownerResult = await requireLogOwnership(poopLogs, id)
    if (isNextResponse(ownerResult)) return ownerResult

    await db.delete(poopLogs).where(eq(poopLogs.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting poop log:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
