import { NextRequest, NextResponse } from "next/server"
import { requireLogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, itchinessLogs } from "@/lib/db"
import { eq } from "drizzle-orm"

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id } = await params
    const ownerResult = await requireLogOwnership(itchinessLogs, id)
    if (isNextResponse(ownerResult)) return ownerResult

    const body = await request.json()
    const updates: Record<string, unknown> = {}

    if (body.score !== undefined) {
      if (!Number.isInteger(body.score) || body.score < 0 || body.score > 5) {
        return NextResponse.json(
          { error: "score must be 0-5" },
          { status: 400 },
        )
      }
      updates.score = body.score
    }
    if (body.bodyAreas !== undefined) updates.bodyAreas = body.bodyAreas
    if (body.notes !== undefined) updates.notes = body.notes?.trim() || null
    if (body.date !== undefined) updates.date = body.date
    if (body.datetime !== undefined) {
      updates.datetime = body.datetime ? new Date(body.datetime) : null
    }

    const [updated] = await db
      .update(itchinessLogs)
      .set(updates)
      .where(eq(itchinessLogs.id, id))
      .returning()

    return NextResponse.json(updated)
  } catch (error) {
    console.error("Error updating itchiness log:", error)
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
    const ownerResult = await requireLogOwnership(itchinessLogs, id)
    if (isNextResponse(ownerResult)) return ownerResult

    await db.delete(itchinessLogs).where(eq(itchinessLogs.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting itchiness log:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
