import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, feedingPeriods, dogs, foodScorecards } from "@/lib/db"
import { eq, and } from "drizzle-orm"

type RouteParams = { params: Promise<{ planGroupId: string }> }

async function verifyPlanOwnership(
  planGroupId: string,
): Promise<{ userId: string; isBackfill: boolean } | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [period] = await db
    .select({ dogId: feedingPeriods.dogId, isBackfill: feedingPeriods.isBackfill })
    .from(feedingPeriods)
    .where(eq(feedingPeriods.planGroupId, planGroupId))
    .limit(1)

  if (!period) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const [dog] = await db
    .select({ id: dogs.id })
    .from(dogs)
    .where(and(eq(dogs.id, period.dogId), eq(dogs.ownerId, session.user.id)))

  if (!dog) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return { userId: session.user.id, isBackfill: period.isBackfill }
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { planGroupId } = await params
    const ownerResult = await verifyPlanOwnership(planGroupId)
    if (ownerResult instanceof NextResponse) return ownerResult

    const [scorecard] = await db
      .select()
      .from(foodScorecards)
      .where(eq(foodScorecards.planGroupId, planGroupId))

    return NextResponse.json(scorecard ?? null)
  } catch (error) {
    console.error("Error fetching scorecard:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}

interface ScorecardBody {
  poopQuality?: number | number[] | null
  itchSeverity?: number | number[] | null
  notes?: string | null
}

export async function PUT(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { planGroupId } = await params
    const ownerResult = await verifyPlanOwnership(planGroupId)
    if (ownerResult instanceof NextResponse) return ownerResult

    if (!ownerResult.isBackfill) {
      return NextResponse.json(
        { error: "Scorecards can only be saved for backfill periods" },
        { status: 400 },
      )
    }

    const body = (await request.json()) as ScorecardBody

    // Normalize poopQuality: accept bare number or array
    const rawPoop = body.poopQuality
    let poopQuality: number[] | null = null
    if (rawPoop != null) {
      const arr = Array.isArray(rawPoop) ? rawPoop : [rawPoop]
      if (arr.some((v) => !Number.isInteger(v) || v < 1 || v > 7)) {
        return NextResponse.json(
          { error: "poopQuality values must be integers 1-7" },
          { status: 400 },
        )
      }
      poopQuality = arr.sort((a, b) => a - b)
    }

    // Normalize itchSeverity: accept bare number or array
    const rawItch = body.itchSeverity
    let itchSeverity: number[] | null = null
    if (rawItch != null) {
      const arr = Array.isArray(rawItch) ? rawItch : [rawItch]
      if (arr.some((v) => !Number.isInteger(v) || v < 0 || v > 5)) {
        return NextResponse.json(
          { error: "itchSeverity values must be integers 0-5" },
          { status: 400 },
        )
      }
      itchSeverity = arr.sort((a, b) => a - b)
    }

    const notes = body.notes ?? null
    if (notes && notes.length > 2000) {
      return NextResponse.json(
        { error: "Notes must be 2000 characters or fewer" },
        { status: 400 },
      )
    }

    const data = {
      planGroupId,
      poopQuality,
      itchSeverity,
      notes,
    }

    // Upsert: delete existing, then insert
    const [existing] = await db
      .select({ id: foodScorecards.id })
      .from(foodScorecards)
      .where(eq(foodScorecards.planGroupId, planGroupId))

    let result
    if (existing) {
      ;[result] = await db
        .update(foodScorecards)
        .set(data)
        .where(eq(foodScorecards.id, existing.id))
        .returning()
    } else {
      ;[result] = await db.insert(foodScorecards).values(data).returning()
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("Error saving scorecard:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
