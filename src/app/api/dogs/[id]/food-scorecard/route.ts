import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, feedingPeriods, products, brands, foodScorecards, poopLogs, itchinessLogs, vomitLogs } from "@/lib/db"
import { eq, sql, desc, and, gte, lte } from "drizzle-orm"
import { resolveActivePlan, type PlanPeriod } from "@/lib/feeding"
import type { FeedingPlanGroup, FeedingPlanItem, LogStats } from "@/lib/types"

type RouteParams = { params: Promise<{ id: string }> }

/** Aggregate poop, itch, and vomit logs for a date range. */
async function aggregateLogStats(
  dogId: string,
  startDate: string,
  endDate: string | null,
): Promise<LogStats> {
  const effectiveEnd = endDate ?? new Date().toISOString().split("T")[0]

  const [poopAgg, itchAgg, vomitAgg] = await Promise.all([
    db
      .select({
        avg: sql<number | null>`round(avg(${poopLogs.firmnessScore})::numeric, 1)`,
        count: sql<number>`count(*)::int`,
      })
      .from(poopLogs)
      .where(
        and(
          eq(poopLogs.dogId, dogId),
          gte(poopLogs.date, startDate),
          lte(poopLogs.date, effectiveEnd),
        ),
      ),
    db
      .select({
        avg: sql<number | null>`round(avg(${itchinessLogs.score})::numeric, 1)`,
        count: sql<number>`count(*)::int`,
      })
      .from(itchinessLogs)
      .where(
        and(
          eq(itchinessLogs.dogId, dogId),
          gte(itchinessLogs.date, startDate),
          lte(itchinessLogs.date, effectiveEnd),
        ),
      ),
    db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(vomitLogs)
      .where(
        and(
          eq(vomitLogs.dogId, dogId),
          gte(vomitLogs.date, startDate),
          lte(vomitLogs.date, effectiveEnd),
        ),
      ),
  ])

  // Count distinct days with any log data
  const daysResult = await db.execute<{ days: number }>(sql`
    SELECT count(DISTINCT d)::int AS days FROM (
      SELECT ${poopLogs.date} AS d FROM ${poopLogs}
        WHERE ${poopLogs.dogId} = ${dogId} AND ${poopLogs.date} >= ${startDate} AND ${poopLogs.date} <= ${effectiveEnd}
      UNION
      SELECT ${itchinessLogs.date} AS d FROM ${itchinessLogs}
        WHERE ${itchinessLogs.dogId} = ${dogId} AND ${itchinessLogs.date} >= ${startDate} AND ${itchinessLogs.date} <= ${effectiveEnd}
      UNION
      SELECT ${vomitLogs.date} AS d FROM ${vomitLogs}
        WHERE ${vomitLogs.dogId} = ${dogId} AND ${vomitLogs.date} >= ${startDate} AND ${vomitLogs.date} <= ${effectiveEnd}
    ) sub
  `)

  const avgPoop = poopAgg[0]?.avg
  const avgItch = itchAgg[0]?.avg

  return {
    avgPoopScore: avgPoop != null ? Number(avgPoop) : null,
    avgItchScore: avgItch != null ? Number(avgItch) : null,
    poopLogCount: poopAgg[0]?.count ?? 0,
    itchLogCount: itchAgg[0]?.count ?? 0,
    vomitLogCount: vomitAgg[0]?.count ?? 0,
    daysWithData: (daysResult.rows[0] as { days: number } | undefined)?.days ?? 0,
  }
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id } = await params
    const authResult = await requireDogOwnership(id)
    if (isNextResponse(authResult)) return authResult

    // Fetch all feeding periods with product data
    const rows = await db
      .select({
        id: feedingPeriods.id,
        planGroupId: feedingPeriods.planGroupId,
        planName: feedingPeriods.planName,
        startDate: feedingPeriods.startDate,
        endDate: feedingPeriods.endDate,
        isBackfill: feedingPeriods.isBackfill,
        productId: feedingPeriods.productId,
        quantity: feedingPeriods.quantity,
        quantityUnit: feedingPeriods.quantityUnit,
        mealSlot: feedingPeriods.mealSlot,
        createdAt: feedingPeriods.createdAt,
        productName: products.name,
        brandName: brands.name,
        imageUrl: sql<string | null>`${products.imageUrls}[1]`,
        productType: products.type,
      })
      .from(feedingPeriods)
      .innerJoin(products, eq(feedingPeriods.productId, products.id))
      .innerJoin(brands, eq(products.brandId, brands.id))
      .where(eq(feedingPeriods.dogId, id))
      .orderBy(desc(feedingPeriods.startDate), desc(feedingPeriods.createdAt))

    // Group by planGroupId
    const groupMap = new Map<string, FeedingPlanGroup>()

    for (const row of rows) {
      let group = groupMap.get(row.planGroupId)
      if (!group) {
        group = {
          planGroupId: row.planGroupId,
          planName: row.planName,
          startDate: row.startDate,
          endDate: row.endDate,
          isBackfill: row.isBackfill,
          items: [],
          scorecard: null,
          logStats: null,
        }
        groupMap.set(row.planGroupId, group)
      }

      if (row.startDate < group.startDate) group.startDate = row.startDate
      if (!row.endDate || !group.endDate) {
        group.endDate = null
      } else if (row.endDate > group.endDate) {
        group.endDate = row.endDate
      }

      const item: FeedingPlanItem = {
        id: row.id,
        productId: row.productId,
        productName: row.productName,
        brandName: row.brandName,
        imageUrl: row.imageUrl,
        type: row.productType,
        quantity: row.quantity,
        quantityUnit: row.quantityUnit,
        mealSlot: row.mealSlot,
      }
      group.items.push(item)
    }

    // Fetch scorecards for all plan groups
    const planGroupIds = [...groupMap.keys()]
    if (planGroupIds.length > 0) {
      const scorecards = await db
        .select()
        .from(foodScorecards)
        .where(
          sql`${foodScorecards.planGroupId} IN (${sql.join(
            planGroupIds.map((pgId) => sql`${pgId}`),
            sql`, `,
          )})`,
        )

      for (const sc of scorecards) {
        const group = groupMap.get(sc.planGroupId)
        if (group) {
          group.scorecard = {
            id: sc.id,
            poopQuality: sc.poopQuality,
            gas: sc.gas,
            vomiting: sc.vomiting,
            palatability: sc.palatability,
            itchinessImpact: sc.itchinessImpact,
            verdict: sc.verdict,
            primaryReason: sc.primaryReason,
            notes: sc.notes,
          }
        }
      }
    }

    // Aggregate log stats for each non-backfill group
    const allGroups = [...groupMap.values()]
    await Promise.all(
      allGroups
        .filter((g) => !g.isBackfill)
        .map(async (group) => {
          group.logStats = await aggregateLogStats(id, group.startDate, group.endDate)
        }),
    )

    // Resolve the active plan
    const today = new Date().toISOString().split("T")[0]
    const planPeriods: PlanPeriod[] = rows.map((r) => ({
      planGroupId: r.planGroupId,
      startDate: r.startDate,
      endDate: r.endDate,
      createdAt: r.createdAt.toISOString(),
    }))
    const activePlanGroupId = resolveActivePlan(planPeriods, today)

    // Categorize
    let active: FeedingPlanGroup | null = null
    const scored: FeedingPlanGroup[] = []
    const needsScoring: FeedingPlanGroup[] = []

    for (const group of allGroups) {
      if (group.planGroupId === activePlanGroupId) {
        active = group
      } else if (group.scorecard) {
        scored.push(group)
      } else if (group.endDate) {
        needsScoring.push(group)
      }
    }

    return NextResponse.json({ scored, needsScoring, active })
  } catch (error) {
    console.error("Error fetching food scorecard data:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
