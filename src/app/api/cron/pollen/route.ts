import { NextRequest, NextResponse } from "next/server"
import { db, dogs, dailyPollen } from "@/lib/db"
import { eq, and, sql, desc } from "drizzle-orm"
import { getToday } from "@/lib/utils"
import {
  HAMILTON_LOCATION_ID,
  TWN_NIAGARA_LOCATION_ID,
  HAMILTON_LOCATION,
  NIAGARA_LOCATION,
  AEROBIOLOGY_PROVIDER,
  TWN_PROVIDER,
  VALID_SOURCES,
} from "@/lib/pollen/constants"

const POLLEN_SPARR_BASE = "https://pollen.mydoglog.ca"
const BACKFILL_START = "2026-02-23" // earliest data available in pollen-sparr
const MAX_READINGS = 1000 // sanity cap on readings per provider

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

interface PollenSparrReading {
  location_id: number
  date: string
  provider: string
  source: string
  pollen_level: number
  total_trees: number | null
  total_grasses: number | null
  total_weeds: number | null
  total_spores: number | null
  out_of_season: number
  species: Array<{
    name: string
    scientific_name: string | null
    type: string
    level: number | null
  }> | string[]
}

interface ProviderConfig {
  locationId: number
  provider: string
  locationSlug: string
}

const PROVIDERS: ProviderConfig[] = [
  { locationId: HAMILTON_LOCATION_ID, provider: AEROBIOLOGY_PROVIDER, locationSlug: HAMILTON_LOCATION },
  { locationId: TWN_NIAGARA_LOCATION_ID, provider: TWN_PROVIDER, locationSlug: NIAGARA_LOCATION },
]

function validateReading(reading: PollenSparrReading): boolean {
  if (!DATE_REGEX.test(reading.date)) return false
  if (typeof reading.pollen_level !== "number") return false
  if (!VALID_SOURCES.has(reading.source)) return false
  return true
}

function mapTopAllergens(
  species: PollenSparrReading["species"],
): Array<{ name: string; scientificName: string | null; type: string; level: number | null }> {
  if (!Array.isArray(species) || species.length === 0) return []
  return species
    .filter((s) => {
      if (typeof s === "string") return true
      return s.level != null && s.level > 0
    })
    .map((s) => {
      if (typeof s === "string") {
        return { name: s, scientificName: null, type: "pollen", level: null }
      }
      return {
        name: s.name,
        scientificName: s.scientific_name,
        type: s.type,
        level: s.level,
      }
    })
}

async function getLastDate(provider: string, location: string): Promise<string | null> {
  const [row] = await db
    .select({ date: dailyPollen.date })
    .from(dailyPollen)
    .where(
      and(
        eq(dailyPollen.provider, provider),
        eq(dailyPollen.location, location),
      ),
    )
    .orderBy(desc(dailyPollen.date))
    .limit(1)
  return row?.date ?? null
}

async function fetchAndUpsert(config: ProviderConfig, today: string): Promise<{ status: string; processed: number; skipped: number }> {
  const lastDate = await getLastDate(config.provider, config.locationSlug)
  const fromDate = lastDate ?? BACKFILL_START

  const url = `${POLLEN_SPARR_BASE}/api/locations/${config.locationId}/readings?from=${fromDate}&to=${today}`
  const response = await fetch(url)

  if (!response.ok) {
    return { status: `error: HTTP ${response.status}`, processed: 0, skipped: 0 }
  }

  const body = await response.json() as { readings?: PollenSparrReading[] } | PollenSparrReading[]
  const readings = Array.isArray(body) ? body : (body.readings ?? [])

  if (readings.length === 0) {
    return { status: "ok", processed: 0, skipped: 0 }
  }

  if (readings.length > MAX_READINGS) {
    return { status: `error: too many readings (${readings.length})`, processed: 0, skipped: 0 }
  }

  // Validate and collect rows
  const validRows: Array<{ row: typeof dailyPollen.$inferInsert; source: string }> = []
  let skipped = 0

  for (const reading of readings) {
    if (!validateReading(reading)) {
      skipped++
      continue
    }

    validRows.push({
      row: {
        provider: config.provider,
        location: config.locationSlug,
        date: reading.date,
        pollenLevel: reading.pollen_level,
        sporeLevel: reading.total_spores ?? null,
        totalTrees: reading.total_trees ?? null,
        totalGrasses: reading.total_grasses ?? null,
        totalWeeds: reading.total_weeds ?? null,
        topAllergens: mapTopAllergens(reading.species),
        source: reading.source,
        outOfSeason: reading.out_of_season === 1,
      },
      source: reading.source,
    })
  }

  if (validRows.length === 0) {
    return { status: "ok", processed: 0, skipped }
  }

  // Batch upsert: build multi-row VALUES clause
  const valuesClauses = validRows.map(({ row }) =>
    sql`(gen_random_uuid()::text, ${row.provider}, ${row.location}, ${row.date}, ${row.pollenLevel}, ${row.sporeLevel}, ${row.totalTrees}, ${row.totalGrasses}, ${row.totalWeeds}, ${JSON.stringify(row.topAllergens)}::jsonb, ${row.source}, ${row.outOfSeason}, now())`,
  )

  await db.execute(sql`
    INSERT INTO daily_pollen (
      id, provider, location, date, pollen_level, spore_level,
      total_trees, total_grasses, total_weeds, top_allergens,
      source, out_of_season, created_at
    ) VALUES ${sql.join(valuesClauses, sql`, `)}
    ON CONFLICT (provider, location, date) DO UPDATE SET
      pollen_level = CASE WHEN daily_pollen.source = 'actual' AND EXCLUDED.source != 'actual' THEN daily_pollen.pollen_level ELSE EXCLUDED.pollen_level END,
      spore_level = CASE WHEN daily_pollen.source = 'actual' AND EXCLUDED.source != 'actual' THEN daily_pollen.spore_level ELSE EXCLUDED.spore_level END,
      total_trees = CASE WHEN daily_pollen.source = 'actual' AND EXCLUDED.source != 'actual' THEN daily_pollen.total_trees ELSE EXCLUDED.total_trees END,
      total_grasses = CASE WHEN daily_pollen.source = 'actual' AND EXCLUDED.source != 'actual' THEN daily_pollen.total_grasses ELSE EXCLUDED.total_grasses END,
      total_weeds = CASE WHEN daily_pollen.source = 'actual' AND EXCLUDED.source != 'actual' THEN daily_pollen.total_weeds ELSE EXCLUDED.total_weeds END,
      top_allergens = CASE WHEN daily_pollen.source = 'actual' AND EXCLUDED.source != 'actual' THEN daily_pollen.top_allergens ELSE EXCLUDED.top_allergens END,
      source = CASE WHEN daily_pollen.source = 'actual' AND EXCLUDED.source != 'actual' THEN daily_pollen.source ELSE EXCLUDED.source END,
      out_of_season = CASE WHEN daily_pollen.source = 'actual' AND EXCLUDED.source != 'actual' THEN daily_pollen.out_of_season ELSE EXCLUDED.out_of_season END
  `)

  return { status: "ok", processed: validRows.length, skipped }
}

function formatError(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  return String(reason)
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

    // Check if any dog has environmentEnabled
    const [enabledDog] = await db
      .select({ id: dogs.id })
      .from(dogs)
      .where(eq(dogs.environmentEnabled, true))
      .limit(1)

    if (!enabledDog) {
      return NextResponse.json({ status: "skipped", reason: "no dogs with pollen tracking enabled" })
    }

    const today = getToday()

    // Fetch both providers in parallel
    const results = await Promise.allSettled(
      PROVIDERS.map((config) => fetchAndUpsert(config, today)),
    )

    const [aeroResult, twnResult] = results

    return NextResponse.json({
      pollenAero:
        aeroResult.status === "fulfilled"
          ? aeroResult.value
          : { status: `error: ${formatError(aeroResult.reason)}`, processed: 0, skipped: 0 },
      pollenTwn:
        twnResult.status === "fulfilled"
          ? twnResult.value
          : { status: `error: ${formatError(twnResult.reason)}`, processed: 0, skipped: 0 },
    })
  } catch (error) {
    console.error("Pollen cron error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
