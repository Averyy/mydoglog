import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, feedingPeriods, products, brands, foodScorecards, poopLogs, itchinessLogs, treatLogs } from "@/lib/db"
import type { MealSlot, QuantityUnit } from "@/lib/db/schema"
import { eq, desc, sql, and, isNull } from "drizzle-orm"
import { buildFeedingGroupMap } from "@/lib/feeding"
import { getToday } from "@/lib/utils"
import { computeTransitionSchedule, type TransitionItem } from "@/lib/transition"
import { shiftDate } from "@/lib/date-utils"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id } = await params
    const authResult = await requireDogOwnership(id)
    if (isNextResponse(authResult)) return authResult

    const rows = await db
      .select({
        id: feedingPeriods.id,
        planGroupId: feedingPeriods.planGroupId,
        planName: feedingPeriods.planName,
        startDate: feedingPeriods.startDate,
        startDatetime: feedingPeriods.startDatetime,
        endDate: feedingPeriods.endDate,
        endDatetime: feedingPeriods.endDatetime,
        isBackfill: feedingPeriods.isBackfill,
        approximateDuration: feedingPeriods.approximateDuration,
        productId: feedingPeriods.productId,
        quantity: feedingPeriods.quantity,
        quantityUnit: feedingPeriods.quantityUnit,
        mealSlot: feedingPeriods.mealSlot,
        createdAt: feedingPeriods.createdAt,
        transitionDays: feedingPeriods.transitionDays,
        previousPlanGroupId: feedingPeriods.previousPlanGroupId,
        productName: products.name,
        brandName: brands.name,
        imageUrl: sql<string | null>`${products.imageUrls}[1]`,
        productType: products.type,
        productFormat: products.format,
      })
      .from(feedingPeriods)
      .innerJoin(products, eq(feedingPeriods.productId, products.id))
      .innerJoin(brands, eq(products.brandId, brands.id))
      .where(eq(feedingPeriods.dogId, id))
      .orderBy(desc(feedingPeriods.startDate), desc(feedingPeriods.createdAt))

    // Group by planGroupId
    const groupMap = buildFeedingGroupMap(rows)

    // Fetch scorecards for all plan groups
    const planGroupIds = [...groupMap.keys()]
    if (planGroupIds.length > 0) {
      const scorecards = await db
        .select()
        .from(foodScorecards)
        .where(
          sql`${foodScorecards.planGroupId} IN (${sql.join(
            planGroupIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )

      for (const sc of scorecards) {
        const group = groupMap.get(sc.planGroupId)
        if (group) {
          group.scorecard = {
            id: sc.id,
            poopQuality: sc.poopQuality,
            itchSeverity: sc.itchSeverity,
            notes: sc.notes,
          }
        }
      }
    }

    return NextResponse.json([...groupMap.values()])
  } catch (error) {
    console.error("Error fetching feeding plans:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}

interface FeedingPostItem {
  productId: string
  quantity: string
  quantityUnit: string
  mealSlot?: string
}

interface FeedingPostBody {
  mode: "today" | "starting_today" | "date_range"
  items: FeedingPostItem[]
  planName?: string
  startDate?: string
  endDate?: string
  transitionDays?: number
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const body = (await request.json()) as FeedingPostBody

    if (!body.mode || !body.items?.length) {
      return NextResponse.json(
        { error: "mode and items are required" },
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

    const today = getToday()
    const planGroupId = crypto.randomUUID()

    let startDate: string
    let endDate: string | null

    switch (body.mode) {
      case "today":
        startDate = today
        endDate = today
        break
      case "starting_today":
        // Accept client-provided startDate to avoid timezone divergence
        startDate = body.startDate ?? today
        endDate = null
        break
      case "date_range":
        if (!body.startDate || !body.endDate) {
          return NextResponse.json(
            { error: "startDate and endDate required for date_range mode" },
            { status: 400 },
          )
        }
        startDate = body.startDate
        endDate = body.endDate
        break
      default:
        return NextResponse.json({ error: "Invalid mode" }, { status: 400 })
    }

    // If starting_today, handle existing ongoing plans
    if (body.mode === "starting_today") {
      const transitionDays = typeof body.transitionDays === "number"
        ? Math.max(0, Math.min(7, Math.round(body.transitionDays)))
        : 0

      // No transition: old plan ends today at this exact time (time-based cutoff).
      // Multi-day transition: old plan ends yesterday (date-based, transition rows cover today onward).
      const now = new Date()
      const oldPlanEndDate = transitionDays > 0 ? shiftDate(today, -1) : today
      const oldPlanEndDatetime = transitionDays > 0 ? null : now
      // New plan starts at the same instant — resolveActivePlan picks the newer
      // plan via createdAt tiebreaker, so no gap where neither plan is active.
      const newPlanStartDatetime = transitionDays > 0 ? null : now

      // Find existing ongoing plan group(s) with product details for transition
      const ongoingPeriods = await db
        .select({
          id: feedingPeriods.id,
          planGroupId: feedingPeriods.planGroupId,
          startDate: feedingPeriods.startDate,
          endDate: feedingPeriods.endDate,
          productId: feedingPeriods.productId,
          quantity: feedingPeriods.quantity,
          quantityUnit: feedingPeriods.quantityUnit,
          mealSlot: feedingPeriods.mealSlot,
          productType: products.type,
        })
        .from(feedingPeriods)
        .innerJoin(products, eq(feedingPeriods.productId, products.id))
        .where(
          and(
            eq(feedingPeriods.dogId, dogId),
            isNull(feedingPeriods.endDate),
            eq(feedingPeriods.isBackfill, false),
          ),
        )

      // Get distinct plan group IDs
      const ongoingGroupIds = [...new Set(ongoingPeriods.map((p) => p.planGroupId))]
      const previousPlanGroupId = ongoingGroupIds[0] ?? null

      // Build old items for transition computation
      const oldItems: TransitionItem[] = ongoingPeriods.map((p) => ({
        productId: p.productId,
        quantity: p.quantity,
        quantityUnit: p.quantityUnit ?? "cup",
        mealSlot: p.mealSlot ?? undefined,
        type: p.productType,
      }))

      // Build new items for transition computation
      const newItemsForTransition: TransitionItem[] = body.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        quantityUnit: item.quantityUnit,
        mealSlot: item.mealSlot,
      }))

      // Compute transition schedule if needed
      let transitionSchedule: ReturnType<typeof computeTransitionSchedule> = []
      if (transitionDays > 0 && oldItems.length > 0) {
        // Fetch product types for new items to determine main food vs supplement
        const newProductIds = body.items.map((i) => i.productId)
        const newProductRows = newProductIds.length > 0
          ? await db
              .select({ id: products.id, type: products.type })
              .from(products)
              .where(sql`${products.id} IN (${sql.join(newProductIds.map((id) => sql`${id}`), sql`, `)})`)
          : []
        const productTypeMap = new Map(newProductRows.map((r) => [r.id, r.type]))

        // Enrich new items with types
        for (const item of newItemsForTransition) {
          item.type = productTypeMap.get(item.productId) ?? null
        }

        transitionSchedule = computeTransitionSchedule(
          oldItems,
          newItemsForTransition,
          transitionDays,
          today,
        )
      }

      // Ongoing row start date: after transition days, or today if no transition
      const ongoingStartDate = transitionDays > 0
        ? shiftDate(today, transitionDays)
        : today

      // Build ongoing feeding period rows
      const ongoingRows = body.items.map((item) => ({
        dogId,
        productId: item.productId,
        startDate: ongoingStartDate,
        startDatetime: newPlanStartDatetime,
        endDate: endDate as string | null,
        mealSlot: item.mealSlot as MealSlot | undefined,
        quantity: item.quantity,
        quantityUnit: item.quantityUnit as QuantityUnit,
        planGroupId,
        planName: body.planName ?? null,
        isBackfill: false,
        transitionDays: transitionDays > 0 ? transitionDays : null,
        previousPlanGroupId: transitionDays > 0 ? previousPlanGroupId : null,
      }))

      const created = await db.transaction(async (tx) => {
        for (const groupId of ongoingGroupIds) {
          const groupPeriod = ongoingPeriods.find((p) => p.planGroupId === groupId)!

          // Delete future single-day rows from old plan group (orphan cleanup)
          await tx.execute(
            sql`DELETE FROM ${feedingPeriods}
                WHERE ${feedingPeriods.planGroupId} = ${groupId}
                  AND ${feedingPeriods.startDate} = ${feedingPeriods.endDate}
                  AND ${feedingPeriods.startDate} >= ${today}`,
          )

          // Count daily logs for this period's date range
          const [logCount] = await tx
            .select({ count: sql<number>`count(*)` })
            .from(
              sql`(
                SELECT 1 FROM ${poopLogs} WHERE ${poopLogs.dogId} = ${dogId} AND ${poopLogs.date} >= ${groupPeriod.startDate} AND ${poopLogs.date} <= ${oldPlanEndDate}
                UNION ALL
                SELECT 1 FROM ${itchinessLogs} WHERE ${itchinessLogs.dogId} = ${dogId} AND ${itchinessLogs.date} >= ${groupPeriod.startDate} AND ${itchinessLogs.date} <= ${oldPlanEndDate}
                UNION ALL
                SELECT 1 FROM ${treatLogs} WHERE ${treatLogs.dogId} = ${dogId} AND ${treatLogs.date} >= ${groupPeriod.startDate} AND ${treatLogs.date} <= ${oldPlanEndDate}
              ) AS logs`,
            )

          if (Number(logCount.count) === 0 && transitionDays <= 0) {
            // No logs and no transition referencing this group — safe to delete
            await tx.delete(foodScorecards).where(eq(foodScorecards.planGroupId, groupId))
            await tx.delete(feedingPeriods).where(eq(feedingPeriods.planGroupId, groupId))
          } else {
            // Has logs or is referenced by transition — end-date old plan
            await tx
              .update(feedingPeriods)
              .set({ endDate: oldPlanEndDate, endDatetime: oldPlanEndDatetime, updatedAt: new Date() })
              .where(
                and(
                  eq(feedingPeriods.planGroupId, groupId),
                  isNull(feedingPeriods.endDate),
                ),
              )
          }
        }

        // Insert transition single-day rows
        if (transitionSchedule.length > 0) {
          const transitionRows = transitionSchedule.flatMap((day) =>
            day.items.map((item) => ({
              dogId,
              productId: item.productId,
              startDate: day.date,
              endDate: day.date,
              mealSlot: item.mealSlot as MealSlot | undefined,
              quantity: item.quantity,
              quantityUnit: item.quantityUnit as QuantityUnit,
              planGroupId,
              planName: body.planName ?? null,
              isBackfill: false,
              transitionDays: transitionDays,
              previousPlanGroupId: previousPlanGroupId,
            })),
          )
          await tx.insert(feedingPeriods).values(transitionRows)
        }

        // Insert ongoing rows
        return await tx.insert(feedingPeriods).values(ongoingRows).returning()
      })

      return NextResponse.json({ planGroupId, items: created }, { status: 201 })
    }

    // Non-starting_today modes: create feeding period rows
    const rows = body.items.map((item) => ({
      dogId,
      productId: item.productId,
      startDate,
      endDate,
      mealSlot: item.mealSlot as MealSlot | undefined,
      quantity: item.quantity,
      quantityUnit: item.quantityUnit as QuantityUnit,
      planGroupId,
      planName: body.planName ?? null,
      isBackfill: false,
    }))

    const created = await db.insert(feedingPeriods).values(rows).returning()

    return NextResponse.json({ planGroupId, items: created }, { status: 201 })
  } catch (error) {
    console.error("Error creating feeding plan:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
