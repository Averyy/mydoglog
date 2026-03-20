import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { splitIngredients, findSaltPosition } from "@/lib/ingredients"
import {
  db,
  feedingPeriods,
  products,
  brands,
  productIngredients,
  ingredients,
  foodScorecards,
  poopLogs,
  itchinessLogs,
  treatLogs,
  medications,
  medicationProducts,
  dailyPollen,
  ingredientCrossReactivity,
} from "@/lib/db"
import { eq, and, gte, lte, asc, desc, sql, or } from "drizzle-orm"
import { getToday } from "@/lib/utils"
import { resolveMedicationFlags } from "@/lib/medications"
import { shiftDate, daysBetween } from "@/lib/date-utils"
import { fetchCorrelationInput } from "@/lib/correlation/query"
import { runCorrelation } from "@/lib/correlation/engine"
import { DEFAULT_CORRELATION_OPTIONS } from "@/lib/correlation/types"
import { AEROBIOLOGY_PROVIDER, TWN_PROVIDER, HAMILTON_LOCATION, NIAGARA_LOCATION } from "@/lib/pollen/constants"
import { deduplicatePollenRows } from "@/lib/pollen/dedup"
import {
  buildExportMarkdown,
  TIMELINE_DAYS,
  VALID_EXPORT_SECTIONS,
  type ExportData,
  type ExportProduct,
  type ExportFeedingPeriod,
  type ExportDailyRow,
  type ExportPollenBucket,
  type ExportBodyAreaFrequency,
  type ExportMedChangeEvent,
  type ExportMedication,
  type ExportSection,
} from "@/lib/export-llm"

type RouteParams = { params: Promise<{ id: string }> }

/** Parse raw ingredient string and truncate at salt (below 1% line). */
function getRawIngredients(raw: string | null): string[] | null {
  if (!raw) return null
  const all = splitIngredients(raw)
  const saltPos = findSaltPosition(raw)
  if (saltPos !== null) {
    // saltPos is 1-indexed; exclude salt itself (it's <1%)
    return all.slice(0, saltPos - 1)
  }
  return all
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult
    const { dog } = authResult

    const today = getToday()
    const url = new URL(request.url)

    // Parse timeline
    const timelineParam = url.searchParams.get("timeline") ?? "6m"
    const timelineDays = TIMELINE_DAYS[timelineParam] ?? 180

    // Parse excluded sections (validate against known values)
    const excludeParam = url.searchParams.get("exclude") ?? ""
    const excludeSections = new Set<ExportSection>(
      excludeParam
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is ExportSection => VALID_EXPORT_SECTIONS.has(s as ExportSection)),
    )

    // Compute window
    const windowEnd = today
    const windowStart = timelineDays > 0
      ? shiftDate(today, -timelineDays)
      : "2000-01-01"

    // ---------------------------------------------------------------------------
    // Fetch all data in parallel
    // ---------------------------------------------------------------------------

    const [
      allFeedingRows,
      medicationRows,
      allPoopRows,
      allItchRows,
      allTreatRows,
      crossReactivityRows,
      pollenRows,
    ] = await Promise.all([
      // All feeding periods for this dog (both backfill and non-backfill)
      db
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
          transitionDays: feedingPeriods.transitionDays,
          previousPlanGroupId: feedingPeriods.previousPlanGroupId,
          createdAt: feedingPeriods.createdAt,
          productName: products.name,
          brandName: brands.name,
          productType: products.type,
          productFormat: products.format,
          productChannel: products.channel,
          calorieContent: products.calorieContent,
          guaranteedAnalysis: products.guaranteedAnalysis,
          rawIngredientString: products.rawIngredientString,
        })
        .from(feedingPeriods)
        .innerJoin(products, eq(feedingPeriods.productId, products.id))
        .innerJoin(brands, eq(products.brandId, brands.id))
        .where(eq(feedingPeriods.dogId, dogId))
        .orderBy(asc(feedingPeriods.startDate), asc(feedingPeriods.createdAt)),

      // All medications with product details
      db
        .select({
          id: medications.id,
          name: medications.name,
          dosage: medications.dosage,
          startDate: medications.startDate,
          endDate: medications.endDate,
          medicationProductId: medications.medicationProductId,
          interval: medications.interval,
          notes: medications.notes,
          dosageForm: medicationProducts.dosageForm,
          description: medicationProducts.description,
          commonSideEffects: medicationProducts.commonSideEffects,
          sideEffectsSources: medicationProducts.sideEffectsSources,
          drugClass: medicationProducts.drugClass,
          category: medicationProducts.category,
          catalogSuppressesItch: medicationProducts.suppressesItch,
          catalogHasGiSideEffects: medicationProducts.hasGiSideEffects,
          customSuppressesItch: medications.suppressesItch,
          customHasGiSideEffects: medications.hasGiSideEffects,
        })
        .from(medications)
        .leftJoin(medicationProducts, eq(medications.medicationProductId, medicationProducts.id))
        .where(eq(medications.dogId, dogId))
        .orderBy(asc(medications.startDate)),

      // Poop logs in window
      db
        .select({
          date: poopLogs.date,
          firmnessScore: poopLogs.firmnessScore,
          notes: poopLogs.notes,
        })
        .from(poopLogs)
        .where(
          and(
            eq(poopLogs.dogId, dogId),
            gte(poopLogs.date, windowStart),
            lte(poopLogs.date, windowEnd),
          ),
        )
        .orderBy(desc(poopLogs.date)),

      // Itch logs in window
      db
        .select({
          date: itchinessLogs.date,
          score: itchinessLogs.score,
          bodyAreas: itchinessLogs.bodyAreas,
          notes: itchinessLogs.notes,
        })
        .from(itchinessLogs)
        .where(
          and(
            eq(itchinessLogs.dogId, dogId),
            gte(itchinessLogs.date, windowStart),
            lte(itchinessLogs.date, windowEnd),
          ),
        )
        .orderBy(desc(itchinessLogs.date)),

      // Treat logs in window
      db
        .select({
          date: treatLogs.date,
          productId: treatLogs.productId,
          quantity: treatLogs.quantity,
          productName: products.name,
          brandName: brands.name,
          rawIngredientString: products.rawIngredientString,
        })
        .from(treatLogs)
        .innerJoin(products, eq(treatLogs.productId, products.id))
        .innerJoin(brands, eq(products.brandId, brands.id))
        .where(
          and(
            eq(treatLogs.dogId, dogId),
            gte(treatLogs.date, windowStart),
            lte(treatLogs.date, windowEnd),
          ),
        ),

      // Cross-reactivity groups (skip if excluded)
      !excludeSections.has("cross-reactivity")
        ? db.select().from(ingredientCrossReactivity)
        : Promise.resolve([]),

      // Pollen data in window (with 2-day lookback for rolling max)
      db
        .select({
          date: dailyPollen.date,
          provider: dailyPollen.provider,
          pollenLevel: dailyPollen.pollenLevel,
          sporeLevel: dailyPollen.sporeLevel,
          location: dailyPollen.location,
        })
        .from(dailyPollen)
        .where(
          and(
            or(
              and(eq(dailyPollen.provider, AEROBIOLOGY_PROVIDER), eq(dailyPollen.location, HAMILTON_LOCATION)),
              and(eq(dailyPollen.provider, TWN_PROVIDER), eq(dailyPollen.location, NIAGARA_LOCATION)),
            ),
            gte(dailyPollen.date, shiftDate(windowStart, -2)),
            lte(dailyPollen.date, windowEnd),
          ),
        )
        .orderBy(asc(dailyPollen.date)),
    ])

    // ---------------------------------------------------------------------------
    // Fetch product ingredients + scorecards in parallel
    // ---------------------------------------------------------------------------

    const allProductIds = new Set<string>()
    for (const row of allFeedingRows) allProductIds.add(row.productId)
    for (const row of allTreatRows) allProductIds.add(row.productId)

    const productIdList = [...allProductIds]
    const allPlanGroupIds = [...new Set(allFeedingRows.map((r) => r.planGroupId))]

    const [ingredientRows, scorecardRows] = await Promise.all([
      productIdList.length > 0
        ? db
            .select({
              productId: productIngredients.productId,
              position: productIngredients.position,
              normalizedName: ingredients.normalizedName,
            })
            .from(productIngredients)
            .innerJoin(ingredients, eq(productIngredients.ingredientId, ingredients.id))
            .where(
              sql`${productIngredients.productId} IN (${sql.join(
                productIdList.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            )
            .orderBy(asc(productIngredients.position))
        : Promise.resolve([]),
      allPlanGroupIds.length > 0
        ? db
            .select()
            .from(foodScorecards)
            .where(
              sql`${foodScorecards.planGroupId} IN (${sql.join(
                allPlanGroupIds.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            )
        : Promise.resolve([]),
    ])

    // ---------------------------------------------------------------------------
    // Build product map
    // ---------------------------------------------------------------------------

    const productMap = new Map<string, ExportProduct>()
    const ingredientsByProduct = new Map<string, { normalizedName: string; position: number }[]>()
    for (const row of ingredientRows) {
      const list = ingredientsByProduct.get(row.productId) ?? []
      list.push({ normalizedName: row.normalizedName, position: row.position })
      ingredientsByProduct.set(row.productId, list)
    }

    for (const row of allFeedingRows) {
      if (productMap.has(row.productId)) continue
      productMap.set(row.productId, {
        id: row.productId,
        name: row.productName,
        brandName: row.brandName,
        type: row.productType,
        format: row.productFormat,
        channel: row.productChannel,
        calorieContent: row.calorieContent,
        guaranteedAnalysis: row.guaranteedAnalysis as Record<string, string> | null,
        ingredients: ingredientsByProduct.get(row.productId) ?? [],
        rawIngredients: getRawIngredients(row.rawIngredientString),
      })
    }

    // Add treat products to the product map
    for (const row of allTreatRows) {
      if (productMap.has(row.productId)) continue
      productMap.set(row.productId, {
        id: row.productId,
        name: row.productName,
        brandName: row.brandName,
        type: "treat",
        format: null,
        channel: null,
        calorieContent: null,
        guaranteedAnalysis: null,
        ingredients: ingredientsByProduct.get(row.productId) ?? [],
        rawIngredients: getRawIngredients(row.rawIngredientString),
      })
    }

    // ---------------------------------------------------------------------------
    // Build feeding periods (grouped by planGroupId, numbered)
    // ---------------------------------------------------------------------------

    const planGroupOrder = new Map<string, {
      planGroupId: string
      planName: string | null
      startDate: string
      endDate: string | null
      isBackfill: boolean
      transitionDays: number | null
      previousPlanGroupId: string | null
      items: { productId: string; quantity: string; quantityUnit: string; mealSlot: string | null }[]
    }>()

    // First pass: collect rows per group and merge date ranges
    const groupRawRows = new Map<string, typeof allFeedingRows>()

    for (const row of allFeedingRows) {
      let group = planGroupOrder.get(row.planGroupId)
      if (!group) {
        group = {
          planGroupId: row.planGroupId,
          planName: row.planName,
          startDate: row.startDate,
          endDate: row.endDate,
          isBackfill: row.isBackfill,
          transitionDays: row.transitionDays,
          previousPlanGroupId: row.previousPlanGroupId,
          items: [],
        }
        planGroupOrder.set(row.planGroupId, group)
        groupRawRows.set(row.planGroupId, [])
      }

      groupRawRows.get(row.planGroupId)!.push(row)

      // Merge date ranges
      if (row.startDate < group.startDate) group.startDate = row.startDate
      if (!row.endDate || !group.endDate) {
        group.endDate = null
      } else if (row.endDate > group.endDate) {
        group.endDate = row.endDate
      }
    }

    // Second pass: populate items with transition-aware filtering
    // Matches buildFeedingGroupMap logic — skip single-day transition blend rows
    for (const [planGroupId, group] of planGroupOrder) {
      const rows = groupRawRows.get(planGroupId)!
      const hasTransition = group.transitionDays != null && group.transitionDays > 0
      const isActiveTransition = hasTransition && group.endDate === null

      for (const row of rows) {
        // Active transition: only include ongoing (endDate IS NULL) target rows
        if (isActiveTransition && row.endDate !== null) continue
        // Ended transition: skip single-day transition blend rows
        if (hasTransition && !isActiveTransition && row.startDate === row.endDate) continue

        // Deduplicate items by productId + mealSlot
        const existing = group.items.some(
          (i) => i.productId === row.productId && i.mealSlot === row.mealSlot,
        )
        if (!existing) {
          group.items.push({
            productId: row.productId,
            quantity: row.quantity,
            quantityUnit: row.quantityUnit,
            mealSlot: row.mealSlot,
          })
        }
      }
    }

    // Sort by startDate, assign period numbers
    const sortedGroups = [...planGroupOrder.values()].sort(
      (a, b) => a.startDate.localeCompare(b.startDate),
    )
    const planGroupToPeriodNumber = new Map<string, number>()
    sortedGroups.forEach((g, i) => planGroupToPeriodNumber.set(g.planGroupId, i + 1))

    // Build scorecard map
    const scorecardMap = new Map<string, typeof scorecardRows[0]>()
    for (const sc of scorecardRows) {
      scorecardMap.set(sc.planGroupId, sc)
    }

    // ---------------------------------------------------------------------------
    // Build pollen map (date → effective level with 3-day rolling max)
    // ---------------------------------------------------------------------------

    const dedupedPollen = deduplicatePollenRows(pollenRows)

    const rawPollenMap = new Map<string, number>()
    for (const r of dedupedPollen) {
      const level = Math.max(r.pollenLevel, r.sporeLevel ?? 0)
      rawPollenMap.set(r.date, level)
    }

    // Compute 3-day rolling max
    const effectivePollenMap = new Map<string, number>()
    for (const date of rawPollenMap.keys()) {
      if (date < windowStart) continue
      const d0 = rawPollenMap.get(date) ?? 0
      const d1 = rawPollenMap.get(shiftDate(date, -1)) ?? 0
      const d2 = rawPollenMap.get(shiftDate(date, -2)) ?? 0
      effectivePollenMap.set(date, Math.max(d0, d1, d2))
    }

    // Pollen source info
    const pollenSource = dog.environmentEnabled && dedupedPollen.length > 0
      ? {
          provider: dedupedPollen[0].provider,
          location: dedupedPollen[0].location,
        }
      : null

    // ---------------------------------------------------------------------------
    // Pre-index logs by date for O(1) lookups
    // ---------------------------------------------------------------------------

    const poopByDate = new Map<string, typeof allPoopRows>()
    for (const r of allPoopRows) {
      const list = poopByDate.get(r.date) ?? []
      list.push(r)
      poopByDate.set(r.date, list)
    }

    const itchByDate = new Map<string, typeof allItchRows>()
    for (const r of allItchRows) {
      const list = itchByDate.get(r.date) ?? []
      list.push(r)
      itchByDate.set(r.date, list)
    }

    // Pre-index food names and meds by date
    const foodNamesByDate = new Map<string, string[]>()
    const medsByDate = new Map<string, string[]>()
    const transitionDates = new Set<string>()

    // Build food-by-date index from feeding periods
    const allLogDates = new Set<string>()
    for (const r of allPoopRows) allLogDates.add(r.date)
    for (const r of allItchRows) allLogDates.add(r.date)

    for (const date of allLogDates) {
      // Foods: use individual feeding rows for accurate per-day resolution
      // (group-level items exclude transition blend rows; individual rows have
      //  correct date ranges for transition single-day vs ongoing rows)
      const foodNames: string[] = []
      const seenFoods = new Set<string>()
      for (const row of allFeedingRows) {
        const rowEnd = row.endDate ?? today
        if (row.startDate <= date && rowEnd >= date) {
          const product = productMap.get(row.productId)
          if (product && product.type === "food" && !seenFoods.has(product.name)) {
            seenFoods.add(product.name)
            foodNames.push(product.name)
          }
        }
      }
      foodNamesByDate.set(date, foodNames)

      // Meds
      const medLabels: string[] = []
      const seenMeds = new Set<string>()
      for (const med of medicationRows) {
        const medEnd = med.endDate ?? today
        if (med.startDate <= date && medEnd >= date) {
          const label = med.dosage ? `${med.name} ${med.dosage}` : med.name
          if (!seenMeds.has(label)) {
            seenMeds.add(label)
            medLabels.push(label)
          }
        }
      }
      medsByDate.set(date, medLabels)

      // Transition check
      for (const group of sortedGroups) {
        if (group.transitionDays && group.transitionDays > 0) {
          const transEnd = shiftDate(group.startDate, group.transitionDays - 1)
          if (date >= group.startDate && date <= transEnd) {
            transitionDates.add(date)
            break
          }
        }
      }
    }

    // ---------------------------------------------------------------------------
    // Build medication helpers
    // ---------------------------------------------------------------------------

    const medRows: ExportMedication[] = medicationRows.map((r) => ({
      id: r.id,
      name: r.name,
      dosage: r.dosage,
      startDate: r.startDate,
      endDate: r.endDate,
      medicationProductId: r.medicationProductId,
      interval: r.interval,
      notes: r.notes,
      dosageForm: r.dosageForm,
      description: r.description,
      commonSideEffects: r.commonSideEffects,
      sideEffectsSources: r.sideEffectsSources,
      category: r.category,
      drugClass: r.drugClass,
      ...resolveMedicationFlags(r),
    }))

    function getMedsForRange(start: string, end: string): string[] {
      const result: string[] = []
      const seen = new Set<string>()
      for (const med of medicationRows) {
        const medEnd = med.endDate ?? today
        if (med.startDate <= end && medEnd >= start) {
          const label = med.dosage ? `${med.name} ${med.dosage}` : med.name
          if (!seen.has(label)) {
            seen.add(label)
            result.push(label)
          }
        }
      }
      return result
    }

    // ---------------------------------------------------------------------------
    // Compute log stats per feeding period (using pre-indexed maps)
    // ---------------------------------------------------------------------------

    /** Collect logs from a pre-indexed map for a date range (inclusive). */
    function collectFromMap<T>(map: Map<string, T[]>, start: string, end: string): T[] {
      const result: T[] = []
      let current = start
      let safety = 0
      while (current <= end && safety < 3650) {
        const entries = map.get(current)
        if (entries) result.push(...entries)
        current = shiftDate(current, 1)
        safety++
      }
      return result
    }

    function computeLogStats(
      start: string,
      end: string,
    ): { avgPoopScore: number | null; avgItchScore: number | null; daysWithData: number } | null {
      const poopInRange = collectFromMap(poopByDate, start, end)
      const itchInRange = collectFromMap(itchByDate, start, end)

      const daysWithPoop = new Set(poopInRange.map((r) => r.date))
      const daysWithItch = new Set(itchInRange.map((r) => r.date))
      const allDays = new Set([...daysWithPoop, ...daysWithItch])

      if (allDays.size === 0) return null

      const avgPoop = poopInRange.length > 0
        ? poopInRange.reduce((sum, r) => sum + r.firmnessScore, 0) / poopInRange.length
        : null
      const avgItch = itchInRange.length > 0
        ? itchInRange.reduce((sum, r) => sum + r.score, 0) / itchInRange.length
        : null

      return { avgPoopScore: avgPoop, avgItchScore: avgItch, daysWithData: allDays.size }
    }

    // ---------------------------------------------------------------------------
    // Compute pollen stats per feeding period
    // ---------------------------------------------------------------------------

    function computePollenStats(
      start: string,
      end: string,
    ): { avgPollen: number | null; highPollenDayPercent: number | null } {
      let totalPollen = 0
      let pollenDays = 0
      let highDays = 0
      let totalDays = 0

      let current = start
      while (current <= end && totalDays < 3650) {
        totalDays++
        const pollen = effectivePollenMap.get(current)
        if (pollen !== undefined) {
          totalPollen += pollen
          pollenDays++
          if (pollen >= 3) highDays++
        }
        current = shiftDate(current, 1)
      }

      return {
        avgPollen: pollenDays > 0 ? totalPollen / pollenDays : null,
        highPollenDayPercent: pollenDays > 0 ? (highDays / totalDays) * 100 : null,
      }
    }

    // ---------------------------------------------------------------------------
    // Compute treats per feeding period
    // ---------------------------------------------------------------------------

    function getTreatsForRange(
      start: string,
      end: string,
    ): { productId: string; productName: string; count: number }[] {
      const counts = new Map<string, { productId: string; productName: string; count: number }>()
      for (const t of allTreatRows) {
        if (t.date >= start && t.date <= end) {
          const existing = counts.get(t.productId)
          if (existing) {
            existing.count++
          } else {
            counts.set(t.productId, { productId: t.productId, productName: `${t.brandName} ${t.productName}`, count: 1 })
          }
        }
      }
      return [...counts.values()]
    }

    // ---------------------------------------------------------------------------
    // Build ExportFeedingPeriod array
    // ---------------------------------------------------------------------------

    const exportPeriods: ExportFeedingPeriod[] = sortedGroups.map((group) => {
      const periodNumber = planGroupToPeriodNumber.get(group.planGroupId)!
      const endDate = group.endDate ?? today
      const sc = scorecardMap.get(group.planGroupId)
      const logStats = computeLogStats(group.startDate, endDate)
      const pollenStats = computePollenStats(group.startDate, endDate)
      const activeMeds = getMedsForRange(group.startDate, endDate)
      const treats = getTreatsForRange(group.startDate, endDate)

      const prevPeriodNumber = group.previousPlanGroupId
        ? planGroupToPeriodNumber.get(group.previousPlanGroupId) ?? null
        : null

      return {
        periodNumber,
        planGroupId: group.planGroupId,
        planName: group.planName,
        startDate: group.startDate,
        endDate: group.endDate,
        isBackfill: group.isBackfill,
        transitionDays: group.transitionDays,
        previousPeriodNumber: prevPeriodNumber,
        items: group.items,
        scorecard: sc
          ? { poopQuality: sc.poopQuality, itchSeverity: sc.itchSeverity }
          : null,
        logStats,
        avgPollen: pollenStats.avgPollen,
        highPollenDayPercent: pollenStats.highPollenDayPercent,
        activeMeds,
        treats,
      }
    })

    // ---------------------------------------------------------------------------
    // Build daily log table (using pre-indexed maps)
    // ---------------------------------------------------------------------------

    const dailyLog: ExportDailyRow[] = []
    const sortedDates = [...allLogDates].sort((a, b) => b.localeCompare(a)) // newest first

    for (const date of sortedDates) {
      const poopEntries = poopByDate.get(date) ?? []
      const itchEntries = itchByDate.get(date) ?? []
      const poopScores = poopEntries.map((r) => r.firmnessScore)
      const itchScores = itchEntries.map((r) => r.score)
      const avgPoop = poopScores.length > 0
        ? poopScores.reduce((a, b) => a + b, 0) / poopScores.length
        : null
      const avgItch = itchScores.length > 0
        ? itchScores.reduce((a, b) => a + b, 0) / itchScores.length
        : null

      const bodyAreas: string[] = []
      for (const entry of itchEntries) {
        if (entry.bodyAreas) {
          for (const area of entry.bodyAreas) {
            if (!bodyAreas.includes(area)) bodyAreas.push(area)
          }
        }
      }

      const notes: string[] = []
      for (const entry of poopEntries) {
        if (entry.notes) notes.push(entry.notes)
      }
      for (const entry of itchEntries) {
        if (entry.notes) notes.push(entry.notes)
      }

      dailyLog.push({
        date,
        poopScores,
        avgPoop,
        itchScores,
        avgItch,
        itchBodyAreas: bodyAreas,
        effectivePollen: effectivePollenMap.get(date) ?? null,
        foodNames: foodNamesByDate.get(date) ?? [],
        meds: medsByDate.get(date) ?? [],
        notes,
        isTransition: transitionDates.has(date),
      })
    }

    // ---------------------------------------------------------------------------
    // Run correlation engine (if not excluded)
    // ---------------------------------------------------------------------------

    let correlationResult = null
    if (!excludeSections.has("correlation")) {
      try {
        // Use earliest non-backfill feeding period as window start
        const nonBackfillPeriods = sortedGroups.filter((g) => !g.isBackfill)
        const corrWindowStart = nonBackfillPeriods.length > 0
          ? nonBackfillPeriods[0].startDate
          : windowStart

        const input = await fetchCorrelationInput(dogId, corrWindowStart, windowEnd)
        correlationResult = runCorrelation(input, DEFAULT_CORRELATION_OPTIONS)
      } catch (err) {
        console.error("Correlation engine failed, skipping section:", err)
      }
    }

    // ---------------------------------------------------------------------------
    // Compute pollen bucket stats
    // ---------------------------------------------------------------------------

    const pollenBuckets: ExportPollenBucket[] = []
    if (dog.environmentEnabled) {
      const buckets: { label: string; range: [number, number] }[] = [
        { label: "0-1 (low)", range: [0, 1] },
        { label: "2 (moderate)", range: [2, 2] },
        { label: "3-4 (high)", range: [3, 4] },
      ]

      for (const bucket of buckets) {
        let poopSum = 0, poopCount = 0
        let itchSum = 0, itchCount = 0
        let dayCount = 0

        for (const date of allLogDates) {
          const pollen = effectivePollenMap.get(date)
          if (pollen === undefined) continue
          if (pollen < bucket.range[0] || pollen > bucket.range[1]) continue
          dayCount++

          const poop = poopByDate.get(date)
          if (poop) {
            for (const r of poop) {
              poopSum += r.firmnessScore
              poopCount++
            }
          }

          const itch = itchByDate.get(date)
          if (itch) {
            for (const r of itch) {
              itchSum += r.score
              itchCount++
            }
          }
        }

        pollenBuckets.push({
          label: bucket.label,
          days: dayCount,
          avgPoop: poopCount > 0 ? poopSum / poopCount : null,
          avgItch: itchCount > 0 ? itchSum / itchCount : null,
        })
      }
    }

    // ---------------------------------------------------------------------------
    // Compute body area frequency (unique dates per body area)
    // ---------------------------------------------------------------------------

    const itchDatesSet = new Set(allItchRows.map((r) => r.date))
    const daysWithItch = itchDatesSet.size

    const bodyAreaDays = new Map<string, Set<string>>()
    for (const entry of allItchRows) {
      if (entry.bodyAreas) {
        for (const area of entry.bodyAreas) {
          const days = bodyAreaDays.get(area) ?? new Set()
          days.add(entry.date)
          bodyAreaDays.set(area, days)
        }
      }
    }

    const bodyAreaFrequency: ExportBodyAreaFrequency[] = daysWithItch > 0
      ? [...bodyAreaDays.entries()]
          .map(([area, days]) => ({
            area,
            percent: (days.size / daysWithItch) * 100,
          }))
          .sort((a, b) => b.percent - a.percent)
      : []

    // ---------------------------------------------------------------------------
    // Compute constant + unique ingredients per period
    // ---------------------------------------------------------------------------

    const periodIngredientSets: { periodNumber: number; ingredients: Set<string> }[] = []
    for (const group of sortedGroups) {
      const ingSet = new Set<string>()
      for (const item of group.items) {
        const product = productMap.get(item.productId)
        if (product && product.type === "food") {
          for (const ing of product.ingredients) {
            ingSet.add(ing.normalizedName)
          }
        }
      }
      if (ingSet.size > 0) {
        periodIngredientSets.push({
          periodNumber: planGroupToPeriodNumber.get(group.planGroupId)!,
          ingredients: ingSet,
        })
      }
    }

    let constantIngredients: string[] = []
    if (periodIngredientSets.length > 0) {
      let intersection = new Set(periodIngredientSets[0].ingredients)
      for (let i = 1; i < periodIngredientSets.length; i++) {
        intersection = new Set(
          [...intersection].filter((ing) => periodIngredientSets[i].ingredients.has(ing)),
        )
      }
      constantIngredients = [...intersection].sort()
    }

    // Build ingredient occurrence count map for efficient unique-per-period lookup
    const ingredientOccurrenceCount = new Map<string, number>()
    for (const ps of periodIngredientSets) {
      for (const ing of ps.ingredients) {
        ingredientOccurrenceCount.set(ing, (ingredientOccurrenceCount.get(ing) ?? 0) + 1)
      }
    }

    const uniqueIngredientsByPeriod = new Map<number, string[]>()
    for (const ps of periodIngredientSets) {
      const unique = [...ps.ingredients].filter(
        (ing) => ingredientOccurrenceCount.get(ing) === 1,
      )
      if (unique.length > 0) {
        uniqueIngredientsByPeriod.set(ps.periodNumber, unique.sort())
      }
    }

    // ---------------------------------------------------------------------------
    // Avg poop entries per day
    // ---------------------------------------------------------------------------

    const daysWithPoop = new Set(allPoopRows.map((r) => r.date))
    const avgPoopEntriesPerDay = daysWithPoop.size > 0
      ? allPoopRows.length / daysWithPoop.size
      : null

    // ---------------------------------------------------------------------------
    // Medication change events
    // ---------------------------------------------------------------------------

    const medChangeEvents: ExportMedChangeEvent[] = []

    // Group adjacent medication rows by name for dose change detection
    const medByName = new Map<string, typeof medicationRows>()
    for (const med of medicationRows) {
      const list = medByName.get(med.name) ?? []
      list.push(med)
      medByName.set(med.name, list)
    }

    for (const [medName, meds] of medByName) {
      const sorted = [...meds].sort((a, b) => a.startDate.localeCompare(b.startDate))

      for (let i = 0; i < sorted.length; i++) {
        const med = sorted[i]
        const next = i < sorted.length - 1 ? sorted[i + 1] : null
        const events: { date: string; event: string }[] = []

        // Start event — only for the first record (subsequent starts are covered by dose change)
        if (i === 0) {
          events.push({ date: med.startDate, event: "start" })
        }

        // Dose change: next row has same name but different dosage
        if (next && med.dosage !== next.dosage) {
          events.push({
            date: next.startDate,
            event: `dose change (${med.dosage ?? "?"} → ${next.dosage ?? "?"})`,
          })
        }

        // End event — only if this is a true stop (no following record)
        if (med.endDate && !next) {
          events.push({ date: med.endDate, event: "stop" })
        }

        for (const ev of events) {
          // Compute 7-day before/after symptom averages using pre-indexed maps
          const beforeStart = shiftDate(ev.date, -7)
          const beforeEnd = shiftDate(ev.date, -1)
          const afterStart = shiftDate(ev.date, 1)
          const afterEnd = shiftDate(ev.date, 7)

          const poopBefore = collectFromMap(poopByDate, beforeStart, beforeEnd)
          const poopAfter = collectFromMap(poopByDate, afterStart, afterEnd)
          const itchBefore = collectFromMap(itchByDate, beforeStart, beforeEnd)
          const itchAfter = collectFromMap(itchByDate, afterStart, afterEnd)

          medChangeEvents.push({
            date: ev.date,
            event: ev.event,
            medication: medName,
            avgPoopBefore: poopBefore.length > 0
              ? poopBefore.reduce((s, r) => s + r.firmnessScore, 0) / poopBefore.length
              : null,
            avgPoopAfter: poopAfter.length > 0
              ? poopAfter.reduce((s, r) => s + r.firmnessScore, 0) / poopAfter.length
              : null,
            avgItchBefore: itchBefore.length > 0
              ? itchBefore.reduce((s, r) => s + r.score, 0) / itchBefore.length
              : null,
            avgItchAfter: itchAfter.length > 0
              ? itchAfter.reduce((s, r) => s + r.score, 0) / itchAfter.length
              : null,
          })
        }
      }
    }

    // ---------------------------------------------------------------------------
    // Pollen coverage
    // ---------------------------------------------------------------------------

    // For "all" timeline, use actual tracking range (earliest feeding period → today)
    const actualTrackingDays = timelineDays > 0
      ? timelineDays
      : sortedGroups.length > 0
        ? daysBetween(sortedGroups[0].startDate, windowEnd) + 1
        : 0

    const pollenCoverage = dog.environmentEnabled
      ? {
          daysWithData: effectivePollenMap.size,
          totalDays: actualTrackingDays,
        }
      : null

    // ---------------------------------------------------------------------------
    // Assemble and format
    // ---------------------------------------------------------------------------

    const exportData: ExportData = {
      dog: {
        name: dog.name,
        breed: dog.breed,
        birthDate: dog.birthDate,
        weightKg: dog.weightKg,
        mealsPerDay: dog.mealsPerDay,
        environmentEnabled: dog.environmentEnabled,
      },
      exportDate: today,
      products: productMap,
      feedingPeriods: exportPeriods,
      medications: medRows,
      dailyLog,
      correlation: correlationResult,
      pollenBuckets,
      crossReactivityGroups: crossReactivityRows.map((r) => ({
        groupName: r.groupName,
        families: r.families,
      })),
      bodyAreaFrequency,
      constantIngredients,
      uniqueIngredientsByPeriod,
      avgPoopEntriesPerDay,
      itchChangeEvents: medChangeEvents,
      pollenSource,
      pollenCoverage,
    }

    const text = buildExportMarkdown(exportData, excludeSections)

    return NextResponse.json({ text })
  } catch (error) {
    console.error("Error generating LLM export:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
