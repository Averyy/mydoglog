import { NextResponse } from "next/server"
import { db, brands, products } from "@/lib/db"
import { count, desc, sql } from "drizzle-orm"

export async function GET(): Promise<NextResponse> {
  try {
    const result = await db
      .select({
        id: brands.id,
        name: brands.name,
        websiteUrl: brands.websiteUrl,
        country: brands.country,
        logoUrl: brands.logoUrl,
        productCount: count(products.id),
      })
      .from(brands)
      .leftJoin(
        products,
        sql`${products.brandId} = ${brands.id} AND ${products.isDiscontinued} = false`,
      )
      .groupBy(brands.id)
      .orderBy(desc(count(products.id)))

    return NextResponse.json(result)
  } catch (error) {
    console.error("Error fetching brands:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
