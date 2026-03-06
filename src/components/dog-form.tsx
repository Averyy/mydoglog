"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BirthDatePicker } from "@/components/birth-date-picker"
import { toast } from "sonner"
import type { Dog } from "@/lib/db/schema"

interface DogFormProps {
  dog?: Dog
  onClose?: () => void
}

export function DogForm({ dog, onClose }: DogFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState(dog?.name ?? "")
  const [breed, setBreed] = useState(dog?.breed ?? "")
  const [birthDate, setBirthDate] = useState(dog?.birthDate ?? "")
  const [weightKg, setWeightKg] = useState(dog?.weightKg ?? "")
  const [location, setLocation] = useState(dog?.location ?? "")
  const [postalCode, setPostalCode] = useState(dog?.postalCode ?? "")
  const [notes, setNotes] = useState(dog?.notes ?? "")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const url = dog ? `/api/dogs/${dog.id}` : "/api/dogs"
    const method = dog ? "PATCH" : "POST"

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          breed: breed || null,
          birthDate: birthDate || null,
          weightKg: weightKg ? Number(weightKg) : null,
          location: location || null,
          postalCode: postalCode || null,
          notes: notes || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "Failed to save")
        return
      }

      toast.success(dog ? "Dog updated" : "Dog added")
      if (onClose) {
        onClose()
      } else {
        router.push("/dogs")
      }
      router.refresh()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name *</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="breed">Breed</Label>
        <Input
          id="breed"
          value={breed}
          onChange={(e) => setBreed(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>Birth date</Label>
        <BirthDatePicker
          value={birthDate}
          onChange={setBirthDate}
          placeholder="Select birth date"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="weightKg">Weight (kg)</Label>
        <Input
          id="weightKg"
          type="number"
          step="0.1"
          value={weightKg}
          onChange={(e) => setWeightKg(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="City, Province"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="postalCode">Postal code</Label>
        <Input
          id="postalCode"
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          placeholder="e.g. M5V 2T6"
        />
        <p className="text-xs text-muted-foreground">
          For accurate daily pollen counts
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Input
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onClose ? onClose() : router.push("/dogs")}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving..." : dog ? "Update" : "Add dog"}
        </Button>
      </div>
    </form>
  )
}
