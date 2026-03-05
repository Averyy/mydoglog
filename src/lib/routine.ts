import { db, feedingPeriods, products, brands, medications } from "@/lib/db"
import { eq, sql, desc } from "drizzle-orm"
import { resolveActivePlan, type PlanPeriod } from "@/lib/feeding"
import type { ActivePlan, FeedingPlanItem, MedicationSummary } from "@/lib/types"

/**
 * Fetch the active feeding plan for a dog as of today.
 * Extracts the resolution logic from the feeding/today route so it can be
 * reused by the composite routine endpoint.
 */
export async function getActivePlanForDog(
  dogId: string,
): Promise<ActivePlan | null> {
  const today = new Date().toISOString().split("T")[0]

  const allPeriods = await db
    .select({
      planGroupId: feedingPeriods.planGroupId,
      startDate: feedingPeriods.startDate,
      endDate: feedingPeriods.endDate,
      createdAt: feedingPeriods.createdAt,
    })
    .from(feedingPeriods)
    .where(eq(feedingPeriods.dogId, dogId))

  const planPeriods: PlanPeriod[] = allPeriods.map((p) => ({
    planGroupId: p.planGroupId,
    startDate: p.startDate,
    endDate: p.endDate,
    createdAt: p.createdAt.toISOString(),
  }))

  const activePlanGroupId = resolveActivePlan(planPeriods, today)
  if (!activePlanGroupId) return null

  const rows = await db
    .select({
      id: feedingPeriods.id,
      planGroupId: feedingPeriods.planGroupId,
      planName: feedingPeriods.planName,
      startDate: feedingPeriods.startDate,
      endDate: feedingPeriods.endDate,
      productId: feedingPeriods.productId,
      quantity: feedingPeriods.quantity,
      quantityUnit: feedingPeriods.quantityUnit,
      mealSlot: feedingPeriods.mealSlot,
      productName: products.name,
      brandName: brands.name,
      imageUrl: sql<string | null>`${products.imageUrls}[1]`,
      productType: products.type,
    })
    .from(feedingPeriods)
    .innerJoin(products, eq(feedingPeriods.productId, products.id))
    .innerJoin(brands, eq(products.brandId, brands.id))
    .where(
      sql`${feedingPeriods.dogId} = ${dogId} AND ${feedingPeriods.planGroupId} = ${activePlanGroupId}`,
    )

  if (rows.length === 0) return null

  const items: FeedingPlanItem[] = rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    brandName: row.brandName,
    imageUrl: row.imageUrl,
    type: row.productType,
    quantity: row.quantity,
    quantityUnit: row.quantityUnit,
    mealSlot: row.mealSlot,
  }))

  return {
    planGroupId: rows[0].planGroupId,
    planName: rows[0].planName,
    startDate: rows[0].startDate,
    endDate: rows[0].endDate,
    items,
  }
}

/**
 * Fetch active (not ended) medications for a dog.
 */
export async function getActiveMedicationsForDog(
  dogId: string,
): Promise<MedicationSummary[]> {
  const rows = await db
    .select({
      id: medications.id,
      name: medications.name,
      dosage: medications.dosage,
      startDate: medications.startDate,
      endDate: medications.endDate,
      reason: medications.reason,
      notes: medications.notes,
    })
    .from(medications)
    .where(
      sql`${medications.dogId} = ${dogId} AND ${medications.endDate} IS NULL`,
    )
    .orderBy(desc(medications.startDate))

  return rows
}
