import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, dogs } from "@/lib/db"
import { eq } from "drizzle-orm"
import { DashboardClient } from "./dashboard-client"
import { AddDogModal } from "@/components/add-dog-modal"

export default async function DashboardPage(): Promise<React.ReactElement> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  const userDogs = await db
    .select({ id: dogs.id, name: dogs.name, breed: dogs.breed })
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

  return <DashboardClient dogs={userDogs} />
}
