import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, feedingPeriods, products, brands, foodScorecards, poopLogs, itchinessLogs, vomitLogs } from "@/lib/db"
import { eq, sql, desc } from "drizzle-orm"
import { resolveActivePlan, type PlanPeriod } from "@/lib/feeding"
import { fetchCorrelationInput, fetchIngredientProductMap, buildGiIngredientProductMap } from "@/lib/correlation/query"
import { runCorrelation } from "@/lib/correlation/engine"
import { findSaltPosition, splitIngredients } from "@/lib/ingredients"
import { DEFAULT_CORRELATION_OPTIONS } from "@/lib/correlation/types"
import type { IngredientProductEntry } from "@/lib/correlation/types"
import { avgFromRange } from "@/lib/food-helpers"
import type { FeedingPlanGroup, FeedingPlanItem, LogStats } from "@/lib/types"

type RouteParams = { params: Promise<{ id: string }> }

interface DateRange {
  key: string
  startDate: string
  endDate: string
}

/**
 * Batch-aggregate poop, itch, and vomit log stats for multiple date ranges
 * in a single SQL query using a ranges CTE.
 * Replaces N×4 individual queries with 1 query.
 */
async function batchAggregateLogStats(
  dogId: string,
  ranges: DateRange[],
): Promise<Map<string, LogStats>> {
  if (ranges.length === 0) return new Map()

  const rangeValues = ranges.map(
    (r) => sql`(${r.key}, ${r.startDate}::date, ${r.endDate}::date)`,
  )

  const result = await db.execute<{
    range_key: string
    poop_avg: string | null
    poop_count: number
    itch_avg: string | null
    itch_count: number
    vomit_count: number
    days_with_data: number
  }>(sql`
    WITH ranges(range_key, range_start, range_end) AS (
      VALUES ${sql.join(rangeValues, sql`, `)}
    ),
    poop_agg AS (
      SELECT r.range_key,
        round(avg(p.firmness_score)::numeric, 1) AS avg_score,
        count(*)::int AS cnt
      FROM ranges r
      JOIN ${poopLogs} p ON p.dog_id = ${dogId} AND p.date >= r.range_start AND p.date <= r.range_end
      GROUP BY r.range_key
    ),
    itch_agg AS (
      SELECT r.range_key,
        round(avg(i.score)::numeric, 1) AS avg_score,
        count(*)::int AS cnt
      FROM ranges r
      JOIN ${itchinessLogs} i ON i.dog_id = ${dogId} AND i.date >= r.range_start AND i.date <= r.range_end
      GROUP BY r.range_key
    ),
    vomit_agg AS (
      SELECT r.range_key,
        count(*)::int AS cnt
      FROM ranges r
      JOIN ${vomitLogs} v ON v.dog_id = ${dogId} AND v.date >= r.range_start AND v.date <= r.range_end
      GROUP BY r.range_key
    ),
    days_agg AS (
      SELECT range_key, count(DISTINCT log_date)::int AS days
      FROM (
        SELECT r.range_key, p.date AS log_date FROM ranges r
          JOIN ${poopLogs} p ON p.dog_id = ${dogId} AND p.date >= r.range_start AND p.date <= r.range_end
        UNION ALL
        SELECT r.range_key, i.date FROM ranges r
          JOIN ${itchinessLogs} i ON i.dog_id = ${dogId} AND i.date >= r.range_start AND i.date <= r.range_end
        UNION ALL
        SELECT r.range_key, v.date FROM ranges r
          JOIN ${vomitLogs} v ON v.dog_id = ${dogId} AND v.date >= r.range_start AND v.date <= r.range_end
      ) sub
      GROUP BY range_key
    )
    SELECT
      r.range_key,
      pa.avg_score::text AS poop_avg,
      COALESCE(pa.cnt, 0) AS poop_count,
      ia.avg_score::text AS itch_avg,
      COALESCE(ia.cnt, 0) AS itch_count,
      COALESCE(va.cnt, 0) AS vomit_count,
      COALESCE(da.days, 0) AS days_with_data
    FROM ranges r
    LEFT JOIN poop_agg pa ON pa.range_key = r.range_key
    LEFT JOIN itch_agg ia ON ia.range_key = r.range_key
    LEFT JOIN vomit_agg va ON va.range_key = r.range_key
    LEFT JOIN days_agg da ON da.range_key = r.range_key
  `)

  const map = new Map<string, LogStats>()
  for (const row of result.rows) {
    const r = row as {
      range_key: string
      poop_avg: string | null
      poop_count: number
      itch_avg: string | null
      itch_count: number
      vomit_count: number
      days_with_data: number
    }
    map.set(r.range_key, {
      avgPoopScore: r.poop_avg != null ? Number(r.poop_avg) : null,
      avgItchScore: r.itch_avg != null ? Number(r.itch_avg) : null,
      poopLogCount: Number(r.poop_count),
      itchLogCount: Number(r.itch_count),
      vomitLogCount: Number(r.vomit_count),
      daysWithData: Number(r.days_with_data),
    })
  }

  // Fill in empty stats for ranges with no data
  for (const range of ranges) {
    if (!map.has(range.key)) {
      map.set(range.key, {
        avgPoopScore: null,
        avgItchScore: null,
        poopLogCount: 0,
        itchLogCount: 0,
        vomitLogCount: 0,
        daysWithData: 0,
      })
    }
  }

  return map
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id } = await params
    const authResult = await requireDogOwnership(id)
    if (isNextResponse(authResult)) return authResult

    const today = new Date().toISOString().split("T")[0]

    // Fetch all feeding periods with product data
    const rows = await db
      .select({
        id: feedingPeriods.id,
        planGroupId: feedingPeriods.planGroupId,
        planName: feedingPeriods.planName,
        startDate: feedingPeriods.startDate,
        endDate: feedingPeriods.endDate,
        isBackfill: feedingPeriods.isBackfill,
        approximateDuration: feedingPeriods.approximateDuration,
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
          approximateDuration: row.approximateDuration,
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

    // Fetch scorecards + batch log stats in parallel
    const allGroups = [...groupMap.values()]
    const planGroupIds = [...groupMap.keys()]

    const nonBackfillGroups = allGroups.filter((g) => !g.isBackfill)
    const logRanges: DateRange[] = nonBackfillGroups.map((g) => ({
      key: g.planGroupId,
      startDate: g.startDate,
      endDate: g.endDate ?? today,
    }))

    const [, logStatsMap] = await Promise.all([
      // Fetch scorecards
      planGroupIds.length > 0
        ? db
            .select()
            .from(foodScorecards)
            .where(
              sql`${foodScorecards.planGroupId} IN (${sql.join(
                planGroupIds.map((pgId) => sql`${pgId}`),
                sql`, `,
              )})`,
            )
            .then((scorecards) => {
              for (const sc of scorecards) {
                const group = groupMap.get(sc.planGroupId)
                if (group) {
                  group.scorecard = {
                    id: sc.id,
                    poopQuality: sc.poopQuality,
                    itchSeverity: sc.itchSeverity,
                    digestiveImpact: sc.digestiveImpact,
                    itchinessImpact: sc.itchinessImpact,
                    notes: sc.notes,
                  }
                }
              }
            })
        : Promise.resolve(),

      // Batch log stats (single query for all groups)
      batchAggregateLogStats(id, logRanges),
    ])

    // Apply log stats to groups
    for (const group of nonBackfillGroups) {
      group.logStats = logStatsMap.get(group.planGroupId) ?? null
    }

    // Resolve the active plan — backfills are historical only, never "active"
    const planPeriods: PlanPeriod[] = rows
      .filter((r) => !r.isBackfill)
      .map((r) => ({
        planGroupId: r.planGroupId,
        startDate: r.startDate,
        endDate: r.endDate,
        createdAt: r.createdAt.toISOString(),
      }))
    const activePlanGroupId = resolveActivePlan(planPeriods, today)

    // Categorize
    let active: FeedingPlanGroup | null = null
    const past: FeedingPlanGroup[] = []

    for (const group of allGroups) {
      if (group.planGroupId === activePlanGroupId) {
        active = group
      } else if (group.endDate) {
        past.push(group)
      }
    }

    // -- Correlation: use full date range (earliest feeding period → today) --
    let correlationData: {
      correlation: ReturnType<typeof runCorrelation> extends infer R ? R : never
      ingredientProducts: Record<string, IngredientProductEntry[]>
      giIngredientProducts: Record<string, IngredientProductEntry[]>
    } | null = null

    if (allGroups.length > 0) {
      // windowStart/windowEnd defines the daily-log window — only non-backfill groups.
      // Backfill dates outside this window are handled by buildBackfillSnapshots.
      const nonBackfillGroups = allGroups.filter((g) => !g.isBackfill)
      const earliestStart = nonBackfillGroups.length > 0
        ? nonBackfillGroups.reduce(
            (min, g) => (g.startDate < min ? g.startDate : min),
            nonBackfillGroups[0].startDate,
          )
        : today
      const correlationInput = await fetchCorrelationInput(id, earliestStart, today)
      const [correlationResult, ingredientProductMap] = await Promise.all([
        Promise.resolve(runCorrelation(correlationInput, DEFAULT_CORRELATION_OPTIONS)),
        fetchIngredientProductMap(correlationInput),
      ])

      // Build product → score map from plan groups
      const productScores = new Map<string, {
        avgPoopScore: number | null
        avgItchScore: number | null
        digestiveImpact: string | null
        itchinessImpact: string | null
      }>()
      for (const group of allGroups) {
        let avgPoop: number | null = null
        let avgItch: number | null = null
        let digestiveImpact: string | null = null
        let itchinessImpact: string | null = null
        if (group.logStats?.avgPoopScore != null) {
          avgPoop = group.logStats.avgPoopScore
        } else if (group.scorecard?.poopQuality && group.scorecard.poopQuality.length > 0) {
          avgPoop = avgFromRange(group.scorecard.poopQuality)
        } else if (group.scorecard?.digestiveImpact) {
          digestiveImpact = group.scorecard.digestiveImpact
        }
        if (group.logStats?.avgItchScore != null) {
          avgItch = group.logStats.avgItchScore
        } else if (group.scorecard?.itchSeverity && group.scorecard.itchSeverity.length > 0) {
          avgItch = avgFromRange(group.scorecard.itchSeverity)
        } else if (group.scorecard?.itchinessImpact) {
          itchinessImpact = group.scorecard.itchinessImpact
        }
        for (const item of group.items) {
          const existing = productScores.get(item.productId)
          if (!existing) {
            productScores.set(item.productId, { avgPoopScore: avgPoop, avgItchScore: avgItch, digestiveImpact, itchinessImpact })
          } else {
            if (existing.avgPoopScore == null && avgPoop != null) existing.avgPoopScore = avgPoop
            if (existing.avgItchScore == null && avgItch != null) existing.avgItchScore = avgItch
            if (existing.digestiveImpact == null && digestiveImpact != null) existing.digestiveImpact = digestiveImpact
            if (existing.itchinessImpact == null && itchinessImpact != null) existing.itchinessImpact = itchinessImpact
          }
        }
      }

      // Enrich ingredient product entries with per-product scores
      const enrichEntry = (entry: IngredientProductEntry): IngredientProductEntry => {
        const scores = productScores.get(entry.productId)
        if (!scores) return entry
        return {
          ...entry,
          avgPoopScore: scores.avgPoopScore,
          avgItchScore: scores.avgItchScore,
          digestiveImpact: scores.digestiveImpact,
          itchinessImpact: scores.itchinessImpact,
        }
      }

      const ingredientProducts: Record<string, IngredientProductEntry[]> = {}
      for (const [key, entries] of ingredientProductMap) {
        ingredientProducts[key] = entries.map(enrichEntry)
      }

      const giIngredientProducts = buildGiIngredientProductMap(ingredientProductMap, enrichEntry)

      correlationData = {
        correlation: correlationResult,
        ingredientProducts,
        giIngredientProducts,
      }
    }

    // -- Per-product ingredient data for inline display --
    const allProductIds = new Set<string>()
    for (const g of allGroups) {
      for (const item of g.items) {
        allProductIds.add(item.productId)
      }
    }

    const productIngredientData: Record<string, {
      allIngredients: string[]
      classifiedByPosition: { position: number; normalizedName: string; family: string | null; sourceGroup: string | null; formType: string | null; isHydrolyzed: boolean }[]
      saltPosition: number | null
    }> = {}

    if (allProductIds.size > 0) {
      const productIdList = [...allProductIds]

      const [rawStrings, ingredientRows] = await Promise.all([
        db
          .select({
            id: products.id,
            rawIngredientString: products.rawIngredientString,
          })
          .from(products)
          .where(
            sql`${products.id} IN (${sql.join(
              productIdList.map((pid) => sql`${pid}`),
              sql`, `,
            )})`,
          ),
        db.execute<{
          product_id: string
          position: number
          normalized_name: string
          family: string | null
          source_group: string | null
          form_type: string | null
          is_hydrolyzed: boolean
        }>(sql`
          SELECT pi.product_id, pi.position, i.normalized_name, i.family, i.source_group, i.form_type, i.is_hydrolyzed
          FROM product_ingredients pi
          JOIN ingredients i ON i.id = pi.ingredient_id
          WHERE pi.product_id IN (${sql.join(
            productIdList.map((pid) => sql`${pid}`),
            sql`, `,
          )})
          ORDER BY pi.position ASC
        `),
      ])

      const rawStringMap = new Map(rawStrings.map((r) => [r.id, r.rawIngredientString ?? ""]))

      // Group ingredients by product
      const ingByProduct = new Map<string, typeof ingredientRows.rows>()
      for (const row of ingredientRows.rows) {
        const list = ingByProduct.get(row.product_id) ?? []
        list.push(row)
        ingByProduct.set(row.product_id, list)
      }

      for (const pid of productIdList) {
        const rawStr = rawStringMap.get(pid) ?? ""
        const ings = ingByProduct.get(pid) ?? []
        productIngredientData[pid] = {
          allIngredients: splitIngredients(rawStr),
          classifiedByPosition: ings.map((ing) => ({
            position: ing.position,
            normalizedName: ing.normalized_name,
            family: ing.family,
            sourceGroup: ing.source_group,
            formType: ing.form_type,
            isHydrolyzed: ing.is_hydrolyzed,
          })),
          saltPosition: findSaltPosition(rawStr),
        }
      }
    }

    return NextResponse.json({
      past,
      active,
      correlation: correlationData?.correlation ?? null,
      ingredientProducts: correlationData?.ingredientProducts ?? {},
      giIngredientProducts: correlationData?.giIngredientProducts ?? {},
      productIngredients: productIngredientData,
    })
  } catch (error) {
    console.error("Error fetching food scorecard data:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
