"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ResponsiveModal } from "@/components/responsive-modal"
import { DogForm } from "@/components/dog-form"
import { AddDogModal } from "@/components/add-dog-modal"
import { DeleteDogButton } from "../dogs/delete-button"
import type { Dog } from "@/lib/db/schema"

interface SettingsClientProps {
  dogs: Dog[]
}

export function SettingsClient({ dogs }: SettingsClientProps): React.ReactElement {
  const [editingDog, setEditingDog] = useState<Dog | null>(null)

  return (
    <div className="space-y-8">
      {/* Dog Profile */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {dogs.length === 1 ? "Your Dog" : "Your Dogs"}
          </h2>
          <AddDogModal trigger={<Button variant="outline" size="sm">Add dog</Button>} />
        </div>

        {dogs.length === 0 ? (
          <p className="mt-4 text-muted-foreground">
            No dogs yet. Add your first dog to get started.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {dogs.map((dog) => (
              <Card key={dog.id} className="py-0 gap-0">
                <CardContent className="flex items-start justify-between py-4 px-5">
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold text-foreground">
                      {dog.name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {[
                        dog.breed,
                        dog.weightKg ? `${dog.weightKg} kg` : null,
                        dog.environmentEnabled ? "Pollen tracking: On" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No details"}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingDog(dog)}
                    >
                      Edit
                    </Button>
                    <DeleteDogButton dogId={dog.id} dogName={dog.name} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Edit Dog Dialog */}
      <ResponsiveModal
        open={!!editingDog}
        onOpenChange={(open) => !open && setEditingDog(null)}
        title={`Edit ${editingDog?.name ?? ""}`}
      >
        {editingDog && (
          <DogForm dog={editingDog} onClose={() => setEditingDog(null)} />
        )}
      </ResponsiveModal>
    </div>
  )
}
