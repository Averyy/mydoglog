import { NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, poopLogs, itchinessLogs, treatLogs } from "@/lib/db"
import { eq, and, sql } from "drizzle-orm"
import { getToday } from "@/lib/utils"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(
  _request: Request,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const today = getToday()

    const [poopCount, itchCount, treatCount] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(poopLogs)
        .where(and(eq(poopLogs.dogId, dogId), eq(poopLogs.date, today)))
        .then((r) => r[0]?.count ?? 0),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(itchinessLogs)
        .where(and(eq(itchinessLogs.dogId, dogId), eq(itchinessLogs.date, today)))
        .then((r) => r[0]?.count ?? 0),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(treatLogs)
        .where(and(eq(treatLogs.dogId, dogId), eq(treatLogs.date, today)))
        .then((r) => r[0]?.count ?? 0),
    ])

    return NextResponse.json({ poop: poopCount, itch: itchCount, treat: treatCount })
  } catch (error) {
    console.error("Error fetching today counts:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
