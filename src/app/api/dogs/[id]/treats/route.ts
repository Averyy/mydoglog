import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, treatLogs, products, brands } from "@/lib/db"
import { eq, desc, sql } from "drizzle-orm"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const { searchParams } = request.nextUrl
    const recent = searchParams.get("recent")

    if (recent) {
      // Return N most recent distinct products
      const limit = Math.min(10, Math.max(1, parseInt(recent)))
      const recentProducts = await db
        .selectDistinctOn([treatLogs.productId], {
          productId: treatLogs.productId,
          productName: products.name,
          brandName: brands.name,
          brandId: products.brandId,
          type: products.type,
          channel: products.channel,
          lifestage: products.lifestage,
          imageUrl: sql<string | null>`${products.imageUrls}[1]`,
          isDiscontinued: products.isDiscontinued,
          lastUsed: treatLogs.createdAt,
        })
        .from(treatLogs)
        .innerJoin(products, eq(treatLogs.productId, products.id))
        .innerJoin(brands, eq(products.brandId, brands.id))
        .where(eq(treatLogs.dogId, dogId))
        .orderBy(treatLogs.productId, desc(treatLogs.createdAt))
        .limit(limit)

      return NextResponse.json(recentProducts)
    }

    const logs = await db
      .select({
        id: treatLogs.id,
        productId: treatLogs.productId,
        productName: products.name,
        brandName: brands.name,
        date: treatLogs.date,
        datetime: treatLogs.datetime,
        quantity: treatLogs.quantity,
        quantityUnit: treatLogs.quantityUnit,
        notes: treatLogs.notes,
        createdAt: treatLogs.createdAt,
        imageUrl: sql<string | null>`${products.imageUrls}[1]`,
      })
      .from(treatLogs)
      .innerJoin(products, eq(treatLogs.productId, products.id))
      .innerJoin(brands, eq(products.brandId, brands.id))
      .where(eq(treatLogs.dogId, dogId))
      .orderBy(desc(treatLogs.date), desc(treatLogs.createdAt))

    return NextResponse.json(logs)
  } catch (error) {
    console.error("Error fetching treat logs:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}

interface TreatPostBody {
  productId: string
  date: string
  datetime?: string
  quantity: string
  quantityUnit: string
  notes?: string
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const body = (await request.json()) as TreatPostBody

    if (!body.productId || !body.date) {
      return NextResponse.json(
        { error: "productId and date are required" },
        { status: 400 },
      )
    }

    if (!body.quantity || !body.quantityUnit) {
      return NextResponse.json(
        { error: "quantity and quantityUnit are required" },
        { status: 400 },
      )
    }

    const [created] = await db
      .insert(treatLogs)
      .values({
        dogId,
        productId: body.productId,
        date: body.date,
        datetime: body.datetime ? new Date(body.datetime) : null,
        quantity: body.quantity,
        quantityUnit: body.quantityUnit as
          | "can"
          | "cup"
          | "g"
          | "scoop"
          | "piece"
          | "tbsp"
          | "tsp"
          | "ml"
          | "treat",
        notes: body.notes?.trim() ?? null,
      })
      .returning()

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    console.error("Error creating treat log:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
