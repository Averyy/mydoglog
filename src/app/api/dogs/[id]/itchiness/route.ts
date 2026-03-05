import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, itchinessLogs } from "@/lib/db"
import { eq, desc } from "drizzle-orm"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const logs = await db
      .select()
      .from(itchinessLogs)
      .where(eq(itchinessLogs.dogId, dogId))
      .orderBy(desc(itchinessLogs.date), desc(itchinessLogs.createdAt))

    return NextResponse.json(logs)
  } catch (error) {
    console.error("Error fetching itchiness logs:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}

interface ItchinessPostBody {
  score: number
  bodyAreas?: string[]
  date: string
  datetime?: string
  notes?: string
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const body = (await request.json()) as ItchinessPostBody

    if (!body.date || body.score == null) {
      return NextResponse.json(
        { error: "score and date are required" },
        { status: 400 },
      )
    }

    if (!Number.isInteger(body.score) || body.score < 0 || body.score > 5) {
      return NextResponse.json(
        { error: "score must be an integer 0-5" },
        { status: 400 },
      )
    }

    const [created] = await db
      .insert(itchinessLogs)
      .values({
        dogId,
        date: body.date,
        datetime: body.datetime ? new Date(body.datetime) : null,
        score: body.score,
        bodyAreas: body.bodyAreas ?? null,
        notes: body.notes?.trim() ?? null,
      })
      .returning()

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    console.error("Error creating itchiness log:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
