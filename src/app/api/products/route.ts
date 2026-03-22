import { NextRequest, NextResponse } from "next/server"
import { db, products, brands } from "@/lib/db"
import { and, eq, or, sql, count } from "drizzle-orm"
import { FORMAT_KEYWORDS } from "@/lib/labels"

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl
    const q = searchParams.get("q")
    const type = searchParams.get("type")
    const channel = searchParams.get("channel")
    const brandId = searchParams.get("brand_id")
    const includeDiscontinued = searchParams.get("include_discontinued") === "true"
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)))
    const offset = (page - 1) * limit

    const all = searchParams.get("all") === "true"

    const conditions = []

    if (!includeDiscontinued) {
      conditions.push(eq(products.isDiscontinued, false))
    }
    if (q) {
      const words = q.trim().split(/\s+/).filter(Boolean)
      for (const word of words) {
        const lower = word.toLowerCase()
        const mappedFormat = FORMAT_KEYWORDS[lower]
        if (mappedFormat) {
          // Exact format keyword — filter by format only, don't match name
          conditions.push(sql`${products.format} = ${mappedFormat}`)
        } else {
          // Strip apostrophes/punctuation for fuzzy matching (hills → hill's)
          const stripped = word.replace(/['']/g, "")
          const escaped = stripped.toLowerCase().replace(/[%_\\]/g, "\\$&")
          conditions.push(
            or(
              sql`replace(lower(${products.name}), '''', '') ILIKE ${"%" + escaped + "%"}`,
              sql`replace(lower(${brands.name}), '''', '') ILIKE ${"%" + escaped + "%"}`,
            )!,
          )
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

    const selectFields = {
      id: products.id,
      name: products.name,
      brandName: brands.name,
      brandId: products.brandId,
      type: products.type,
      format: products.format,
      channel: products.channel,
      lifestage: products.lifestage,
      imageUrl: sql<string | null>`${products.imageUrls}[1]`,
      isDiscontinued: products.isDiscontinued,
      calorieContent: products.calorieContent,
    }

    if (all) {
      const items = await db
        .select(selectFields)
        .from(products)
        .innerJoin(brands, eq(products.brandId, brands.id))
        .where(where)
        .orderBy(products.name)

      return NextResponse.json({ items }, {
        headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
      })
    }

    const [items, [totalResult]] = await Promise.all([
      db
        .select(selectFields)
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
