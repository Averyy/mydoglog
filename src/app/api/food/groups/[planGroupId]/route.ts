import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, feedingPeriods, dogs } from "@/lib/db"
import { eq, and, sql } from "drizzle-orm"

type RouteParams = { params: Promise<{ planGroupId: string }> }

/**
 * Verify that the authenticated user owns the dog associated with
 * the given planGroupId. Returns the userId or an error NextResponse.
 */
async function verifyPlanOwnership(
  planGroupId: string,
): Promise<{ userId: string } | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Find any feeding period for this planGroupId, then check dog ownership
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

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { planGroupId } = await params
    const ownerResult = await verifyPlanOwnership(planGroupId)
    if (ownerResult instanceof NextResponse) return ownerResult

    const body = await request.json()

    // Per-item quantity updates (from routine editor quantity-only saves)
    if (Array.isArray(body.items)) {
      const VALID_UNITS = new Set(["can", "cup", "g", "scoop", "piece", "tbsp", "tsp", "ml", "treat"])
      type QuantityUnit = "can" | "cup" | "g" | "scoop" | "piece" | "tbsp" | "tsp" | "ml" | "treat"
      const items: { id: string; quantity: string; quantityUnit: QuantityUnit }[] = []
      for (const raw of body.items) {
        if (typeof raw !== "object" || raw === null) continue
        const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : null
        const quantity = typeof raw.quantity === "string" && /^\d+(\.\d+)?$/.test(raw.quantity) ? raw.quantity : null
        const quantityUnit = typeof raw.quantityUnit === "string" && VALID_UNITS.has(raw.quantityUnit) ? raw.quantityUnit : null
        if (!id || !quantity || !quantityUnit) {
          return NextResponse.json({ error: "Invalid item data" }, { status: 400 })
        }
        items.push({ id, quantity, quantityUnit: quantityUnit as QuantityUnit })
      }
      if (items.length === 0) {
        return NextResponse.json({ error: "No valid items" }, { status: 400 })
      }
      await Promise.all(
        items.map((item) =>
          db
            .update(feedingPeriods)
            .set({ quantity: item.quantity, quantityUnit: item.quantityUnit, updatedAt: new Date() })
            .where(and(eq(feedingPeriods.id, item.id), eq(feedingPeriods.planGroupId, planGroupId))),
        ),
      )
      return NextResponse.json({ success: true })
    }

    // Uniform update across all periods in the group (backfill editing)
    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (body.planName !== undefined) updates.planName = body.planName
    if (body.startDate !== undefined) updates.startDate = body.startDate
    if (body.endDate !== undefined) updates.endDate = body.endDate
    if (body.productId !== undefined) updates.productId = body.productId
    if (body.quantity !== undefined) updates.quantity = body.quantity
    if (body.quantityUnit !== undefined) updates.quantityUnit = body.quantityUnit

    await db
      .update(feedingPeriods)
      .set(updates)
      .where(eq(feedingPeriods.planGroupId, planGroupId))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error updating feeding plan:", error)
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
    const { planGroupId } = await params
    const ownerResult = await verifyPlanOwnership(planGroupId)
    if (ownerResult instanceof NextResponse) return ownerResult

    await db
      .delete(feedingPeriods)
      .where(eq(feedingPeriods.planGroupId, planGroupId))

    // Also delete associated scorecard
    await db.execute(
      sql`DELETE FROM food_scorecards WHERE plan_group_id = ${planGroupId}`,
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting feeding plan:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
