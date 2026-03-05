import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, medications } from "@/lib/db"
import { eq, desc } from "drizzle-orm"
import type { MedicationSummary } from "@/lib/types"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const rows = await db
      .select({
        id: medications.id,
        name: medications.name,
        dosage: medications.dosage,
        startDate: medications.startDate,
        endDate: medications.endDate,
        reason: medications.reason,
        notes: medications.notes,
      })
      .from(medications)
      .where(eq(medications.dogId, dogId))
      .orderBy(desc(medications.startDate))

    const result: MedicationSummary[] = rows
    return NextResponse.json(result)
  } catch (error) {
    console.error("Error fetching medications:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}

interface MedicationPostBody {
  name: string
  dosage?: string
  startDate?: string
  reason?: string
  notes?: string
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { id: dogId } = await params
    const authResult = await requireDogOwnership(dogId)
    if (isNextResponse(authResult)) return authResult

    const body = (await request.json()) as MedicationPostBody

    if (!body.name?.trim()) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 },
      )
    }

    const today = new Date().toISOString().split("T")[0]

    const validReasons = ["itchiness", "digestive", "other"] as const
    const reason = body.reason && validReasons.includes(body.reason as typeof validReasons[number])
      ? (body.reason as typeof validReasons[number])
      : null

    const [created] = await db
      .insert(medications)
      .values({
        dogId,
        name: body.name.trim(),
        dosage: body.dosage?.trim() || null,
        startDate: body.startDate || today,
        reason,
        notes: body.notes?.trim() || null,
      })
      .returning()

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    console.error("Error creating medication:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
