"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { prefetchProducts } from "@/components/product-picker"

export type LogMode = "closed" | "selector" | "poop" | "treat" | "itch" | "checkin"

interface ActiveDogContextValue {
  activeDogId: string | null
  setActiveDogId: (id: string | null) => void
  logMode: LogMode
  setLogMode: (mode: LogMode) => void
}

const ActiveDogContext = createContext<ActiveDogContextValue | null>(null)

export function ActiveDogProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [activeDogId, setActiveDogId] = useState<string | null>(null)
  const [logMode, setLogMode] = useState<LogMode>("closed")

  // Warm product cache on app load so pickers open instantly
  useEffect(() => {
    prefetchProducts()
  }, [])

  return (
    <ActiveDogContext.Provider
      value={{ activeDogId, setActiveDogId, logMode, setLogMode }}
    >
      {children}
    </ActiveDogContext.Provider>
  )
}

export function useActiveDog(): ActiveDogContextValue {
  const ctx = useContext(ActiveDogContext)
  if (!ctx) throw new Error("useActiveDog must be used within ActiveDogProvider")
  return ctx
}
