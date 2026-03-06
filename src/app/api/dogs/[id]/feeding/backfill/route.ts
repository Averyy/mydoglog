import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, feedingPeriods, foodScorecards } from "@/lib/db"
import { parseDuration } from "@/lib/feeding"

type RouteParams = { params: Promise<{ id: string }> }

interface BackfillItem {
  productId: string
  quantity?: string
  quantityUnit?: string
}

interface ScorecardInput {
  poopQuality?: number | number[] | null
  gas?: string | null
  vomiting?: string | null
  palatability?: string | null
  itchinessImpact?: string | null
  verdict?: string | null
  primaryReason?: string | null
  notes?: string | null
}

interface BackfillBody {
  items: BackfillItem[]
  approximateDuration: string
  endDate?: string
  planName?: string
  scorecard?: ScorecardInput
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

    if (!body.items?.length || !body.approximateDuration) {
      return NextResponse.json(
        { error: "items and approximateDuration are required" },
        { status: 400 },
      )
    }

    const duration = parseDuration(body.approximateDuration)
    if (!duration) {
      return NextResponse.json(
        { error: "Could not parse duration" },
        { status: 400 },
      )
    }

    // Calculate start date from end date and duration
    // Default to yesterday — backfills are historical and shouldn't overlap today
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const endDate = body.endDate ?? yesterday.toISOString().split("T")[0]
    const endMs = new Date(endDate).getTime()
    const startMs = endMs - duration.days * 24 * 60 * 60 * 1000
    const startDate = new Date(startMs).toISOString().split("T")[0]

    const planGroupId = crypto.randomUUID()

    const rows = body.items.map((item) => ({
      dogId,
      productId: item.productId,
      startDate,
      endDate,
      planGroupId,
      planName: body.planName ?? null,
      isBackfill: true,
      approximateDuration: body.approximateDuration,
      quantity: item.quantity ?? null,
      quantityUnit: item.quantityUnit as
        | "can"
        | "cup"
        | "g"
        | "scoop"
        | "piece"
        | "tbsp"
        | "tsp"
        | "ml"
        | undefined,
    }))

    const created = await db.insert(feedingPeriods).values(rows).returning()

    // Create optional scorecard
    if (body.scorecard) {
      await db.insert(foodScorecards).values({
        planGroupId,
        poopQuality: body.scorecard.poopQuality != null
          ? (Array.isArray(body.scorecard.poopQuality)
            ? body.scorecard.poopQuality
            : [body.scorecard.poopQuality])
          : null,
        gas: body.scorecard.gas as typeof foodScorecards.$inferInsert.gas,
        vomiting:
          body.scorecard.vomiting as typeof foodScorecards.$inferInsert.vomiting,
        palatability:
          body.scorecard
            .palatability as typeof foodScorecards.$inferInsert.palatability,
        itchinessImpact:
          body.scorecard
            .itchinessImpact as typeof foodScorecards.$inferInsert.itchinessImpact,
        verdict:
          body.scorecard.verdict as typeof foodScorecards.$inferInsert.verdict,
        primaryReason:
          body.scorecard
            .primaryReason as typeof foodScorecards.$inferInsert.primaryReason,
        notes: body.scorecard.notes ?? null,
      })
    }

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
