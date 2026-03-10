import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, feedingPeriods, foodScorecards } from "@/lib/db"
import { durationFromRange } from "@/lib/feeding"

type RouteParams = { params: Promise<{ id: string }> }

interface BackfillItem {
  productId: string
  quantity: string
  quantityUnit: string
}

interface ScorecardInput {
  poopQuality?: number | number[] | null
  itchSeverity?: number | number[] | null
  notes?: string | null
}

interface BackfillBody {
  items: BackfillItem[]
  startDate: string
  endDate: string
  approximateDuration?: string
  planName?: string
  scorecard: ScorecardInput
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime())
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const body = (await request.json()) as BackfillBody

    if (!body.items?.length || !body.startDate || !body.endDate) {
      return NextResponse.json(
        { error: "items, startDate, and endDate are required" },
        { status: 400 },
      )
    }

    for (const item of body.items) {
      if (!item.quantity || !item.quantityUnit) {
        return NextResponse.json(
          { error: "quantity and quantityUnit are required for each item" },
          { status: 400 },
        )
      }
    }

    if (!isValidDate(body.startDate) || !isValidDate(body.endDate)) {
      return NextResponse.json(
        { error: "Invalid date format (expected YYYY-MM-DD)" },
        { status: 400 },
      )
    }

    if (body.endDate < body.startDate) {
      return NextResponse.json(
        { error: "endDate must be >= startDate" },
        { status: 400 },
      )
    }

    if (!body.scorecard?.poopQuality || !body.scorecard?.itchSeverity) {
      return NextResponse.json(
        { error: "scorecard with poopQuality and itchSeverity is required for backfills" },
        { status: 400 },
      )
    }

    const poopArr = Array.isArray(body.scorecard.poopQuality)
      ? body.scorecard.poopQuality
      : [body.scorecard.poopQuality]
    const itchArr = Array.isArray(body.scorecard.itchSeverity)
      ? body.scorecard.itchSeverity
      : [body.scorecard.itchSeverity]

    if (poopArr.length === 0 || itchArr.length === 0) {
      return NextResponse.json(
        { error: "scorecard poopQuality and itchSeverity must be non-empty arrays" },
        { status: 400 },
      )
    }

    if (poopArr.some((v) => v < 1 || v > 7)) {
      return NextResponse.json(
        { error: "poopQuality scores must be between 1 and 7" },
        { status: 400 },
      )
    }

    if (itchArr.some((v) => v < 0 || v > 5)) {
      return NextResponse.json(
        { error: "itchSeverity scores must be between 0 and 5" },
        { status: 400 },
      )
    }

    const notes = body.scorecard.notes ?? null
    if (notes && notes.length > 2000) {
      return NextResponse.json(
        { error: "Notes must be 2000 characters or fewer" },
        { status: 400 },
      )
    }

    const startDate = body.startDate
    const endDate = body.endDate
    const approximateDuration = body.approximateDuration ?? durationFromRange(startDate, endDate)

    const planGroupId = crypto.randomUUID()

    const rows = body.items.map((item) => ({
      dogId,
      productId: item.productId,
      startDate,
      endDate,
      planGroupId,
      planName: body.planName ?? null,
      isBackfill: true,
      approximateDuration,
      quantity: item.quantity,
      quantityUnit: item.quantityUnit as
        | "can"
        | "cup"
        | "g"
        | "scoop"
        | "piece"
        | "tbsp"
        | "tsp"
        | "ml"
        | "treat",
    }))

    const created = await db.insert(feedingPeriods).values(rows).returning()

    // Create scorecard (required for backfills)
    await db.insert(foodScorecards).values({
      planGroupId,
      poopQuality: poopArr.sort((a, b) => a - b),
      itchSeverity: itchArr.sort((a, b) => a - b),
      notes,
    })

    return NextResponse.json(
      { planGroupId, items: created },
      { status: 201 },
    )
  } catch (error) {
    console.error("Error creating backfill:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
