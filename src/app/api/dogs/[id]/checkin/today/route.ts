import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, poopLogs, itchinessLogs, treatLogs, products, brands } from "@/lib/db"
import { and, eq, desc, sql } from "drizzle-orm"
import { format } from "date-fns"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const today = format(new Date(), "yyyy-MM-dd")

    const [poopRows, itchRows, treatRows] = await Promise.all([
      db
        .select({
          id: poopLogs.id,
          firmnessScore: poopLogs.firmnessScore,
          notes: poopLogs.notes,
        })
        .from(poopLogs)
        .where(and(eq(poopLogs.dogId, dogId), eq(poopLogs.date, today)))
        .orderBy(desc(poopLogs.createdAt)),
      db
        .select({
          id: itchinessLogs.id,
          score: itchinessLogs.score,
          bodyAreas: itchinessLogs.bodyAreas,
          notes: itchinessLogs.notes,
        })
        .from(itchinessLogs)
        .where(and(eq(itchinessLogs.dogId, dogId), eq(itchinessLogs.date, today)))
        .orderBy(desc(itchinessLogs.createdAt)),
      db
        .select({
          id: treatLogs.id,
          productId: treatLogs.productId,
          productName: products.name,
          brandName: brands.name,
          imageUrl: sql<string | null>`${products.imageUrls}[1]`,
          quantity: treatLogs.quantity,
          quantityUnit: treatLogs.quantityUnit,
        })
        .from(treatLogs)
        .innerJoin(products, eq(treatLogs.productId, products.id))
        .innerJoin(brands, eq(products.brandId, brands.id))
        .where(and(eq(treatLogs.dogId, dogId), eq(treatLogs.date, today)))
        .orderBy(desc(treatLogs.createdAt)),
    ])

    return NextResponse.json({
      poopEntries: poopRows,
      itchinessEntries: itchRows,
      treats: treatRows,
    })
  } catch (error) {
    console.error("Error fetching today's check-in:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
