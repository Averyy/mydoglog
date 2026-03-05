import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, poopLogs, dogs } from "@/lib/db"
import { eq, and } from "drizzle-orm"

type RouteParams = { params: Promise<{ id: string }> }

async function verifyPoopOwnership(
  poopId: string,
): Promise<{ log: typeof poopLogs.$inferSelect } | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [log] = await db
    .select()
    .from(poopLogs)
    .where(eq(poopLogs.id, poopId))

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

  return { log }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id } = await params
    const ownerResult = await verifyPoopOwnership(id)
    if (ownerResult instanceof NextResponse) return ownerResult

    const body = await request.json()
    const updates: Record<string, unknown> = {}

    if (body.firmnessScore !== undefined) {
      if (body.firmnessScore < 1 || body.firmnessScore > 7) {
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
    const ownerResult = await verifyPoopOwnership(id)
    if (ownerResult instanceof NextResponse) return ownerResult

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
