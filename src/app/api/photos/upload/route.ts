import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, dogs } from "@/lib/db"
import { and, eq } from "drizzle-orm"
import { savePhoto } from "@/lib/photos"

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const dogId = formData.get("dog_id") as string | null
    const date = formData.get("date") as string | null

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 })
    }
    if (!dogId) {
      return NextResponse.json({ error: "dog_id is required" }, { status: 400 })
    }
    if (!date) {
      return NextResponse.json({ error: "date is required" }, { status: 400 })
    }

    // Verify dog ownership
    const [dog] = await db
      .select()
      .from(dogs)
      .where(and(eq(dogs.id, dogId), eq(dogs.ownerId, session.user.id)))

    if (!dog) {
      return NextResponse.json({ error: "Dog not found" }, { status: 404 })
    }

    const photoUrl = await savePhoto(file, dogId, date)
    return NextResponse.json({ photo_url: photoUrl }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed"
    console.error("Photo upload error:", error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
