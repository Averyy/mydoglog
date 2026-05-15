import { NextRequest, NextResponse } from "next/server"
import { db, dogs, dailyPollen } from "@/lib/db"
import { eq, and, sql, desc } from "drizzle-orm"
import { getToday } from "@/lib/utils"
import {
  POLLEN_SPARR_BASE,
  POLLEN_LAT,
  POLLEN_LNG,
  POLLEN_BACKFILL_START,
  POLLEN_MAX_READINGS,
  makeLocationSlug,
} from "@/lib/pollen/constants"

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

interface PollenSparrSpecies {
  name: string
  scientific_name: string | null
  type: string
  level: number | null
}

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
  species: Array<PollenSparrSpecies> | string[]
}

interface PollenSparrLocation {
  id: number
  provider: string
  external_id: string
  name: string
  province: string
  lat: number
  lng: number
  distance_km?: number
}

interface ActiveStation {
  id: number
  provider: string
  locationSlug: string
}

function validateReading(reading: unknown): reading is PollenSparrReading {
  if (typeof reading !== "object" || reading === null) return false
  const r = reading as Record<string, unknown>
  if (typeof r.date !== "string" || !DATE_REGEX.test(r.date)) return false
  if (typeof r.pollen_level !== "number") return false
  return true
}

function mapTopAllergens(
  species: PollenSparrReading["species"] | undefined,
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

async function resolveNearestStation(): Promise<ActiveStation> {
  const url = `${POLLEN_SPARR_BASE}/api/nearest?lat=${POLLEN_LAT}&lng=${POLLEN_LNG}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`nearest lookup failed: HTTP ${response.status}`)
  }
  const body = (await response.json()) as { location?: PollenSparrLocation }
  const loc = body?.location
  if (!loc || typeof loc.id !== "number" || typeof loc.provider !== "string") {
    throw new Error("nearest lookup returned no usable location")
  }
  return {
    id: loc.id,
    provider: loc.provider,
    locationSlug: makeLocationSlug(loc.name, loc.province),
  }
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

async function fetchAndUpsert(
  station: ActiveStation,
  today: string,
): Promise<{ status: string; provider: string; location: string; processed: number; skipped: number }> {
  const lastDate = await getLastDate(station.provider, station.locationSlug)
  const fromDate = lastDate ?? POLLEN_BACKFILL_START

  const url = `${POLLEN_SPARR_BASE}/api/locations/${station.id}/readings?from=${fromDate}&to=${today}`
  const response = await fetch(url)

  if (!response.ok) {
    return {
      status: `error: HTTP ${response.status}`,
      provider: station.provider,
      location: station.locationSlug,
      processed: 0,
      skipped: 0,
    }
  }

  const body = (await response.json()) as { readings?: unknown[] } | unknown[]
  const rawReadings: unknown[] = Array.isArray(body)
    ? body
    : Array.isArray(body?.readings)
      ? body.readings
      : []

  if (rawReadings.length === 0) {
    return {
      status: "ok",
      provider: station.provider,
      location: station.locationSlug,
      processed: 0,
      skipped: 0,
    }
  }

  if (rawReadings.length > POLLEN_MAX_READINGS) {
    return {
      status: `error: too many readings (${rawReadings.length})`,
      provider: station.provider,
      location: station.locationSlug,
      processed: 0,
      skipped: 0,
    }
  }

  const validRows: Array<{ row: typeof dailyPollen.$inferInsert }> = []
  let skipped = 0

  for (const reading of rawReadings) {
    if (!validateReading(reading)) {
      skipped++
      continue
    }

    validRows.push({
      row: {
        provider: station.provider,
        location: station.locationSlug,
        date: reading.date,
        pollenLevel: reading.pollen_level,
        sporeLevel: reading.total_spores ?? null,
        totalTrees: reading.total_trees ?? null,
        totalGrasses: reading.total_grasses ?? null,
        totalWeeds: reading.total_weeds ?? null,
        topAllergens: mapTopAllergens(reading.species),
        source: typeof reading.source === "string" ? reading.source : "unknown",
        outOfSeason: reading.out_of_season === 1,
      },
    })
  }

  if (validRows.length === 0) {
    return {
      status: "ok",
      provider: station.provider,
      location: station.locationSlug,
      processed: 0,
      skipped,
    }
  }

  const valuesClauses = validRows.map(({ row }) =>
    sql`(gen_random_uuid()::text, ${row.provider}, ${row.location}, ${row.date}, ${row.pollenLevel}, ${row.sporeLevel}, ${row.totalTrees}, ${row.totalGrasses}, ${row.totalWeeds}, ${JSON.stringify(row.topAllergens)}::jsonb, ${row.source}, ${row.outOfSeason}, now())`,
  )

  // Prefer "actual" over forecast/today/etc. when re-upserting — actual readings
  // never get overwritten by anything else. The "actual" label is the one stable
  // source value we depend on; all other source strings flow through as-is.
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

  return {
    status: "ok",
    provider: station.provider,
    location: station.locationSlug,
    processed: validRows.length,
    skipped,
  }
}

function formatError(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  return String(reason)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
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

    const [enabledDog] = await db
      .select({ id: dogs.id })
      .from(dogs)
      .where(eq(dogs.environmentEnabled, true))
      .limit(1)

    if (!enabledDog) {
      return NextResponse.json({ status: "skipped", reason: "no dogs with pollen tracking enabled" })
    }

    const today = getToday()

    let station: ActiveStation
    try {
      station = await resolveNearestStation()
    } catch (error) {
      return NextResponse.json(
        { status: `error: ${formatError(error)}`, processed: 0, skipped: 0 },
        { status: 502 },
      )
    }

    let result: Awaited<ReturnType<typeof fetchAndUpsert>>
    try {
      result = await fetchAndUpsert(station, today)
    } catch (error) {
      result = {
        status: `error: ${formatError(error)}`,
        provider: station.provider,
        location: station.locationSlug,
        processed: 0,
        skipped: 0,
      }
    }

    return NextResponse.json({
      station: { provider: station.provider, location: station.locationSlug, id: station.id },
      result,
    })
  } catch (error) {
    console.error("Pollen cron error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
