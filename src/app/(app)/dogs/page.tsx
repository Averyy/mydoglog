import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db, dogs } from "@/lib/db"
import { eq } from "drizzle-orm"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { AddDogModal } from "@/components/add-dog-modal"
import { DeleteDogButton } from "./delete-button"

export default async function DogsPage(): Promise<React.ReactElement> {
  const session = await auth.api.getSession({ headers: await headers() })
  const userDogs = await db
    .select()
    .from(dogs)
    .where(eq(dogs.ownerId, session!.user.id))

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Your dogs</h1>
        <AddDogModal trigger={<Button>Add dog</Button>} />
      </div>

      {userDogs.length === 0 ? (
        <p className="mt-8 text-muted-foreground">
          No dogs yet. Add your first dog to get started.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {userDogs.map((dog) => (
            <Card key={dog.id} className="py-0">
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <h2 className="font-semibold text-foreground">
                    {dog.name}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {[dog.breed, dog.weightKg ? `${dog.weightKg} kg` : null]
                      .filter(Boolean)
                      .join(" · ") || "No details"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/dogs/${dog.id}/feeding`}>Feeding</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/dogs/${dog.id}/edit`}>Edit</Link>
                  </Button>
                  <DeleteDogButton dogId={dog.id} dogName={dog.name} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
