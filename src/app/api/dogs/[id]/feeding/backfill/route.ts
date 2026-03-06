import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, feedingPeriods, foodScorecards } from "@/lib/db"
import { durationFromRange } from "@/lib/feeding"

type RouteParams = { params: Promise<{ id: string }> }

interface BackfillItem {
  productId: string
  quantity?: string
  quantityUnit?: string
}

interface ScorecardInput {
  poopQuality?: number | number[] | null
  itchSeverity?: number | number[] | null
  vomiting?: string | null
  palatability?: string | null
  digestiveImpact?: string | null
  itchinessImpact?: string | null
  verdict?: string | null
  primaryReason?: string | null
  notes?: string | null
}

interface BackfillBody {
  items: BackfillItem[]
  startDate: string
  endDate: string
  approximateDuration?: string
  planName?: string
  scorecard?: ScorecardInput
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
        itchSeverity: body.scorecard.itchSeverity != null
          ? (Array.isArray(body.scorecard.itchSeverity)
            ? body.scorecard.itchSeverity
            : [body.scorecard.itchSeverity])
          : null,
        vomiting:
          body.scorecard.vomiting as typeof foodScorecards.$inferInsert.vomiting,
        palatability:
          body.scorecard
            .palatability as typeof foodScorecards.$inferInsert.palatability,
        digestiveImpact:
          body.scorecard
            .digestiveImpact as typeof foodScorecards.$inferInsert.digestiveImpact,
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
