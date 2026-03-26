import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { db, dogs } from "@/lib/db"
import { eq } from "drizzle-orm"
import { SettingsClient } from "./settings-client"

export default async function SettingsPage(): Promise<React.ReactElement> {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    redirect("/login")
  }

  const userDogs = await db
    .select()
    .from(dogs)
    .where(eq(dogs.ownerId, session.user.id))

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>
      <div className="mt-6">
        <SettingsClient dogs={userDogs} />
      </div>
    </div>
  )
}
