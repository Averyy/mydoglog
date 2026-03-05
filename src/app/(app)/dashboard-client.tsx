"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import { ProductItem } from "@/components/product-item"
import { MedicationItem } from "@/components/medication-item"
import { useActiveDog } from "@/components/active-dog-provider"
import { formatDistanceToNow, parseISO, isToday, isYesterday } from "date-fns"
import { ArrowRight, CalendarCheck, Clipboard, Cookie, Droplets, Star } from "lucide-react"
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

interface DashboardClientProps {
  dogs: DogWithRecent[]
  scoreColorMap: Record<number, string>
  itchColorMap: Record<number, string>
  poopLabels: Record<number, string>
  itchLabels: Record<number, string>
}

function formatWhen(datetime: string | null, date: string): string {
  if (datetime) {
    const d = new Date(datetime)
    if (isToday(d)) return formatDistanceToNow(d, { addSuffix: true })
    if (isYesterday(d)) return "Yesterday"
    return formatDistanceToNow(d, { addSuffix: true })
  }
  const d = parseISO(date)
  if (isToday(d)) return "Today"
  if (isYesterday(d)) return "Yesterday"
  return formatDistanceToNow(d, { addSuffix: true })
}

function isTodayLog(datetime: string | null, date: string): boolean {
  if (datetime) return isToday(new Date(datetime))
  return isToday(parseISO(date))
}

export function DashboardClient({
  dogs,
  scoreColorMap,
  itchColorMap,
  poopLabels,
  itchLabels,
}: DashboardClientProps): React.ReactElement {
  const [activeDogId, setActiveDogId] = useState(dogs[0]?.id ?? "")
  const { setActiveDogId: setContextDogId, setLogMode } = useActiveDog()

  const activeDog = dogs.find((d) => d.id === activeDogId) ?? dogs[0]

  // Sync active dog to layout context so bottom nav + button works
  useEffect(() => {
    if (activeDog) setContextDogId(activeDog.id)
  }, [activeDog, setContextDogId])

  if (!activeDog) return <div />

  const routine = activeDog.routine
  const hasRoutine = routine && (routine.plan || routine.medications.length > 0)
  const todayPoop = activeDog.lastPoop && isTodayLog(activeDog.lastPoop.datetime, activeDog.lastPoop.date)
    ? activeDog.lastPoop
    : null
  const todayItch = activeDog.lastItchiness && isTodayLog(activeDog.lastItchiness.datetime, activeDog.lastItchiness.date)
    ? activeDog.lastItchiness
    : null
  const hasTodayLogs = todayPoop || todayItch || activeDog.todayTreatCount > 0

  return (
    <div className="space-y-8">
      {/* Dog switcher */}
      {dogs.length > 1 && (
        <Tabs value={activeDogId} onValueChange={setActiveDogId}>
          <TabsList>
            {dogs.map((dog) => (
              <TabsTrigger key={dog.id} value={dog.id}>
                {dog.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {/* Header */}
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.05em] text-text-tertiary">
          Daily summary
        </p>
        <h1 className="mt-1 text-[32px] font-bold leading-tight text-text-primary">
          {activeDog.name}
        </h1>
        {activeDog.breed && (
          <p className="mt-0.5 text-sm text-text-secondary">
            {activeDog.breed}
          </p>
        )}
      </div>

      {/* Quick-log grid */}
      <div className="grid grid-cols-2 gap-3">
        {([
          { label: "Daily Check-in", icon: CalendarCheck, action: () => setLogMode("checkin") },
          { label: "Log Stool", icon: Clipboard, action: () => setLogMode("poop") },
          { label: "Log Itch", icon: Droplets, action: () => setLogMode("itch") },
          { label: "Log Treat", icon: Cookie, action: () => setLogMode("treat") },
        ] as const).map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.label}
              type="button"
              onClick={item.action}
              className="flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-bg-primary px-4 py-3 text-text-secondary transition-colors hover:border-primary hover:bg-item-active hover:text-primary"
            >
              <Icon className="size-5" strokeWidth={1.5} />
              <span className="text-[13px] font-medium">{item.label}</span>
            </button>
          )
        })}
      </div>

      {/* Today's log summary */}
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.05em] text-text-tertiary">
          Today
        </p>

        {!hasTodayLogs ? (
          <p className="text-sm text-text-secondary">
            No logs today. Tap + to start logging.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {/* Stool */}
            <div className="rounded-lg border border-border px-3 py-3 text-center">
              <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
                Stool
              </p>
              {todayPoop ? (
                <>
                  <p className={`mt-1 text-2xl font-bold tabular-nums ${scoreColorMap[todayPoop.firmnessScore] ?? "text-text-primary"}`}>
                    {todayPoop.firmnessScore}
                  </p>
                  <p className="text-[11px] text-text-tertiary">
                    {poopLabels[todayPoop.firmnessScore]}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-lg text-text-tertiary">—</p>
              )}
            </div>

            {/* Itch */}
            <div className="rounded-lg border border-border px-3 py-3 text-center">
              <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
                Itch
              </p>
              {todayItch ? (
                <>
                  <p className={`mt-1 text-2xl font-bold tabular-nums ${itchColorMap[todayItch.score] ?? "text-text-primary"}`}>
                    {todayItch.score}
                  </p>
                  <p className="text-[11px] text-text-tertiary">
                    {itchLabels[todayItch.score]}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-lg text-text-tertiary">—</p>
              )}
            </div>

            {/* Treats */}
            <div className="rounded-lg border border-border px-3 py-3 text-center">
              <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
                Treats
              </p>
              {activeDog.todayTreatCount > 0 ? (
                <>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-text-primary">
                    {activeDog.todayTreatCount}
                  </p>
                  <p className="text-[11px] text-text-tertiary">
                    {activeDog.todayTreatCount === 1 ? "treat" : "treats"}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-lg text-text-tertiary">—</p>
              )}
            </div>
          </div>
        )}

        {/* Recent (non-today) fallback */}
        {!hasTodayLogs && (activeDog.lastPoop || activeDog.lastItchiness) && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
              Last recorded
            </p>
            {activeDog.lastPoop && (
              <div className="flex items-baseline justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium text-text-secondary">
                    Stool
                  </p>
                  <p className="text-xs text-text-tertiary">
                    {formatWhen(activeDog.lastPoop.datetime, activeDog.lastPoop.date)}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`text-2xl font-bold tabular-nums ${scoreColorMap[activeDog.lastPoop.firmnessScore] ?? "text-text-primary"}`}
                  >
                    {activeDog.lastPoop.firmnessScore}
                  </span>
                  <p className="text-xs text-text-tertiary">
                    {poopLabels[activeDog.lastPoop.firmnessScore]}
                  </p>
                </div>
              </div>
            )}

            {activeDog.lastItchiness && (
              <div className="flex items-baseline justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium text-text-secondary">
                    Itchiness
                  </p>
                  <p className="text-xs text-text-tertiary">
                    {formatWhen(
                      activeDog.lastItchiness.datetime,
                      activeDog.lastItchiness.date,
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`text-2xl font-bold tabular-nums ${itchColorMap[activeDog.lastItchiness.score] ?? "text-text-primary"}`}
                  >
                    {activeDog.lastItchiness.score}
                  </span>
                  <p className="text-xs text-text-tertiary">
                    {itchLabels[activeDog.lastItchiness.score]}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Routine summary */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-[0.05em] text-text-tertiary">
            Routine
          </p>
          {hasRoutine && (
            <Link
              href={`/dogs/${activeDog.id}/feeding`}
              className="text-xs text-primary hover:underline underline-offset-2"
            >
              Edit
            </Link>
          )}
        </div>

        {hasRoutine ? (
          <div className="space-y-1.5">
            {routine.plan && routine.plan.items.length > 0 && (
              routine.plan.items.map((item) => (
                <ProductItem
                  key={item.id}
                  brandName={item.brandName}
                  productName={item.productName}
                  imageUrl={item.imageUrl}
                  quantity={item.quantity}
                  quantityUnit={item.quantityUnit}
                />
              ))
            )}
            {routine.medications.length > 0 && (
              routine.medications.map((med) => (
                <MedicationItem
                  key={med.id}
                  name={med.name}
                  dosage={med.dosage}
                  reason={med.reason}
                />
              ))
            )}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-6 text-center">
              <p className="text-sm text-muted-foreground">No active routine</p>
              <Link
                href={`/dogs/${activeDog.id}/feeding`}
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline underline-offset-2"
              >
                Set up routine
                <ArrowRight className="size-3.5" />
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Food Scorecard link */}
      <Link
        href={`/dogs/${activeDog.id}/food-scorecard`}
        className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm font-medium text-text-secondary transition-colors hover:bg-item-hover hover:text-text-primary"
      >
        <span className="flex items-center gap-2">
          <Star className="size-4 text-text-tertiary" />
          Food Scorecard
        </span>
        <ArrowRight className="size-4 text-text-tertiary" />
      </Link>
    </div>
  )
}
