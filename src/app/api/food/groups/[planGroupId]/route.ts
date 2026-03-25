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

    // Uniform update across all periods in the group
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    const hasDateChanges = body.startDate !== undefined || body.endDate !== undefined
      || body.startDatetime !== undefined || body.endDatetime !== undefined

    const isValidDate = (v: unknown): boolean =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v))

    if (body.planName !== undefined) updates.planName = body.planName
    if (body.startDate !== undefined) {
      if (!isValidDate(body.startDate)) {
        return NextResponse.json({ error: "Invalid startDate" }, { status: 400 })
      }
      updates.startDate = body.startDate
    }
    if (body.startDatetime !== undefined) {
      if (body.startDatetime && isNaN(new Date(body.startDatetime).getTime())) {
        return NextResponse.json({ error: "Invalid startDatetime" }, { status: 400 })
      }
      updates.startDatetime = body.startDatetime ? new Date(body.startDatetime) : null
    }
    if (body.endDate !== undefined) {
      if (body.endDate !== null && !isValidDate(body.endDate)) {
        return NextResponse.json({ error: "Invalid endDate" }, { status: 400 })
      }
      updates.endDate = body.endDate
    }
    if (body.endDatetime !== undefined) {
      if (body.endDatetime && isNaN(new Date(body.endDatetime).getTime())) {
        return NextResponse.json({ error: "Invalid endDatetime" }, { status: 400 })
      }
      updates.endDatetime = body.endDatetime ? new Date(body.endDatetime) : null
    }
    // Validate date ordering when both are provided
    const effectiveStart = (updates.startDate as string | undefined) ?? body.startDate
    const effectiveEnd = (updates.endDate as string | null | undefined) ?? body.endDate
    if (effectiveStart && effectiveEnd && effectiveEnd < effectiveStart) {
      return NextResponse.json({ error: "endDate must be on or after startDate" }, { status: 400 })
    }

    if (body.productId !== undefined) updates.productId = body.productId
    if (body.quantity !== undefined) updates.quantity = body.quantity
    if (body.quantityUnit !== undefined) updates.quantityUnit = body.quantityUnit

    // When changing dates/datetimes, only update ongoing rows (not single-day
    // transition schedule rows where startDate === endDate) to avoid destroying
    // the transition schedule.
    const whereCondition = hasDateChanges
      ? and(
          eq(feedingPeriods.planGroupId, planGroupId),
          sql`(${feedingPeriods.startDate} != ${feedingPeriods.endDate} OR ${feedingPeriods.endDate} IS NULL)`,
        )
      : eq(feedingPeriods.planGroupId, planGroupId)

    await db
      .update(feedingPeriods)
      .set(updates)
      .where(whereCondition)

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
