import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { getActivePlanForDog, getActiveMedicationsForDog } from "@/lib/routine"
import type { RoutineData } from "@/lib/types"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const [plan, meds] = await Promise.all([
      getActivePlanForDog(dogId),
      getActiveMedicationsForDog(dogId),
    ])

    const result: RoutineData = { plan, medications: meds }
    return NextResponse.json(result)
  } catch (error) {
    console.error("Error fetching routine:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
