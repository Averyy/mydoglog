import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, feedingPeriods } from "@/lib/db"
import { eq, and, asc } from "drizzle-orm"
import { fetchCorrelationInput, fetchIngredientProductMap, buildGiIngredientProductMap } from "@/lib/correlation/query"
import { runCorrelation } from "@/lib/correlation/engine"
import { DEFAULT_CORRELATION_OPTIONS } from "@/lib/correlation/types"
import type { IngredientProductEntry } from "@/lib/correlation/types"
import { getToday } from "@/lib/utils"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const today = getToday()

    // Window = earliest NON-BACKFILL feeding period → today.
    // Backfill dates outside this window are included by buildBackfillSnapshots.
    // Using ALL periods would make the window cover backfill dates, causing them
    // to be skipped (engine line 830: dates inside window are excluded from backfill).
    const earliestRow = await db
      .select({ startDate: feedingPeriods.startDate })
      .from(feedingPeriods)
      .where(and(
        eq(feedingPeriods.dogId, dogId),
        eq(feedingPeriods.isBackfill, false),
      ))
      .orderBy(asc(feedingPeriods.startDate))
      .limit(1)

    const windowStart = earliestRow[0]?.startDate ?? today
    const windowEnd = today

    const input = await fetchCorrelationInput(dogId, windowStart, windowEnd)
    const [result, ingredientProductMap] = await Promise.all([
      Promise.resolve(runCorrelation(input, DEFAULT_CORRELATION_OPTIONS)),
      fetchIngredientProductMap(input),
    ])

    // Convert Map to plain object for JSON serialization
    const ingredientProducts: Record<string, IngredientProductEntry[]> = {}
    for (const [key, entries] of ingredientProductMap) {
      ingredientProducts[key] = entries
    }

    const giIngredientProducts = buildGiIngredientProductMap(ingredientProductMap)

    return NextResponse.json({
      ...result,
      ingredientProducts,
      giIngredientProducts,
    })
  } catch (error) {
    console.error("Error fetching correlation data:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
