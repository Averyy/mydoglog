import { NextRequest, NextResponse } from "next/server"
import { db, dogs, pollenLogs } from "@/lib/db"
import { sql } from "drizzle-orm"

const AMBEE_API_URL = "https://api.ambeedata.com/latest/pollen/by-place"

interface AmbeePollenResponse {
  data: Array<{
    Count: {
      grass_pollen: number
      tree_pollen: number
      weed_pollen: number
    }
    Risk: {
      grass_pollen: string
      tree_pollen: string
      weed_pollen: string
    }
  }>
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Verify CRON_SECRET
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret) {
      return NextResponse.json(
        { error: "CRON_SECRET not configured" },
        { status: 500 },
      )
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const ambeeApiKey = process.env.AMBEE_API_KEY
    if (!ambeeApiKey) {
      return NextResponse.json(
        { error: "AMBEE_API_KEY not configured" },
        { status: 500 },
      )
    }

    const today = new Date().toISOString().split("T")[0]

    // Get unique dog locations
    const locationsResult = await db
      .selectDistinct({ location: dogs.location })
      .from(dogs)
      .where(sql`${dogs.location} IS NOT NULL AND ${dogs.location} != ''`)

    const locations = locationsResult
      .map((r) => r.location)
      .filter((l): l is string => l !== null)

    let processed = 0
    let skipped = 0

    for (const location of locations) {
      // Check if we already have data for today
      const [existing] = await db
        .select({ id: pollenLogs.id })
        .from(pollenLogs)
        .where(
          sql`${pollenLogs.location} = ${location} AND ${pollenLogs.date} = ${today}`,
        )

      if (existing) {
        skipped++
        continue
      }

      try {
        const url = new URL(AMBEE_API_URL)
        url.searchParams.set("place", location)

        const response = await fetch(url.toString(), {
          headers: {
            "x-api-key": ambeeApiKey,
            "Content-type": "application/json",
          },
        })

        if (!response.ok) {
          console.error(
            `Ambee API error for ${location}: ${response.status}`,
          )
          skipped++
          continue
        }

        const data = (await response.json()) as AmbeePollenResponse

        if (!data.data?.[0]) {
          skipped++
          continue
        }

        const pollen = data.data[0]
        const totalPollen =
          pollen.Count.grass_pollen +
          pollen.Count.tree_pollen +
          pollen.Count.weed_pollen

        await db.insert(pollenLogs).values({
          location,
          date: today,
          pollenIndex: String(totalPollen),
          pollenTypes: {
            grass: { count: pollen.Count.grass_pollen, risk: pollen.Risk.grass_pollen },
            tree: { count: pollen.Count.tree_pollen, risk: pollen.Risk.tree_pollen },
            weed: { count: pollen.Count.weed_pollen, risk: pollen.Risk.weed_pollen },
          },
          sourceApi: "ambee",
        })

        processed++
      } catch (error) {
        console.error(`Error fetching pollen for ${location}:`, error)
        skipped++
      }
    }

    return NextResponse.json({ processed, skipped })
  } catch (error) {
    console.error("Pollen cron error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
