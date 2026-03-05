import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, dogs } from "@/lib/db"
import { and, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { DogForm } from "@/components/dog-form"

export default async function EditDogPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth.api.getSession({ headers: await headers() })

  const [dog] = await db
    .select()
    .from(dogs)
    .where(and(eq(dogs.id, id), eq(dogs.ownerId, session!.user.id)))

  if (!dog) notFound()

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">
        Edit {dog.name}
      </h1>
      <div className="mt-6">
        <DogForm dog={dog} />
      </div>
    </div>
  )
}
