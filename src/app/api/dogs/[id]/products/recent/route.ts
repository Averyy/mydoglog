import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db } from "@/lib/db"
import { sql } from "drizzle-orm"

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
    const type = searchParams.get("type")

    // Build type filter join condition
    const typeFilter = type
      ? sql`AND p.type = ${type}`
      : sql``

    const result = await db.execute(sql`
      WITH recent AS (
        SELECT fp.product_id, MAX(COALESCE(fp.end_date, CURRENT_DATE)) AS last_used
        FROM feeding_periods fp
        JOIN products p ON p.id = fp.product_id
        WHERE fp.dog_id = ${dogId}
          AND (fp.start_date != fp.end_date OR fp.end_date IS NULL)
          ${typeFilter}
        GROUP BY fp.product_id

        UNION ALL

        SELECT tl.product_id, MAX(tl.date)::date AS last_used
        FROM treat_logs tl
        JOIN products p ON p.id = tl.product_id
        WHERE tl.dog_id = ${dogId} ${typeFilter}
        GROUP BY tl.product_id
      )
      SELECT product_id
      FROM recent
      GROUP BY product_id
      ORDER BY MAX(last_used) DESC
      LIMIT 20
    `)

    const productIds = (result.rows as { product_id: string }[]).map(
      (r) => r.product_id,
    )

    return NextResponse.json(productIds)
  } catch (error) {
    console.error("Error fetching recent products:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
