import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { getActivePlanForDog } from "@/lib/routine"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const plan = await getActivePlanForDog(dogId)
    return NextResponse.json(plan)
  } catch (error) {
    console.error("Error fetching today's feeding plan:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
