import { NextRequest, NextResponse } from "next/server"
import { requirePlanGroupOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, feedingPeriods } from "@/lib/db"
import { eq, and, sql, isNull } from "drizzle-orm"
import { getToday } from "@/lib/utils"

type RouteParams = { params: Promise<{ planGroupId: string }> }

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { planGroupId } = await params
    const ownerResult = await requirePlanGroupOwnership(planGroupId)
    if (isNextResponse(ownerResult)) return ownerResult

    const body = await request.json()

    // End transition: delete future single-day rows, adjust ongoing row, clear metadata
    if (body.action === "end_transition") {
      const today = getToday()
      await db.transaction(async (tx) => {
        // Delete future single-day transition rows
        await tx.execute(
          sql`DELETE FROM ${feedingPeriods}
              WHERE ${feedingPeriods.planGroupId} = ${planGroupId}
                AND ${feedingPeriods.startDate} = ${feedingPeriods.endDate}
                AND ${feedingPeriods.startDate} >= ${today}`,
        )

        // Adjust ongoing rows: set startDate to today, clear transition metadata
        await tx
          .update(feedingPeriods)
          .set({
            startDate: today,
            transitionDays: null,
            previousPlanGroupId: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(feedingPeriods.planGroupId, planGroupId),
              isNull(feedingPeriods.endDate),
            ),
          )
      })

      return NextResponse.json({ success: true })
    }

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
    const ownerResult = await requirePlanGroupOwnership(planGroupId)
    if (isNextResponse(ownerResult)) return ownerResult

    // Delete feeding periods and associated scorecard atomically
    await db.transaction(async (tx) => {
      await tx
        .delete(feedingPeriods)
        .where(eq(feedingPeriods.planGroupId, planGroupId))
      await tx.execute(
        sql`DELETE FROM food_scorecards WHERE plan_group_id = ${planGroupId}`,
      )
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting feeding plan:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
