import { NextRequest, NextResponse } from "next/server"
import { getPhotoPath } from "@/lib/photos"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import fs from "fs/promises"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  try {
    const { path: segments } = await params

    // First segment is the dogId — verify ownership
    if (segments.length < 1) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const authResult = await requireDogOwnership(segments[0])
    if (isNextResponse(authResult)) return authResult

    const filepath = await getPhotoPath(segments)

    if (!filepath) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const buffer = await fs.readFile(filepath)
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
}
