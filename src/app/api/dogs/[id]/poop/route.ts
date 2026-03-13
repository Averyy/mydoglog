import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, poopLogs } from "@/lib/db"
import { and, eq, gte, lte, desc } from "drizzle-orm"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const { searchParams } = request.nextUrl
    const from = searchParams.get("from")
    const to = searchParams.get("to")

    const conditions = [eq(poopLogs.dogId, dogId)]
    if (from) conditions.push(gte(poopLogs.date, from))
    if (to) conditions.push(lte(poopLogs.date, to))

    const logs = await db
      .select()
      .from(poopLogs)
      .where(and(...conditions))
      .orderBy(desc(poopLogs.date), desc(poopLogs.createdAt))

    return NextResponse.json(logs)
  } catch (error) {
    console.error("Error fetching poop logs:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}

interface PoopEntry {
  firmnessScore: number
  notes?: string
}

interface PoopPostBody {
  entries: PoopEntry[]
  date: string
  datetime?: string
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const body = (await request.json()) as PoopPostBody

    if (!body.entries?.length || !body.date) {
      return NextResponse.json(
        { error: "entries and date are required" },
        { status: 400 },
      )
    }

    // Validate all firmness scores
    for (const entry of body.entries) {
      if (
        !Number.isInteger(entry.firmnessScore) ||
        entry.firmnessScore < 1 ||
        entry.firmnessScore > 7
      ) {
        return NextResponse.json(
          { error: "firmnessScore must be an integer 1-7" },
          { status: 400 },
        )
      }
    }

    const datetime = body.datetime ? new Date(body.datetime) : null

    const rows = body.entries.map((entry) => ({
      dogId,
      date: body.date,
      datetime,
      firmnessScore: entry.firmnessScore,
      notes: entry.notes?.trim() ?? null,
    }))

    const created = await db.insert(poopLogs).values(rows).returning()

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    console.error("Error creating poop log:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
