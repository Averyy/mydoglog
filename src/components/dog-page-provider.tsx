"use client"

import { createContext, useContext, useEffect } from "react"
import { useActiveDog } from "@/components/active-dog-provider"

interface DogPageContextValue {
  id: string
  name: string
  slug: string
  mealsPerDay: number
}

const DogPageContext = createContext<DogPageContextValue | null>(null)

export function DogPageProvider({
  id,
  name,
  slug,
  mealsPerDay,
  children,
}: DogPageContextValue & { children: React.ReactNode }): React.ReactElement {
  const { setActiveDogId, setActiveDogSlug } = useActiveDog()

  useEffect(() => {
    setActiveDogId(id)
    setActiveDogSlug(slug)
  }, [id, slug, setActiveDogId, setActiveDogSlug])

  return (
    <DogPageContext.Provider value={{ id, name, slug, mealsPerDay }}>
      {children}
    </DogPageContext.Provider>
  )
}

export function useDogPage(): DogPageContextValue {
  const ctx = useContext(DogPageContext)
  if (!ctx) throw new Error("useDogPage must be used within DogPageProvider")
  return ctx
}
