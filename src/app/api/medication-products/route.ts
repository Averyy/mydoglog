import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, medicationProducts } from "@/lib/db"
import { asc } from "drizzle-orm"

export async function GET(): Promise<NextResponse> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const rows = await db
      .select()
      .from(medicationProducts)
      .orderBy(asc(medicationProducts.name))

    return NextResponse.json(rows)
  } catch (error) {
    console.error("Error fetching medication products:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
