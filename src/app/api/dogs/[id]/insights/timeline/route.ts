import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import {
  db,
  poopLogs,
  itchinessLogs,
  feedingPeriods,
  medications,
  medicationProducts,
  dailyPollen,
  products,
  brands,
  foodScorecards,
} from "@/lib/db"
import { DOSING_INTERVAL_LABELS } from "@/lib/labels"
import { eq, and, gte, lte, min, or, isNull } from "drizzle-orm"
import { getToday } from "@/lib/utils"
import { shiftDate } from "@/lib/date-utils"
import { AEROBIOLOGY_PROVIDER, HAMILTON_LOCATION } from "@/lib/pollen/constants"
import { isValidRange, RANGE_OFFSETS } from "@/lib/timeline-types"
import type { TimelineRange, GanttBarData } from "@/lib/timeline-types"
import {
  computeDailyMaxPollen,
  mergeAdjacentBars,
  buildScorecardMap,
  buildBackfillDayMaps,
  buildChartData,
} from "@/lib/timeline/aggregate"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const rangeParam = _request.nextUrl.searchParams.get("range")
    const range: TimelineRange = isValidRange(rangeParam) ? rangeParam : "30d"

    const today = getToday()
    let windowStart: string

    if (range === "all") {
      const [earliestFeeding, earliestPoop, earliestItch] = await Promise.all([
        db.select({ earliest: min(feedingPeriods.startDate) }).from(feedingPeriods).where(eq(feedingPeriods.dogId, dogId)),
        db.select({ earliest: min(poopLogs.date) }).from(poopLogs).where(eq(poopLogs.dogId, dogId)),
        db.select({ earliest: min(itchinessLogs.date) }).from(itchinessLogs).where(eq(itchinessLogs.dogId, dogId)),
      ])
      const dates = [
        earliestFeeding[0]?.earliest,
        earliestPoop[0]?.earliest,
        earliestItch[0]?.earliest,
      ].filter((d): d is string => d !== null && d !== undefined)
      const earliest = dates.length > 0 ? dates.sort()[0] : null
      const maxStart = shiftDate(today, -365)
      windowStart = earliest && earliest > maxStart ? earliest : earliest ? maxStart : shiftDate(today, -29)
    } else {
      windowStart = shiftDate(today, -(RANGE_OFFSETS[range]!))
    }

    // Fetch all data in parallel
    const [poopRows, itchRows, pollenRows, feedingRows, medRows, scorecardRows] =
      await Promise.all([
        db
          .select({ date: poopLogs.date, firmnessScore: poopLogs.firmnessScore })
          .from(poopLogs)
          .where(and(eq(poopLogs.dogId, dogId), gte(poopLogs.date, windowStart), lte(poopLogs.date, today))),

        db
          .select({ date: itchinessLogs.date, score: itchinessLogs.score })
          .from(itchinessLogs)
          .where(and(eq(itchinessLogs.dogId, dogId), gte(itchinessLogs.date, windowStart), lte(itchinessLogs.date, today))),

        db
          .select({ date: dailyPollen.date, pollenLevel: dailyPollen.pollenLevel, sporeLevel: dailyPollen.sporeLevel })
          .from(dailyPollen)
          .where(and(
            eq(dailyPollen.provider, AEROBIOLOGY_PROVIDER),
            eq(dailyPollen.location, HAMILTON_LOCATION),
            gte(dailyPollen.date, windowStart),
            lte(dailyPollen.date, today),
          )),

        // Feeding periods that overlap the window
        db
          .select({
            id: feedingPeriods.id,
            productId: feedingPeriods.productId,
            startDate: feedingPeriods.startDate,
            endDate: feedingPeriods.endDate,
            productName: products.name,
            productType: products.type,
            imageUrls: products.imageUrls,
            brandName: brands.name,
            quantity: feedingPeriods.quantity,
            quantityUnit: feedingPeriods.quantityUnit,
            isBackfill: feedingPeriods.isBackfill,
            planGroupId: feedingPeriods.planGroupId,
          })
          .from(feedingPeriods)
          .innerJoin(products, eq(feedingPeriods.productId, products.id))
          .innerJoin(brands, eq(products.brandId, brands.id))
          .where(and(
            eq(feedingPeriods.dogId, dogId),
            lte(feedingPeriods.startDate, today),
            or(isNull(feedingPeriods.endDate), gte(feedingPeriods.endDate, windowStart)),
          )),

        // Medications that overlap the window
        db
          .select({
            id: medications.id,
            name: medications.name,
            dosage: medications.dosage,
            interval: medications.interval,
            startDate: medications.startDate,
            endDate: medications.endDate,
            dosageForm: medicationProducts.dosageForm,
          })
          .from(medications)
          .leftJoin(medicationProducts, eq(medications.medicationProductId, medicationProducts.id))
          .where(and(
            eq(medications.dogId, dogId),
            lte(medications.startDate, today),
            or(isNull(medications.endDate), gte(medications.endDate, windowStart)),
          )),

        // Scorecards for this dog's backfill feeding periods
        db
          .selectDistinct({
            planGroupId: foodScorecards.planGroupId,
            poopQuality: foodScorecards.poopQuality,
            itchSeverity: foodScorecards.itchSeverity,
          })
          .from(foodScorecards)
          .innerJoin(feedingPeriods, eq(foodScorecards.planGroupId, feedingPeriods.planGroupId))
          .where(and(eq(feedingPeriods.dogId, dogId), eq(feedingPeriods.isBackfill, true))),
      ])

    // --- Aggregate data ---
    const scorecardMap = buildScorecardMap(scorecardRows)
    const { backfillPoopByDay, backfillItchByDay } = buildBackfillDayMaps(feedingRows, scorecardMap, windowStart, today)

    const worstPoopByDay = new Map<string, number>()
    for (const row of poopRows) {
      const existing = worstPoopByDay.get(row.date)
      if (existing === undefined || row.firmnessScore > existing) {
        worstPoopByDay.set(row.date, row.firmnessScore)
      }
    }

    const maxItchByDay = new Map<string, number>()
    for (const row of itchRows) {
      const existing = maxItchByDay.get(row.date)
      if (existing === undefined || row.score > existing) {
        maxItchByDay.set(row.date, row.score)
      }
    }

    // Daily max pollen (no rolling window — chart shows day-by-day)
    const dailyPollenMap = computeDailyMaxPollen(pollenRows, windowStart, today)

    // Raw pollen/spore maps for tooltip
    const rawPollenByDay = new Map<string, number>()
    const rawSporeByDay = new Map<string, number>()
    for (const row of pollenRows) {
      rawPollenByDay.set(row.date, Math.max(rawPollenByDay.get(row.date) ?? 0, row.pollenLevel))
      if (row.sporeLevel !== null) {
        rawSporeByDay.set(row.date, Math.max(rawSporeByDay.get(row.date) ?? 0, row.sporeLevel))
      }
    }

    const chartData = buildChartData(
      windowStart, today,
      worstPoopByDay, backfillPoopByDay,
      maxItchByDay, backfillItchByDay,
      dailyPollenMap, rawPollenByDay, rawSporeByDay,
    )

    // --- Build Gantt bars ---
    const ganttBars: GanttBarData[] = []

    for (const fp of feedingRows) {
      const periodEnd = fp.endDate ?? today
      if (fp.productType === "treat") continue

      const category: "food" | "supplement" =
        fp.productType === "supplement" ? "supplement" : "food"

      ganttBars.push({
        id: fp.id,
        label: fp.productName,
        startDate: fp.startDate,
        endDate: periodEnd,
        category,
        meta: {
          brandName: fp.brandName,
          quantity: fp.quantity ?? undefined,
          quantityUnit: fp.quantityUnit ?? undefined,
          imageUrl: fp.imageUrls?.[0] ?? undefined,
        },
      })
    }

    for (const med of medRows) {
      const medEnd = med.endDate ?? today
      const label = med.dosage ? `${med.name} ${med.dosage}` : med.name
      ganttBars.push({
        id: med.id,
        label,
        startDate: med.startDate,
        endDate: medEnd,
        category: "medication",
        meta: {
          dosage: med.dosage ?? undefined,
          interval: med.interval ? (DOSING_INTERVAL_LABELS[med.interval] ?? med.interval) : undefined,
          dosageForm: med.dosageForm ?? undefined,
        },
      })
    }

    const mergedBars = mergeAdjacentBars(ganttBars)

    return NextResponse.json({
      chartData,
      ganttBars: mergedBars,
      startDate: windowStart,
      endDate: today,
    })
  } catch (error) {
    console.error("Error fetching timeline data:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
