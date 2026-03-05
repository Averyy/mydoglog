import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, dogs } from "@/lib/db"
import { eq } from "drizzle-orm"

export async function GET(): Promise<NextResponse> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userDogs = await db
      .select()
      .from(dogs)
      .where(eq(dogs.ownerId, session.user.id))

    return NextResponse.json(userDogs)
  } catch (error) {
    console.error("Error fetching dogs:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { name, breed, birthDate, weightKg, location, postalCode, notes } = body

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 })
    }

    const [dog] = await db
      .insert(dogs)
      .values({
        ownerId: session.user.id,
        name: name.trim(),
        breed: breed?.trim() || null,
        birthDate: birthDate || null,
        weightKg: weightKg != null ? String(weightKg) : null,
        location: location?.trim() || null,
        postalCode: postalCode?.trim() || null,
        notes: notes?.trim() || null,
      })
      .returning()

    return NextResponse.json(dog, { status: 201 })
  } catch (error) {
    console.error("Error creating dog:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
