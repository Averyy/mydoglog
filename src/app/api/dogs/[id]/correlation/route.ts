import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { fetchCorrelationInput } from "@/lib/correlation/query"
import { runCorrelation } from "@/lib/correlation/engine"
import { DEFAULT_CORRELATION_OPTIONS } from "@/lib/correlation/types"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const { searchParams } = request.nextUrl
    const from = searchParams.get("from")
    const to = searchParams.get("to")

    const now = new Date()
    const windowEnd = to ?? now.toISOString().split("T")[0]
    const windowStart =
      from ??
      new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0]

    const input = await fetchCorrelationInput(dogId, windowStart, windowEnd)
    const result = runCorrelation(input, DEFAULT_CORRELATION_OPTIONS)

    return NextResponse.json(result)
  } catch (error) {
    console.error("Error fetching correlation data:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
