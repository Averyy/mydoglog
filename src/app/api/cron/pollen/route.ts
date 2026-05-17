import { NextRequest, NextResponse } from "next/server"
import { db, dogs, dailyPollen } from "@/lib/db"
import { eq, and, sql, desc } from "drizzle-orm"
import { getToday } from "@/lib/utils"
import {
  POLLEN_LAT,
  POLLEN_LNG,
  POLLEN_BACKFILL_START,
  POLLEN_MAX_READINGS,
  makeLocationSlug,
} from "@/lib/pollen/constants"

const DEFAULT_BASE_URL = "https://api.pawpollen.com"

function getBaseUrl(): string {
  return process.env.POLLEN_SPARR_BASE_URL ?? DEFAULT_BASE_URL
}

function getApiKey(): string {
  return process.env.POLLEN_SPARR_API_KEY ?? ""
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

type Bucket = "trees" | "grasses" | "weeds" | "spores"
const BUCKETS: ReadonlyArray<Bucket> = ["trees", "grasses", "weeds", "spores"]

interface PollenSparrSpecies {
  name: string
  scientific_name: string | null
  level: number | null
  raw_count?: number | null
  provider_code?: string | null
  extras?: Record<string, unknown> | null
}

interface PollenSparrCategory {
  level: number | null
  species?: PollenSparrSpecies[]
}

interface PollenSparrReading {
  location_id: number
  date: string
  provider: string
  source: string
  data_type: string
  scale_basis: string
  overall_level: number | null
  categories: Partial<Record<Bucket, PollenSparrCategory>> | null
}

interface PollenSparrLocation {
  id: number
  provider: string
  external_id: string
  name: string
  country_code: string
  region: string
  lat: number
  lng: number
  status?: string | null
  last_reading_date?: string | null
  distance_km?: number
  data_type?: string
  scale_basis?: string
}

interface ActiveStation {
  id: number
  provider: string
  locationSlug: string
}

type FlattenedAllergen = {
  name: string
  scientificName: string | null
  type: Bucket
  level: number | null
}

function pollenSparrFetch(path: string): Promise<Response> {
  return fetch(`${getBaseUrl()}${path}`, {
    headers: {
      "X-API-Key": getApiKey(),
      Accept: "application/json",
    },
  })
}

function validateReading(reading: unknown): reading is PollenSparrReading {
  if (typeof reading !== "object" || reading === null) return false
  const r = reading as Record<string, unknown>
  if (typeof r.date !== "string" || !DATE_REGEX.test(r.date)) return false
  if (r.overall_level !== null && typeof r.overall_level !== "number") return false
  if (r.categories !== null && (typeof r.categories !== "object" || Array.isArray(r.categories))) {
    return false
  }
  return true
}

function getBucketLevel(
  categories: PollenSparrReading["categories"],
  bucket: Bucket,
): number | null {
  const cat = categories?.[bucket]
  if (!cat) return null
  return typeof cat.level === "number" ? cat.level : null
}

function flattenAllergens(
  categories: PollenSparrReading["categories"],
): FlattenedAllergen[] {
  if (!categories) return []
  const out: FlattenedAllergen[] = []
  for (const bucket of BUCKETS) {
    const cat = categories[bucket]
    if (!cat || !Array.isArray(cat.species)) continue
    for (const s of cat.species) {
      if (s.level == null || s.level <= 0) continue
      out.push({
        name: s.name,
        scientificName: s.scientific_name ?? null,
        type: bucket,
        level: s.level,
      })
    }
  }
  return out
}

async function resolveNearestStation(): Promise<ActiveStation> {
  // Default sort is `tier_then_distance` so results[0] is the closest measured
  // station (preferred), falling back to modelled if no measured is in range.
  const url = `/api/nearest?lat=${POLLEN_LAT}&lng=${POLLEN_LNG}`
  const response = await pollenSparrFetch(url)
  if (!response.ok) {
    throw new Error(`nearest lookup failed: HTTP ${response.status}`)
  }
  const body = (await response.json()) as { results?: PollenSparrLocation[] }
  const loc = body?.results?.[0]
  if (!loc || typeof loc.id !== "number" || typeof loc.provider !== "string") {
    throw new Error("nearest lookup returned no usable location")
  }
  return {
    id: loc.id,
    provider: loc.provider,
    locationSlug: makeLocationSlug(loc.name, loc.region),
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

  const url = `/api/locations/${station.id}/readings?from=${fromDate}&to=${today}`
  const response = await pollenSparrFetch(url)

  if (!response.ok) {
    return {
      status: `error: HTTP ${response.status}`,
      provider: station.provider,
      location: station.locationSlug,
      processed: 0,
      skipped: 0,
    }
  }

  const body = (await response.json()) as { readings?: unknown[] }
  const rawReadings: unknown[] = Array.isArray(body?.readings) ? body.readings : []

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
        pollenLevel: reading.overall_level ?? 0,
        sporeLevel: getBucketLevel(reading.categories, "spores"),
        totalTrees: getBucketLevel(reading.categories, "trees"),
        totalGrasses: getBucketLevel(reading.categories, "grasses"),
        totalWeeds: getBucketLevel(reading.categories, "weeds"),
        topAllergens: flattenAllergens(reading.categories),
        source: typeof reading.source === "string" ? reading.source : "unknown",
        outOfSeason: false,
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

    if (!getApiKey()) {
      return NextResponse.json(
        { error: "POLLEN_SPARR_API_KEY not configured" },
        { status: 500 },
      )
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
