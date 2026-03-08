import { NextRequest, NextResponse } from "next/server"
import { db, products, brands } from "@/lib/db"
import { and, eq, or, sql, count } from "drizzle-orm"

const FORMAT_KEYWORDS: Record<string, string> = {
  can: "wet",
  cans: "wet",
  wet: "wet",
  canned: "wet",
  dry: "dry",
  kibble: "dry",
  kibbles: "dry",
  bag: "dry",
  bags: "dry",
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
        // Strip apostrophes/punctuation for fuzzy matching (hills → hill's)
        const stripped = word.replace(/['']/g, "")
        const nameOrBrand = or(
          sql`replace(lower(${products.name}), '''', '') ILIKE ${"%" + stripped.toLowerCase() + "%"}`,
          sql`replace(lower(${brands.name}), '''', '') ILIKE ${"%" + stripped.toLowerCase() + "%"}`,
        )!
        if (mappedFormat) {
          conditions.push(
            or(nameOrBrand, sql`${products.format} = ${mappedFormat}`)!,
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

      return NextResponse.json({ items })
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
