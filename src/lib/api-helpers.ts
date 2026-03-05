import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, dogs } from "@/lib/db"
import { and, eq } from "drizzle-orm"
import type { Dog } from "@/lib/db/schema"
import type { Session } from "@/lib/auth"

export interface AuthResult {
  session: Session
  dog: Dog
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

export function isNextResponse(
  result: AuthResult | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse
}
