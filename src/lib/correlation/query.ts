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
import { resolveIngredientKey, positionCategory, extractFamilyFromKey } from "./engine"
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
        quantity: feedingPeriods.quantity,
        quantityUnit: feedingPeriods.quantityUnit,
      })
      .from(feedingPeriods)
      .where(
        and(
          eq(feedingPeriods.dogId, dogId),
          eq(feedingPeriods.isBackfill, false),
        ),
      ),

    // Backfill feeding periods
    db
      .select({
        planGroupId: feedingPeriods.planGroupId,
        productId: feedingPeriods.productId,
        startDate: feedingPeriods.startDate,
        endDate: feedingPeriods.endDate,
        quantity: feedingPeriods.quantity,
        quantityUnit: feedingPeriods.quantityUnit,
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
        quantity: treatLogs.quantity,
        quantityUnit: treatLogs.quantityUnit,
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
    quantity: Number(r.quantity),
    quantityUnit: r.quantityUnit!,
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

  const [ingredientRows, scorecardRows, pollenRows, productTypeRows] = await Promise.all([
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
            digestiveImpact: foodScorecards.digestiveImpact,
            itchinessImpact: foodScorecards.itchinessImpact,
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

    // Product types + calorie content for gram estimation
    productIdList.length > 0
      ? db
          .select({ id: products.id, type: products.type, calorieContent: products.calorieContent })
          .from(products)
          .where(
            sql`${products.id} IN (${sql.join(
              productIdList.map((id) => sql`${id}`),
              sql`, `,
            )})`,
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

  // -- Build product info map --
  const productInfo = new Map<string, { type: string; calorieContent: string | null }>()
  for (const row of productTypeRows) {
    productInfo.set(row.id, { type: row.type ?? "dry_food", calorieContent: row.calorieContent })
  }

  // -- Build backfill entries from actual date ranges --
  const backfills: RawBackfill[] = backfillRows
    .filter((bf) => bf.endDate != null)
    .map((bf) => {
      const start = new Date(bf.startDate)
      const end = new Date(bf.endDate!)
      const durationDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1)
      const scorecard = scorecardRows.find(
        (sc) => sc.planGroupId === bf.planGroupId,
      )
      return {
        planGroupId: bf.planGroupId,
        productId: bf.productId,
        startDate: bf.startDate,
        endDate: bf.endDate!,
        durationDays,
        quantity: Number(bf.quantity),
        quantityUnit: bf.quantityUnit!,
        scorecard: scorecard ?? null,
      }
    })

  return {
    dogId,
    windowStart,
    windowEnd,
    feedingPeriods: rawFeeding,
    treatLogs: treatRows.map((r) => ({
      date: r.date,
      productId: r.productId,
      quantity: Number(r.quantity),
      quantityUnit: r.quantityUnit!,
    })),
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
    productInfo,
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
          avgPoopScore: null,
          avgItchScore: null,
          digestiveImpact: null,
          itchinessImpact: null,
        })
      }
      result.set(key, entries)
    }
  }

  return result
}

/**
 * Build GI-merged ingredient product map: union product entries by family.
 * Hydrolyzed keys stay separate — enzymatically distinct from parent protein.
 * When forms merge, entries are tagged with their original `formKey`.
 *
 * @param enrichEntry Optional transform applied to each entry (e.g. adding per-product scores).
 */
export function buildGiIngredientProductMap(
  ingredientProductMap: Map<string, IngredientProductEntry[]>,
  enrichEntry?: (entry: IngredientProductEntry) => IngredientProductEntry,
): Record<string, IngredientProductEntry[]> {
  const enrich = enrichEntry ?? ((e: IngredientProductEntry) => e)
  const giIngredientProducts: Record<string, IngredientProductEntry[]> = {}

  // Group all keys by their target groupKey
  const giGroupKeys = new Map<string, string[]>()
  for (const [key] of ingredientProductMap) {
    const groupKey = key.endsWith(" (hydrolyzed)")
      ? key
      : (extractFamilyFromKey(key) ?? key)
    const keys = giGroupKeys.get(groupKey) ?? []
    keys.push(key)
    giGroupKeys.set(groupKey, keys)
  }

  // Build entries, tagging with formKey when multiple keys merge
  for (const [groupKey, sourceKeys] of giGroupKeys) {
    const hasMultipleForms = sourceKeys.length > 1
    const existing: IngredientProductEntry[] = []
    const seen = new Set<string>()
    for (const key of sourceKeys) {
      const entries = ingredientProductMap.get(key) ?? []
      for (const entry of entries) {
        const dedup = `${entry.productId}:${key}`
        if (seen.has(dedup)) continue
        seen.add(dedup)
        existing.push({
          ...enrich(entry),
          ...(hasMultipleForms ? { formKey: key } : {}),
        })
      }
    }
    giIngredientProducts[groupKey] = existing
  }

  return giIngredientProducts
}
