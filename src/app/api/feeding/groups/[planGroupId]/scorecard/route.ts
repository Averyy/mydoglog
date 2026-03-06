import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, feedingPeriods, dogs, foodScorecards } from "@/lib/db"
import { eq, and } from "drizzle-orm"

type RouteParams = { params: Promise<{ planGroupId: string }> }

const VALID_VOMITING = ["none", "occasional", "frequent"] as const
const VALID_PALATABILITY = ["loved", "ate", "reluctant", "refused"] as const
const VALID_ITCHINESS_IMPACT = ["better", "no_change", "worse"] as const
const VALID_VERDICT = ["up", "mixed", "down"] as const
const VALID_PRIMARY_REASON = [
  "bad_poop",
  "vomiting",
  "gas",
  "itchiness",
  "refused_to_eat",
  "too_expensive",
  "other",
] as const

async function verifyPlanOwnership(
  planGroupId: string,
): Promise<{ userId: string } | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [period] = await db
    .select({ dogId: feedingPeriods.dogId })
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

  return { userId: session.user.id }
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
  vomiting?: string | null
  palatability?: string | null
  digestiveImpact?: string | null
  itchinessImpact?: string | null
  verdict?: string | null
  primaryReason?: string | null
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
    if (
      body.vomiting &&
      !VALID_VOMITING.includes(body.vomiting as typeof VALID_VOMITING[number])
    ) {
      return NextResponse.json(
        { error: "Invalid vomiting value" },
        { status: 400 },
      )
    }
    if (
      body.palatability &&
      !VALID_PALATABILITY.includes(
        body.palatability as typeof VALID_PALATABILITY[number],
      )
    ) {
      return NextResponse.json(
        { error: "Invalid palatability value" },
        { status: 400 },
      )
    }
    if (
      body.digestiveImpact &&
      !VALID_ITCHINESS_IMPACT.includes(
        body.digestiveImpact as typeof VALID_ITCHINESS_IMPACT[number],
      )
    ) {
      return NextResponse.json(
        { error: "Invalid digestiveImpact value" },
        { status: 400 },
      )
    }
    if (
      body.itchinessImpact &&
      !VALID_ITCHINESS_IMPACT.includes(
        body.itchinessImpact as typeof VALID_ITCHINESS_IMPACT[number],
      )
    ) {
      return NextResponse.json(
        { error: "Invalid itchinessImpact value" },
        { status: 400 },
      )
    }
    if (
      body.verdict &&
      !VALID_VERDICT.includes(body.verdict as typeof VALID_VERDICT[number])
    ) {
      return NextResponse.json(
        { error: "Invalid verdict value" },
        { status: 400 },
      )
    }
    if (
      body.primaryReason &&
      !VALID_PRIMARY_REASON.includes(
        body.primaryReason as typeof VALID_PRIMARY_REASON[number],
      )
    ) {
      return NextResponse.json(
        { error: "Invalid primaryReason value" },
        { status: 400 },
      )
    }

    const data = {
      planGroupId,
      poopQuality,
      itchSeverity,
      vomiting: body.vomiting as typeof VALID_VOMITING[number] | null ?? null,
      palatability:
        body.palatability as typeof VALID_PALATABILITY[number] | null ?? null,
      digestiveImpact:
        body.digestiveImpact as typeof VALID_ITCHINESS_IMPACT[number] | null ??
        null,
      itchinessImpact:
        body.itchinessImpact as typeof VALID_ITCHINESS_IMPACT[number] | null ??
        null,
      verdict: body.verdict as typeof VALID_VERDICT[number] | null ?? null,
      primaryReason:
        body.primaryReason as typeof VALID_PRIMARY_REASON[number] | null ?? null,
      notes: body.notes ?? null,
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
