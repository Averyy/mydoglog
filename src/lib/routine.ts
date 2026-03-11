import { db, feedingPeriods, products, brands } from "@/lib/db"
import { eq, sql } from "drizzle-orm"
import { resolveActivePlan, type PlanPeriod } from "@/lib/feeding"
import { getToday } from "@/lib/utils"
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

  const activeRows = rows.filter((r) => r.planGroupId === activePlanGroupId)
  if (activeRows.length === 0) return null

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

  return {
    planGroupId: activeRows[0].planGroupId,
    planName: activeRows[0].planName,
    startDate: activeRows[0].startDate,
    endDate: activeRows[0].endDate,
    items,
  }
}
