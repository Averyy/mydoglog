import { NextRequest, NextResponse } from "next/server"
import { requireDogOwnership, isNextResponse } from "@/lib/api-helpers"
import { db, medications, medicationProducts, dosingIntervalEnum } from "@/lib/db"
import { eq, desc } from "drizzle-orm"
import type { MedicationSummary } from "@/lib/types"
import { resolveMedicationFlags } from "@/lib/medications"
import { getToday } from "@/lib/utils"

const VALID_INTERVALS = new Set<string>(dosingIntervalEnum.enumValues)

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + "T00:00:00Z")
  return d.toISOString().slice(0, 10) === s
}

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
        medicationProductId: medications.medicationProductId,
        interval: medications.interval,
        notes: medications.notes,
        dosageForm: medicationProducts.dosageForm,
        description: medicationProducts.description,
        commonSideEffects: medicationProducts.commonSideEffects,
        sideEffectsSources: medicationProducts.sideEffectsSources,
        catalogSuppressesItch: medicationProducts.suppressesItch,
        catalogHasGiSideEffects: medicationProducts.hasGiSideEffects,
        customSuppressesItch: medications.suppressesItch,
        customHasGiSideEffects: medications.hasGiSideEffects,
      })
      .from(medications)
      .leftJoin(medicationProducts, eq(medications.medicationProductId, medicationProducts.id))
      .where(eq(medications.dogId, dogId))
      .orderBy(desc(medications.startDate))

    const result: MedicationSummary[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      dosage: r.dosage,
      startDate: r.startDate,
      endDate: r.endDate,
      medicationProductId: r.medicationProductId,
      interval: r.interval,
      notes: r.notes,
      dosageForm: r.dosageForm,
      description: r.description,
      commonSideEffects: r.commonSideEffects,
      sideEffectsSources: r.sideEffectsSources,
      ...resolveMedicationFlags(r),
    }))
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
  endDate?: string
  medicationProductId?: string
  interval?: string
  notes?: string
  suppressesItch?: boolean
  hasGiSideEffects?: boolean
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

    if ((body.startDate && !isValidDate(body.startDate)) || (body.endDate && !isValidDate(body.endDate))) {
      return NextResponse.json(
        { error: "Invalid date format (expected YYYY-MM-DD)" },
        { status: 400 },
      )
    }

    const today = getToday()

    const [created] = await db
      .insert(medications)
      .values({
        dogId,
        name: body.name.trim(),
        dosage: body.dosage?.trim() || null,
        startDate: body.startDate || today,
        endDate: body.endDate || null,
        medicationProductId: body.medicationProductId || null,
        interval: body.interval && VALID_INTERVALS.has(body.interval) ? body.interval as typeof medications.interval.enumValues[number] : null,
        notes: body.notes?.trim() || null,
        suppressesItch: !body.medicationProductId ? (body.suppressesItch ?? null) : null,
        hasGiSideEffects: !body.medicationProductId ? (body.hasGiSideEffects ?? null) : null,
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
