import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, poopLogs, itchinessLogs, treatLogs, products, brands } from "@/lib/db"
import { eq, desc, and, gte, lte, sql } from "drizzle-orm"
import type { LogFeedEntry } from "@/lib/types"

type RouteParams = { params: Promise<{ id: string }> }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 90
const QUERY_LIMIT = 500

export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const { searchParams } = request.nextUrl
    const rawDays = parseInt(searchParams.get("days") ?? "7", 10)
    const days = Number.isNaN(rawDays) ? 7 : Math.min(Math.max(rawDays, 1), MAX_DAYS)
    const before = searchParams.get("before")

    if (before && !DATE_RE.test(before)) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 })
    }

    const endDate = before ?? new Date().toISOString().split("T")[0]
    const startDate = new Date(
      new Date(endDate).getTime() - (days - 1) * 24 * 60 * 60 * 1000,
    ).toISOString().split("T")[0]

    const [poopRows, itchRows, treatRows] = await Promise.all([
      db
        .select({
          id: poopLogs.id,
          date: poopLogs.date,
          datetime: poopLogs.datetime,
          firmnessScore: poopLogs.firmnessScore,
          notes: poopLogs.notes,
        })
        .from(poopLogs)
        .where(
          and(
            eq(poopLogs.dogId, dogId),
            gte(poopLogs.date, startDate),
            lte(poopLogs.date, endDate),
          ),
        )
        .orderBy(desc(poopLogs.datetime), desc(poopLogs.createdAt))
        .limit(QUERY_LIMIT),
      db
        .select({
          id: itchinessLogs.id,
          date: itchinessLogs.date,
          datetime: itchinessLogs.datetime,
          score: itchinessLogs.score,
          bodyAreas: itchinessLogs.bodyAreas,
          notes: itchinessLogs.notes,
        })
        .from(itchinessLogs)
        .where(
          and(
            eq(itchinessLogs.dogId, dogId),
            gte(itchinessLogs.date, startDate),
            lte(itchinessLogs.date, endDate),
          ),
        )
        .orderBy(desc(itchinessLogs.datetime), desc(itchinessLogs.createdAt))
        .limit(QUERY_LIMIT),
      db
        .select({
          id: treatLogs.id,
          date: treatLogs.date,
          datetime: treatLogs.datetime,
          productId: treatLogs.productId,
          productName: products.name,
          brandId: products.brandId,
          brandName: brands.name,
          imageUrl: sql<string | null>`${products.imageUrls}[1]`,
          quantity: treatLogs.quantity,
          quantityUnit: treatLogs.quantityUnit,
        })
        .from(treatLogs)
        .leftJoin(products, eq(treatLogs.productId, products.id))
        .leftJoin(brands, eq(products.brandId, brands.id))
        .where(
          and(
            eq(treatLogs.dogId, dogId),
            gte(treatLogs.date, startDate),
            lte(treatLogs.date, endDate),
          ),
        )
        .orderBy(desc(treatLogs.datetime), desc(treatLogs.createdAt))
        .limit(QUERY_LIMIT),
    ])

    const entries: LogFeedEntry[] = [
      ...poopRows.map((r) => ({
        id: r.id,
        type: "poop" as const,
        date: r.date,
        datetime: r.datetime?.toISOString() ?? null,
        data: { firmnessScore: r.firmnessScore, notes: r.notes },
      })),
      ...itchRows.map((r) => ({
        id: r.id,
        type: "itch" as const,
        date: r.date,
        datetime: r.datetime?.toISOString() ?? null,
        data: { score: r.score, bodyAreas: r.bodyAreas, notes: r.notes },
      })),
      ...treatRows.map((r) => ({
        id: r.id,
        type: "treat" as const,
        date: r.date,
        datetime: r.datetime?.toISOString() ?? null,
        data: {
          productId: r.productId,
          productName: r.productName ?? "Unknown treat",
          brandId: r.brandId,
          brandName: r.brandName,
          imageUrl: r.imageUrl,
          quantity: r.quantity,
          quantityUnit: r.quantityUnit,
        },
      })),
    ]

    // Sort by datetime desc, then date desc
    entries.sort((a, b) => {
      const dtA = a.datetime ?? `${a.date}T23:59:59Z`
      const dtB = b.datetime ?? `${b.date}T23:59:59Z`
      return dtB.localeCompare(dtA)
    })

    return NextResponse.json({
      entries,
      startDate,
      endDate,
    })
  } catch (error) {
    console.error("Error fetching recent logs:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
