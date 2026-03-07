/**
 * DB query layer for the correlation engine.
 * Fetches all raw data and returns a CorrelationInput bundle.
 */

import {
  db,
  dogs,
  feedingPeriods,
  treatLogs,
  productIngredients,
  ingredients,
  products,
  brands,
  poopLogs,
  itchinessLogs,
  vomitLogs,
  accidentalExposures,
  medications,
  foodScorecards,
  pollenLogs,
  ingredientCrossReactivity,
} from "@/lib/db"
import { eq, and, gte, lte, sql, asc } from "drizzle-orm"
import type { PlanPeriod } from "@/lib/feeding"
import { parseDuration } from "@/lib/feeding"
import { resolveIngredientKey, positionCategory } from "./engine"
import type {
  CorrelationInput,
  ProductIngredientRecord,
  IngredientProductEntry,
  RawFeedingPeriod,
  RawBackfill,
} from "./types"

// Cross-reactivity cache — static reference data, 5-minute TTL
type CrossReactivityRow = typeof ingredientCrossReactivity.$inferSelect
let _crossReactivityCache: { rows: CrossReactivityRow[]; at: number } | null = null
async function getCrossReactivityGroups(): Promise<CrossReactivityRow[]> {
  if (_crossReactivityCache && Date.now() - _crossReactivityCache.at < 300_000)
    return _crossReactivityCache.rows
  const rows = await db.select().from(ingredientCrossReactivity)
  _crossReactivityCache = { rows, at: Date.now() }
  return rows
}

/**
 * Fetch all data needed for correlation analysis.
 *
 * Runs queries in parallel where possible. Returns a CorrelationInput
 * ready to pass into `runCorrelation`.
 */
export async function fetchCorrelationInput(
  dogId: string,
  windowStart: string,
  windowEnd: string,
): Promise<CorrelationInput> {
  // -- Phase 1: queries that don't depend on other results --
  const [
    dogRows,
    feedingRows,
    backfillRows,
    treatRows,
    poopRows,
    itchRows,
    vomitRows,
    exposureRows,
    medicationRows,
    crossReactivityRows,
  ] = await Promise.all([
    // Dog location
    db
      .select({ location: dogs.location })
      .from(dogs)
      .where(eq(dogs.id, dogId)),

    // Non-backfill feeding periods (for day-by-day correlation)
    db
      .select({
        id: feedingPeriods.id,
        productId: feedingPeriods.productId,
        startDate: feedingPeriods.startDate,
        endDate: feedingPeriods.endDate,
        planGroupId: feedingPeriods.planGroupId,
        createdAt: feedingPeriods.createdAt,
      })
      .from(feedingPeriods)
      .where(
        and(
          eq(feedingPeriods.dogId, dogId),
          eq(feedingPeriods.isBackfill, false),
        ),
      ),

    // Backfill feeding periods (aggregate historical records — duration + scorecard only)
    db
      .select({
        planGroupId: feedingPeriods.planGroupId,
        productId: feedingPeriods.productId,
        approximateDuration: feedingPeriods.approximateDuration,
      })
      .from(feedingPeriods)
      .where(
        and(
          eq(feedingPeriods.dogId, dogId),
          eq(feedingPeriods.isBackfill, true),
        ),
      ),

    // Treat logs in window
    db
      .select({
        date: treatLogs.date,
        productId: treatLogs.productId,
      })
      .from(treatLogs)
      .where(
        and(
          eq(treatLogs.dogId, dogId),
          gte(treatLogs.date, windowStart),
          lte(treatLogs.date, windowEnd),
        ),
      ),

    // Poop logs in window
    db
      .select({
        date: poopLogs.date,
        firmnessScore: poopLogs.firmnessScore,
      })
      .from(poopLogs)
      .where(
        and(
          eq(poopLogs.dogId, dogId),
          gte(poopLogs.date, windowStart),
          lte(poopLogs.date, windowEnd),
        ),
      ),

    // Itchiness logs in window
    db
      .select({
        date: itchinessLogs.date,
        score: itchinessLogs.score,
      })
      .from(itchinessLogs)
      .where(
        and(
          eq(itchinessLogs.dogId, dogId),
          gte(itchinessLogs.date, windowStart),
          lte(itchinessLogs.date, windowEnd),
        ),
      ),

    // Vomit logs in window
    db
      .select({
        date: vomitLogs.date,
      })
      .from(vomitLogs)
      .where(
        and(
          eq(vomitLogs.dogId, dogId),
          gte(vomitLogs.date, windowStart),
          lte(vomitLogs.date, windowEnd),
        ),
      ),

    // Accidental exposures in window
    db
      .select({
        date: accidentalExposures.date,
      })
      .from(accidentalExposures)
      .where(
        and(
          eq(accidentalExposures.dogId, dogId),
          gte(accidentalExposures.date, windowStart),
          lte(accidentalExposures.date, windowEnd),
        ),
      ),

    // Medications overlapping the correlation window
    db
      .select({
        startDate: medications.startDate,
        endDate: medications.endDate,
        reason: medications.reason,
      })
      .from(medications)
      .where(
        and(
          eq(medications.dogId, dogId),
          lte(medications.startDate, windowEnd),
          sql`(${medications.endDate} IS NULL OR ${medications.endDate} >= ${windowStart})`,
        ),
      ),

    // Cross-reactivity groups (cached)
    getCrossReactivityGroups(),
  ])

  // -- Convert feeding periods to raw format --
  const rawFeeding: RawFeedingPeriod[] = feedingRows.map((r) => ({
    id: r.id,
    productId: r.productId,
    startDate: r.startDate,
    endDate: r.endDate,
    planGroupId: r.planGroupId,
    createdAt: r.createdAt.toISOString(),
  }))

  // -- Build planPeriods (same grouping as feeding.ts groupPlanPeriods) --
  const planPeriods: PlanPeriod[] = rawFeeding.map((r) => ({
    planGroupId: r.planGroupId,
    startDate: r.startDate,
    endDate: r.endDate,
    createdAt: r.createdAt,
  }))

  // -- Collect all product IDs from feeding + backfills + treats --
  const allProductIds = new Set<string>()
  for (const fp of rawFeeding) allProductIds.add(fp.productId)
  for (const bf of backfillRows) allProductIds.add(bf.productId)
  for (const t of treatRows) allProductIds.add(t.productId)

  // -- Phase 2: queries depending on phase 1 results --
  const productIdList = [...allProductIds]
  const dogLocation = dogRows[0]?.location ?? null

  // Fetch product ingredients and scorecards in parallel
  const allPlanGroupIds = new Set(rawFeeding.map((fp) => fp.planGroupId))
  for (const bf of backfillRows) allPlanGroupIds.add(bf.planGroupId)
  const planGroupIds = [...allPlanGroupIds]

  const [ingredientRows, scorecardRows, pollenRows] = await Promise.all([
    // Product ingredients for all products
    productIdList.length > 0
      ? db
          .select({
            productId: productIngredients.productId,
            position: productIngredients.position,
            ingredientId: ingredients.id,
            normalizedName: ingredients.normalizedName,
            family: ingredients.family,
            sourceGroup: ingredients.sourceGroup,
            formType: ingredients.formType,
            isHydrolyzed: ingredients.isHydrolyzed,
          })
          .from(productIngredients)
          .innerJoin(
            ingredients,
            eq(productIngredients.ingredientId, ingredients.id),
          )
          .where(
            sql`${productIngredients.productId} IN (${sql.join(
              productIdList.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          )
          .orderBy(asc(productIngredients.position))
      : Promise.resolve([]),

    // Scorecards for all plan groups
    planGroupIds.length > 0
      ? db
          .select({
            planGroupId: foodScorecards.planGroupId,
            poopQuality: foodScorecards.poopQuality,
            itchSeverity: foodScorecards.itchSeverity,
          })
          .from(foodScorecards)
          .where(
            sql`${foodScorecards.planGroupId} IN (${sql.join(
              planGroupIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          )
      : Promise.resolve([]),

    // Pollen logs matching dog's location
    dogLocation != null
      ? db
          .select({
            date: pollenLogs.date,
            pollenIndex: pollenLogs.pollenIndex,
          })
          .from(pollenLogs)
          .where(
            and(
              eq(pollenLogs.location, dogLocation),
              gte(pollenLogs.date, windowStart),
              lte(pollenLogs.date, windowEnd),
            ),
          )
      : Promise.resolve([]),
  ])

  // -- Build product ingredient map --
  const productIngredientMap = new Map<string, ProductIngredientRecord[]>()
  for (const row of ingredientRows) {
    const list = productIngredientMap.get(row.productId) ?? []
    list.push({
      productId: row.productId,
      position: row.position,
      ingredient: {
        id: row.ingredientId,
        normalizedName: row.normalizedName,
        family: row.family,
        sourceGroup: row.sourceGroup,
        formType: row.formType,
        isHydrolyzed: row.isHydrolyzed,
      },
    })
    productIngredientMap.set(row.productId, list)
  }

  // -- Build backfill entries with parsed durations and matched scorecards --
  const backfills: RawBackfill[] = backfillRows
    .map((bf) => {
      const duration = bf.approximateDuration
        ? parseDuration(bf.approximateDuration)
        : null
      const scorecard = scorecardRows.find(
        (sc) => sc.planGroupId === bf.planGroupId,
      )
      return {
        planGroupId: bf.planGroupId,
        productId: bf.productId,
        durationDays: duration?.days ?? 7, // fallback to 1 week
        scorecard: scorecard ?? null,
      }
    })

  return {
    dogId,
    windowStart,
    windowEnd,
    feedingPeriods: rawFeeding,
    treatLogs: treatRows,
    productIngredientMap,
    poopLogs: poopRows,
    itchinessLogs: itchRows,
    vomitLogs: vomitRows,
    accidentalExposures: exposureRows,
    medications: medicationRows,
    scorecards: scorecardRows,
    pollenLogs: pollenRows.map((r) => ({
      date: r.date,
      pollenIndex: r.pollenIndex != null ? Number(r.pollenIndex) : null,
    })),
    planPeriods,
    backfills,
    crossReactivityGroups: crossReactivityRows.map((r) => ({
      groupName: r.groupName,
      families: r.families,
    })),
  }
}

/**
 * Build an ingredient-key → product list map from the correlation input.
 * Fetches product names + brand names for all product IDs in the input.
 */
export async function fetchIngredientProductMap(
  input: CorrelationInput,
): Promise<Map<string, IngredientProductEntry[]>> {
  // Collect all product IDs
  const allProductIds = new Set<string>()
  for (const fp of input.feedingPeriods) allProductIds.add(fp.productId)
  for (const t of input.treatLogs) allProductIds.add(t.productId)
  for (const bf of input.backfills) allProductIds.add(bf.productId)

  if (allProductIds.size === 0) return new Map()

  const productIdList = [...allProductIds]

  // Fetch product name + brand in one query
  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      brandName: brands.name,
      type: products.type,
    })
    .from(products)
    .innerJoin(brands, eq(products.brandId, brands.id))
    .where(
      sql`${products.id} IN (${sql.join(
        productIdList.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    )

  const productLookup = new Map(
    productRows.map((r) => [r.id, { name: r.name, brandName: r.brandName, type: r.type }]),
  )

  // Build ingredient key → product entries
  const result = new Map<string, IngredientProductEntry[]>()

  for (const [productId, ings] of input.productIngredientMap) {
    const product = productLookup.get(productId)
    if (!product) continue

    for (const pi of ings) {
      const key = resolveIngredientKey(pi.ingredient)
      if (key == null) continue

      const entries = result.get(key) ?? []
      // Avoid duplicate product entries for same key
      if (!entries.some((e) => e.productId === productId)) {
        entries.push({
          productId,
          productName: product.name,
          brandName: product.brandName,
          position: pi.position,
          positionCategory: positionCategory(pi.position),
          productType: product.type ?? "dry_food",
        })
      }
      result.set(key, entries)
    }
  }

  return result
}
