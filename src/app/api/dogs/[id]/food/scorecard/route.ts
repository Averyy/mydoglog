import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, feedingPeriods, products, brands, foodScorecards, poopLogs, itchinessLogs, treatLogs } from "@/lib/db"
import { eq, sql, desc } from "drizzle-orm"
import { resolveActivePlan, buildFeedingGroupMap, type PlanPeriod } from "@/lib/feeding"
import { fetchCorrelationInput, fetchIngredientProductMap, buildGiIngredientProductMap } from "@/lib/correlation/query"
import { runCorrelation } from "@/lib/correlation/engine"
import { findSaltPosition, splitIngredients } from "@/lib/ingredients"
import { DEFAULT_CORRELATION_OPTIONS } from "@/lib/correlation/types"
import type { IngredientProductEntry } from "@/lib/correlation/types"
import { getToday } from "@/lib/utils"
import { avgFromRange } from "@/lib/food-helpers"
import type { FeedingPlanGroup, LogStats } from "@/lib/types"

type RouteParams = { params: Promise<{ id: string }> }

interface DateRange {
  key: string
  startDate: string
  endDate: string
}

/**
 * Batch-aggregate poop and itch log stats for multiple date ranges
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
    days_agg AS (
      SELECT range_key, count(DISTINCT log_date)::int AS days
      FROM (
        SELECT r.range_key, p.date AS log_date FROM ranges r
          JOIN ${poopLogs} p ON p.dog_id = ${dogId} AND p.date >= r.range_start AND p.date <= r.range_end
        UNION ALL
        SELECT r.range_key, i.date FROM ranges r
          JOIN ${itchinessLogs} i ON i.dog_id = ${dogId} AND i.date >= r.range_start AND i.date <= r.range_end
      ) sub
      GROUP BY range_key
    )
    SELECT
      r.range_key,
      pa.avg_score::text AS poop_avg,
      COALESCE(pa.cnt, 0) AS poop_count,
      ia.avg_score::text AS itch_avg,
      COALESCE(ia.cnt, 0) AS itch_count,
      COALESCE(da.days, 0) AS days_with_data
    FROM ranges r
    LEFT JOIN poop_agg pa ON pa.range_key = r.range_key
    LEFT JOIN itch_agg ia ON ia.range_key = r.range_key
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
      days_with_data: number
    }
    map.set(r.range_key, {
      avgPoopScore: r.poop_avg != null ? Number(r.poop_avg) : null,
      avgItchScore: r.itch_avg != null ? Number(r.itch_avg) : null,
      poopLogCount: Number(r.poop_count),
      itchLogCount: Number(r.itch_count),
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

    const today = getToday()

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

    // Fetch per-date treat logs and bucket into plan groups
    const treatRows = await db
      .select({
        productId: treatLogs.productId,
        date: treatLogs.date,
        productName: products.name,
        brandName: brands.name,
        imageUrl: sql<string | null>`${products.imageUrls}[1]`,
      })
      .from(treatLogs)
      .innerJoin(products, eq(treatLogs.productId, products.id))
      .innerJoin(brands, eq(products.brandId, brands.id))
      .where(eq(treatLogs.dogId, id))

    // Sort groups by startDate ascending for chronological bucketing
    const sortedGroups = [...groupMap.values()].sort((a, b) => a.startDate.localeCompare(b.startDate))

    for (const treat of treatRows) {
      // Find the plan group whose date range contains this treat log
      let targetGroup: FeedingPlanGroup | null = null
      for (const group of sortedGroups) {
        const groupEnd = group.endDate ?? today
        if (treat.date >= group.startDate && treat.date <= groupEnd) {
          targetGroup = group
          break
        }
      }
      // Orphan: attach to nearest preceding group
      if (!targetGroup) {
        for (let i = sortedGroups.length - 1; i >= 0; i--) {
          if (sortedGroups[i].startDate <= treat.date) {
            targetGroup = sortedGroups[i]
            break
          }
        }
      }
      if (!targetGroup) continue

      // Aggregate into per-product summary on the group
      const existing = targetGroup.treats.find((t) => t.productId === treat.productId)
      if (existing) {
        existing.logCount++
        if (treat.date < existing.firstDate) existing.firstDate = treat.date
        if (treat.date > existing.lastDate) existing.lastDate = treat.date
      } else {
        targetGroup.treats.push({
          productId: treat.productId,
          productName: treat.productName,
          brandName: treat.brandName,
          imageUrl: treat.imageUrl,
          logCount: 1,
          firstDate: treat.date,
          lastDate: treat.date,
        })
      }
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
      }>()
      for (const group of allGroups) {
        let avgPoop: number | null = null
        let avgItch: number | null = null
        if (group.logStats?.avgPoopScore != null) {
          avgPoop = group.logStats.avgPoopScore
        } else if (group.scorecard?.poopQuality && group.scorecard.poopQuality.length > 0) {
          avgPoop = avgFromRange(group.scorecard.poopQuality)
        }
        if (group.logStats?.avgItchScore != null) {
          avgItch = group.logStats.avgItchScore
        } else if (group.scorecard?.itchSeverity && group.scorecard.itchSeverity.length > 0) {
          avgItch = avgFromRange(group.scorecard.itchSeverity)
        }
        for (const item of group.items) {
          const existing = productScores.get(item.productId)
          if (!existing) {
            productScores.set(item.productId, { avgPoopScore: avgPoop, avgItchScore: avgItch })
          } else {
            if (existing.avgPoopScore == null && avgPoop != null) existing.avgPoopScore = avgPoop
            if (existing.avgItchScore == null && avgItch != null) existing.avgItchScore = avgItch
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
      for (const treat of g.treats) {
        allProductIds.add(treat.productId)
      }
    }

    const productIngredientData: Record<string, {
      allIngredients: string[]
      classifiedByPosition: { position: number; normalizedName: string; family: string | null; sourceGroup: string | null; formType: string | null; isHydrolyzed: boolean }[]
      saltPosition: number | null
    }> = {}

    // Per-product nutrition data (GA + calories + type/format) for inline display
    const productNutritionData: Record<string, {
      guaranteedAnalysis: Record<string, number> | null
      calorieContent: string | null
      type: string | null
      format: string | null
    }> = {}

    if (allProductIds.size > 0) {
      const productIdList = [...allProductIds]

      const [rawStrings, ingredientRows] = await Promise.all([
        db
          .select({
            id: products.id,
            rawIngredientString: products.rawIngredientString,
            guaranteedAnalysis: products.guaranteedAnalysis,
            calorieContent: products.calorieContent,
            productType: products.type,
            productFormat: products.format,
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

      // Build per-product nutrition map
      for (const r of rawStrings) {
        productNutritionData[r.id] = {
          guaranteedAnalysis: (r.guaranteedAnalysis as Record<string, number>) ?? null,
          calorieContent: r.calorieContent,
          type: r.productType,
          format: r.productFormat,
        }
      }

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
        const allIngredients = splitIngredients(rawStr)

        // Build a name→classified lookup so we can match by ingredient name
        // rather than relying on DB position (which skips unclassified items)
        const ingByName = new Map(
          ings.map((ing) => [ing.normalized_name.toLowerCase(), ing]),
        )

        const classifiedByPosition: typeof productIngredientData[string]["classifiedByPosition"] = []
        for (let i = 0; i < allIngredients.length; i++) {
          const rawName = allIngredients[i].toLowerCase().replace(/\.$/, "").trim()
          const matched = ingByName.get(rawName)
          if (matched) {
            classifiedByPosition.push({
              position: i + 1,
              normalizedName: matched.normalized_name,
              family: matched.family,
              sourceGroup: matched.source_group,
              formType: matched.form_type,
              isHydrolyzed: matched.is_hydrolyzed,
            })
          }
        }

        productIngredientData[pid] = {
          allIngredients,
          classifiedByPosition,
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
      productNutrition: productNutritionData,
    })
  } catch (error) {
    console.error("Error fetching food scorecard data:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
