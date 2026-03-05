import { NextRequest, NextResponse } from "next/server"
import { getPhotoPath } from "@/lib/photos"
import fs from "fs/promises"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  try {
    const { path: segments } = await params
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
