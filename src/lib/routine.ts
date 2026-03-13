import { db, feedingPeriods, products, brands } from "@/lib/db"
import { eq, sql } from "drizzle-orm"
import { resolveActivePlan, type PlanPeriod } from "@/lib/feeding"
import { getToday } from "@/lib/utils"
import { shiftDate } from "@/lib/date-utils"
import type { ActivePlan, FeedingPlanItem } from "@/lib/types"

/**
 * Fetch the active feeding plan for a dog as of today.
 * Single query: fetches feeding periods with product data, resolves the active
 * plan group in-memory, then filters to just that group's items.
 */
export async function getActivePlanForDog(
  dogId: string,
): Promise<ActivePlan | null> {
  const today = getToday()

  // Single query: fetch all non-backfill periods with product data
  const rows = await db
    .select({
      id: feedingPeriods.id,
      planGroupId: feedingPeriods.planGroupId,
      planName: feedingPeriods.planName,
      startDate: feedingPeriods.startDate,
      endDate: feedingPeriods.endDate,
      createdAt: feedingPeriods.createdAt,
      productId: feedingPeriods.productId,
      quantity: feedingPeriods.quantity,
      quantityUnit: feedingPeriods.quantityUnit,
      mealSlot: feedingPeriods.mealSlot,
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
    .where(
      sql`${feedingPeriods.dogId} = ${dogId} AND ${feedingPeriods.isBackfill} = false`,
    )

  if (rows.length === 0) return null

  const planPeriods: PlanPeriod[] = rows.map((p) => ({
    planGroupId: p.planGroupId,
    startDate: p.startDate,
    endDate: p.endDate,
    createdAt: p.createdAt.toISOString(),
  }))

  const activePlanGroupId = resolveActivePlan(planPeriods, today)
  if (!activePlanGroupId) return null

  // Filter to active plan group AND active date range
  const activeRows = rows.filter((r) => {
    if (r.planGroupId !== activePlanGroupId) return false
    if (r.startDate > today) return false
    if (r.endDate !== null && r.endDate < today) return false
    return true
  })
  if (activeRows.length === 0) return null

  // Separate ongoing rows (targetItems) from single-day transition rows
  const ongoingRows = rows.filter(
    (r) => r.planGroupId === activePlanGroupId && r.endDate === null,
  )

  const items: FeedingPlanItem[] = activeRows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    brandName: row.brandName,
    imageUrl: row.imageUrl,
    type: row.productType,
    format: row.productFormat,
    quantity: row.quantity,
    quantityUnit: row.quantityUnit,
    mealSlot: row.mealSlot,
  }))

  const targetItems: FeedingPlanItem[] = ongoingRows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    brandName: row.brandName,
    imageUrl: row.imageUrl,
    type: row.productType,
    format: row.productFormat,
    quantity: row.quantity,
    quantityUnit: row.quantityUnit,
    mealSlot: row.mealSlot,
  }))

  // Transition metadata from the ongoing rows (all share the same values)
  const transitionDays = ongoingRows[0]?.transitionDays ?? null
  const previousPlanGroupId = ongoingRows[0]?.previousPlanGroupId ?? null

  // Determine if transition is still in progress:
  // Compute deterministically from earliest startDate + transitionDays
  const allGroupRows = rows.filter((r) => r.planGroupId === activePlanGroupId)
  const earliestStart = allGroupRows.reduce(
    (min, r) => (r.startDate < min ? r.startDate : min),
    allGroupRows[0].startDate,
  )
  const isTransitioning = transitionDays != null && transitionDays > 0
    && shiftDate(earliestStart, transitionDays) > today

  return {
    planGroupId: activeRows[0].planGroupId,
    planName: activeRows[0].planName,
    startDate: earliestStart,
    endDate: activeRows[0].endDate,
    items,
    transitionDays,
    previousPlanGroupId,
    isTransitioning,
    targetItems: isTransitioning ? targetItems : undefined,
  }
}
