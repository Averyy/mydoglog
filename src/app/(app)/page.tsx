import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, dogs, poopLogs, itchinessLogs, treatLogs } from "@/lib/db"
import { eq, desc, and, sql } from "drizzle-orm"
import { getActivePlanForDog, getActiveMedicationsForDog } from "@/lib/routine"
import { DashboardClient } from "./dashboard-client"
import { AddDogModal } from "@/components/add-dog-modal"
import type { RoutineData } from "@/lib/types"

interface DogWithRecent {
  id: string
  name: string
  breed: string | null
  lastPoop: {
    firmnessScore: number
    datetime: string | null
    date: string
  } | null
  lastItchiness: {
    score: number
    datetime: string | null
    date: string
  } | null
  routine: RoutineData | null
  todayTreatCount: number
}

const SCORE_COLOR_MAP: Record<number, string> = {
  1: "text-score-excellent",
  2: "text-score-excellent",
  3: "text-score-good",
  4: "text-score-fair",
  5: "text-score-fair",
  6: "text-score-poor",
  7: "text-score-critical",
}

const ITCH_COLOR_MAP: Record<number, string> = {
  1: "text-score-excellent",
  2: "text-score-good",
  3: "text-score-fair",
  4: "text-score-poor",
  5: "text-score-critical",
}

const POOP_LABELS: Record<number, string> = {
  1: "Hard pellets",
  2: "Ideal",
  3: "Soft",
  4: "Soggy",
  5: "Soft piles",
  6: "No shape",
  7: "Liquid",
}

const ITCH_LABELS: Record<number, string> = {
  1: "Very mild",
  2: "Mild",
  3: "Moderate",
  4: "Severe",
  5: "Extreme",
}

export default async function DashboardPage(): Promise<React.ReactElement> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  const userDogs = await db
    .select()
    .from(dogs)
    .where(eq(dogs.ownerId, session!.user.id))

  if (userDogs.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
          Getting started
        </p>
        <h1 className="mt-2 text-2xl font-bold text-text-primary">
          Welcome to MyDogLog
        </h1>
        <p className="mt-2 max-w-sm text-sm text-text-secondary">
          Add your dog to begin tracking their food, stool quality, and symptoms.
        </p>
        <div className="mt-6">
          <AddDogModal />
        </div>
      </div>
    )
  }

  const today = new Date().toISOString().split("T")[0]

  // Fetch recent logs + routine + treat count for each dog
  const dogsWithRecent: DogWithRecent[] = await Promise.all(
    userDogs.map(async (dog) => {
      const [lastPoopRow] = await db
        .select({
          firmnessScore: poopLogs.firmnessScore,
          datetime: poopLogs.datetime,
          date: poopLogs.date,
        })
        .from(poopLogs)
        .where(eq(poopLogs.dogId, dog.id))
        .orderBy(desc(poopLogs.createdAt))
        .limit(1)

      const [lastItchRow] = await db
        .select({
          score: itchinessLogs.score,
          datetime: itchinessLogs.datetime,
          date: itchinessLogs.date,
        })
        .from(itchinessLogs)
        .where(eq(itchinessLogs.dogId, dog.id))
        .orderBy(desc(itchinessLogs.createdAt))
        .limit(1)

      // Fetch routine data (active plan + medications)
      const [plan, medications] = await Promise.all([
        getActivePlanForDog(dog.id),
        getActiveMedicationsForDog(dog.id),
      ])

      // Count today's treats
      const [treatCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(treatLogs)
        .where(and(eq(treatLogs.dogId, dog.id), eq(treatLogs.date, today)))

      return {
        id: dog.id,
        name: dog.name,
        breed: dog.breed,
        lastPoop: lastPoopRow
          ? {
              firmnessScore: lastPoopRow.firmnessScore,
              datetime: lastPoopRow.datetime?.toISOString() ?? null,
              date: lastPoopRow.date,
            }
          : null,
        lastItchiness: lastItchRow
          ? {
              score: lastItchRow.score,
              datetime: lastItchRow.datetime?.toISOString() ?? null,
              date: lastItchRow.date,
            }
          : null,
        routine: { plan, medications },
        todayTreatCount: treatCountRow?.count ?? 0,
      }
    }),
  )

  return (
    <DashboardClient
      dogs={dogsWithRecent}
      scoreColorMap={SCORE_COLOR_MAP}
      itchColorMap={ITCH_COLOR_MAP}
      poopLabels={POOP_LABELS}
      itchLabels={ITCH_LABELS}
    />
  )
}
