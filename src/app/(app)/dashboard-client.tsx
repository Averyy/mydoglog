"use client"

import { useState, useEffect } from "react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useActiveDog } from "@/components/active-dog-provider"
import { QuickLogGrid } from "@/components/quick-log-grid"
import { LogFeed } from "@/components/log-feed"

interface DogBasic {
  id: string
  name: string
  breed: string | null
}

interface DashboardClientProps {
  dogs: DogBasic[]
}

export function DashboardClient({
  dogs,
}: DashboardClientProps): React.ReactElement {
  const [activeDogId, setActiveDogId] = useState(dogs[0]?.id ?? "")
  const { setActiveDogId: setContextDogId, setLogMode } = useActiveDog()

  const activeDog = dogs.find((d) => d.id === activeDogId) ?? dogs[0]

  useEffect(() => {
    if (activeDog) setContextDogId(activeDog.id)
  }, [activeDog, setContextDogId])

  if (!activeDog) return <div />

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
        <h1 className="text-[32px] font-bold leading-tight text-text-primary">
          {activeDog.name}
        </h1>
        {activeDog.breed && (
          <p className="mt-0.5 text-sm text-text-secondary">
            {activeDog.breed}
          </p>
        )}
      </div>

      {/* Quick-log grid */}
      <QuickLogGrid dogId={activeDog.id} onSelect={setLogMode} />

      {/* Log feed */}
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.05em] text-text-tertiary">
          Recent
        </p>
        <LogFeed dogId={activeDog.id} />
      </div>
    </div>
  )
}
