import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, dogs } from "@/lib/db"
import { and, eq } from "drizzle-orm"
import { sanitizeDogName, validateDogName, generateUniqueSlug } from "@/lib/slug"

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()

    const [existing] = await db
      .select()
      .from(dogs)
      .where(and(eq(dogs.id, id), eq(dogs.ownerId, session.user.id)))

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (body.name !== undefined) {
      const sanitizedName = sanitizeDogName(body.name)
      const nameError = validateDogName(sanitizedName)
      if (nameError) {
        return NextResponse.json({ error: nameError }, { status: 400 })
      }
      updates.name = sanitizedName
      updates.slug = await generateUniqueSlug(sanitizedName, session.user.id, id)
    }
    if (body.breed !== undefined) updates.breed = body.breed?.trim() || null
    if (body.birthDate !== undefined) updates.birthDate = body.birthDate || null
    if (body.weightKg !== undefined)
      updates.weightKg = body.weightKg != null ? String(body.weightKg) : null
    if (body.environmentEnabled !== undefined)
      updates.environmentEnabled = body.environmentEnabled === true
    if (body.mealsPerDay !== undefined) {
      const mpd = Math.max(1, Math.min(5, Math.round(Number(body.mealsPerDay))))
      updates.mealsPerDay = mpd
    }

    const [updated] = await db
      .update(dogs)
      .set(updates)
      .where(eq(dogs.id, id))
      .returning()

    return NextResponse.json(updated)
  } catch (error) {
    console.error("Error updating dog:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const [existing] = await db
      .select()
      .from(dogs)
      .where(and(eq(dogs.id, id), eq(dogs.ownerId, session.user.id)))

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    await db.delete(dogs).where(eq(dogs.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting dog:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
