import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, itchinessLogs, dogs } from "@/lib/db"
import { eq, and } from "drizzle-orm"

type RouteParams = { params: Promise<{ id: string }> }

async function verifyItchinessOwnership(
  logId: string,
): Promise<{ log: typeof itchinessLogs.$inferSelect } | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [log] = await db
    .select()
    .from(itchinessLogs)
    .where(eq(itchinessLogs.id, logId))

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
    const ownerResult = await verifyItchinessOwnership(id)
    if (ownerResult instanceof NextResponse) return ownerResult

    const body = await request.json()
    const updates: Record<string, unknown> = {}

    if (body.score !== undefined) {
      if (body.score < 1 || body.score > 5) {
        return NextResponse.json(
          { error: "score must be 1-5" },
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
    const ownerResult = await verifyItchinessOwnership(id)
    if (ownerResult instanceof NextResponse) return ownerResult

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
