import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, dogs, feedingPeriods } from "@/lib/db"
import { and, eq } from "drizzle-orm"
import type { Dog } from "@/lib/db/schema"
import type { Session } from "@/lib/auth"
import type { PgTableWithColumns } from "drizzle-orm/pg-core"

export interface AuthResult {
  session: Session
  dog: Dog
}

export async function requireDogBySlug(
  slug: string,
): Promise<AuthResult | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [dog] = await db
    .select()
    .from(dogs)
    .where(and(eq(dogs.slug, slug.toLowerCase()), eq(dogs.ownerId, session.user.id)))

  if (!dog) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return { session: session as Session, dog }
}

export async function requireDogOwnership(
  dogId: string,
): Promise<AuthResult | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [dog] = await db
    .select()
    .from(dogs)
    .where(and(eq(dogs.id, dogId), eq(dogs.ownerId, session.user.id)))

  if (!dog) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return { session: session as Session, dog }
}

/**
 * Generic ownership check for log tables that have a dogId column.
 * Verifies: session → record exists → dog ownership.
 * Returns the full record or an error NextResponse.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requireLogOwnership<T extends PgTableWithColumns<any>>(
  table: T,
  logId: string,
): Promise<{ record: T["$inferSelect"] } | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idCol = (table as any)["id"]
  if (!idCol) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [record] = await (db.select().from(table as any) as any).where(eq(idCol, logId))
  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const dogId = (record as Record<string, unknown>)["dogId"] as string | undefined
  if (!dogId) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  const [dog] = await db
    .select({ id: dogs.id })
    .from(dogs)
    .where(and(eq(dogs.id, dogId), eq(dogs.ownerId, session.user.id)))

  if (!dog) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return { record: record as T["$inferSelect"] }
}

/**
 * Verify ownership of a plan group via its feeding periods.
 * Returns userId or an error NextResponse.
 */
export async function requirePlanGroupOwnership(
  planGroupId: string,
): Promise<{ userId: string; isBackfill: boolean } | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [period] = await db
    .select({ dogId: feedingPeriods.dogId, isBackfill: feedingPeriods.isBackfill })
    .from(feedingPeriods)
    .where(eq(feedingPeriods.planGroupId, planGroupId))
    .limit(1)

  if (!period) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const [dog] = await db
    .select({ id: dogs.id })
    .from(dogs)
    .where(and(eq(dogs.id, period.dogId), eq(dogs.ownerId, session.user.id)))

  if (!dog) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return { userId: session.user.id, isBackfill: period.isBackfill }
}

export function isNextResponse(
  result: AuthResult | NextResponse | { record: unknown } | { userId: string; isBackfill: boolean },
): result is NextResponse {
  return result instanceof NextResponse
}
