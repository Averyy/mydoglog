import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, feedingPeriods, products, brands, foodScorecards } from "@/lib/db"
import { eq, desc, sql } from "drizzle-orm"
import type { FeedingPlanGroup, FeedingPlanItem } from "@/lib/types"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id } = await params
    const authResult = await requireDogOwnership(id)
    if (isNextResponse(authResult)) return authResult

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

      // Use earliest startDate, latest endDate for the group
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
            planGroupIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )

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
    }

    return NextResponse.json([...groupMap.values()])
  } catch (error) {
    console.error("Error fetching feeding plans:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}

interface FeedingPostItem {
  productId: string
  quantity: string
  quantityUnit: string
  mealSlot?: string
}

interface FeedingPostBody {
  mode: "today" | "starting_today" | "date_range"
  items: FeedingPostItem[]
  planName?: string
  startDate?: string
  endDate?: string
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const body = (await request.json()) as FeedingPostBody

    if (!body.mode || !body.items?.length) {
      return NextResponse.json(
        { error: "mode and items are required" },
        { status: 400 },
      )
    }

    for (const item of body.items) {
      if (!item.quantity || !item.quantityUnit) {
        return NextResponse.json(
          { error: "quantity and quantityUnit are required for each item" },
          { status: 400 },
        )
      }
    }

    const today = new Date().toISOString().split("T")[0]
    const planGroupId = crypto.randomUUID()

    let startDate: string
    let endDate: string | null

    switch (body.mode) {
      case "today":
        startDate = today
        endDate = today
        break
      case "starting_today":
        startDate = today
        endDate = null
        break
      case "date_range":
        if (!body.startDate || !body.endDate) {
          return NextResponse.json(
            { error: "startDate and endDate required for date_range mode" },
            { status: 400 },
          )
        }
        startDate = body.startDate
        endDate = body.endDate
        break
      default:
        return NextResponse.json({ error: "Invalid mode" }, { status: 400 })
    }

    // If starting_today, auto-end existing ongoing plans
    if (body.mode === "starting_today") {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().split("T")[0]

      await db
        .update(feedingPeriods)
        .set({ endDate: yesterdayStr, updatedAt: new Date() })
        .where(
          sql`${feedingPeriods.dogId} = ${dogId} AND ${feedingPeriods.endDate} IS NULL`,
        )
    }

    // Create feeding period rows for each item
    const rows = body.items.map((item) => ({
      dogId,
      productId: item.productId,
      startDate,
      endDate,
      mealSlot: item.mealSlot as
        | "breakfast"
        | "lunch"
        | "dinner"
        | "snack"
        | undefined,
      quantity: item.quantity,
      quantityUnit: item.quantityUnit as
        | "can"
        | "cup"
        | "g"
        | "scoop"
        | "piece"
        | "tbsp"
        | "tsp"
        | "ml"
        | "treat",
      planGroupId,
      planName: body.planName ?? null,
      isBackfill: false,
    }))

    const created = await db.insert(feedingPeriods).values(rows).returning()

    return NextResponse.json({ planGroupId, items: created }, { status: 201 })
  } catch (error) {
    console.error("Error creating feeding plan:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
