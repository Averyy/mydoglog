import { NextRequest, NextResponse } from "next/server"
import { db, products, brands } from "@/lib/db"
import { and, eq, or, sql, count } from "drizzle-orm"

const TYPE_KEYWORDS: Record<string, string> = {
  can: "wet_food",
  cans: "wet_food",
  wet: "wet_food",
  canned: "wet_food",
  dry: "dry_food",
  kibble: "dry_food",
  kibbles: "dry_food",
  bag: "dry_food",
  bags: "dry_food",
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl
    const q = searchParams.get("q")
    const type = searchParams.get("type")
    const channel = searchParams.get("channel")
    const brandId = searchParams.get("brand_id")
    const includeDiscontinued = searchParams.get("include_discontinued") === "true"
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20")))
    const offset = (page - 1) * limit

    const conditions = []

    if (!includeDiscontinued) {
      conditions.push(eq(products.isDiscontinued, false))
    }
    if (q) {
      const words = q.trim().split(/\s+/).filter(Boolean)
      for (const word of words) {
        const lower = word.toLowerCase()
        const mappedType = TYPE_KEYWORDS[lower]
        // Strip apostrophes/punctuation for fuzzy matching (hills → hill's)
        const stripped = word.replace(/['']/g, "")
        const nameOrBrand = or(
          sql`replace(lower(${products.name}), '''', '') ILIKE ${"%" + stripped.toLowerCase() + "%"}`,
          sql`replace(lower(${brands.name}), '''', '') ILIKE ${"%" + stripped.toLowerCase() + "%"}`,
        )!
        if (mappedType) {
          conditions.push(
            or(nameOrBrand, sql`${products.type} = ${mappedType}`)!,
          )
        } else {
          conditions.push(nameOrBrand)
        }
      }
    }
    if (type) {
      conditions.push(sql`${products.type} = ${type}`)
    }
    if (channel) {
      conditions.push(sql`${products.channel} = ${channel}`)
    }
    if (brandId) {
      conditions.push(eq(products.brandId, brandId))
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [items, [totalResult]] = await Promise.all([
      db
        .select({
          id: products.id,
          name: products.name,
          brandName: brands.name,
          brandId: products.brandId,
          type: products.type,
          channel: products.channel,
          lifestage: products.lifestage,
          imageUrl: sql<string | null>`${products.imageUrls}[1]`,
          isDiscontinued: products.isDiscontinued,
          calorieContent: products.calorieContent,
        })
        .from(products)
        .innerJoin(brands, eq(products.brandId, brands.id))
        .where(where)
        .orderBy(products.name)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: count() })
        .from(products)
        .innerJoin(brands, eq(products.brandId, brands.id))
        .where(where),
    ])

    return NextResponse.json({
      items,
      total: totalResult.count,
      page,
      limit,
      totalPages: Math.ceil(totalResult.count / limit),
    })
  } catch (error) {
    console.error("Error fetching products:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
