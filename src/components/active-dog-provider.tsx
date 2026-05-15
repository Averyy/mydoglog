"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { prefetchProducts } from "@/components/product-picker"

export type LogMode = "closed" | "selector" | "poop" | "treat" | "itch" | "checkin"

interface ActiveDogContextValue {
  activeDogId: string | null
  setActiveDogId: (id: string | null) => void
  activeDogSlug: string | null
  setActiveDogSlug: (slug: string | null) => void
  logMode: LogMode
  setLogMode: (mode: LogMode) => void
}

const ActiveDogContext = createContext<ActiveDogContextValue | null>(null)

const ID_KEY = "activeDogId"
const SLUG_KEY = "activeDogSlug"

export function ActiveDogProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [activeDogId, _setActiveDogId] = useState<string | null>(null)
  const [activeDogSlug, _setActiveDogSlug] = useState<string | null>(null)
  const [logMode, setLogMode] = useState<LogMode>("closed")

  // Restore from localStorage after hydration so nav links resolve on pages
  // like /settings or / that don't run DogPageProvider
  useEffect(() => {
    try {
      const storedId = localStorage.getItem(ID_KEY)
      const storedSlug = localStorage.getItem(SLUG_KEY)
      if (storedId) _setActiveDogId(storedId)
      if (storedSlug) _setActiveDogSlug(storedSlug)
    } catch {
      // localStorage may throw under private browsing / sandboxed iframes / quota limits
    }
  }, [])

  const setActiveDogId = useCallback((id: string | null): void => {
    _setActiveDogId(id)
    if (typeof window === "undefined") return
    try {
      if (id === null) localStorage.removeItem(ID_KEY)
      else localStorage.setItem(ID_KEY, id)
    } catch {
      // ignore — in-memory state still updates
    }
  }, [])

  const setActiveDogSlug = useCallback((slug: string | null): void => {
    _setActiveDogSlug(slug)
    if (typeof window === "undefined") return
    try {
      if (slug === null) localStorage.removeItem(SLUG_KEY)
      else localStorage.setItem(SLUG_KEY, slug)
    } catch {
      // ignore — in-memory state still updates
    }
  }, [])

  // Warm product cache on app load so pickers open instantly
  useEffect(() => {
    prefetchProducts()
  }, [])

  return (
    <ActiveDogContext.Provider
      value={{ activeDogId, setActiveDogId, activeDogSlug, setActiveDogSlug, logMode, setLogMode }}
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
