"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BirthDatePicker } from "@/components/birth-date-picker"
import { toast } from "sonner"
import { useActiveDog } from "@/components/active-dog-provider"
import type { Dog } from "@/lib/db/schema"

interface DogFormProps {
  dog?: Dog
  onClose?: () => void
}

function sanitizeNameInput(raw: string): string {
  return raw.replace(/[^a-zA-Z ]/g, "").replace(/ +/g, " ").slice(0, 20)
}

export function DogForm({ dog, onClose }: DogFormProps) {
  const router = useRouter()
  const { setActiveDogSlug } = useActiveDog()
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState(dog?.name ?? "")
  const [nameError, setNameError] = useState<string | null>(null)
  const [breed, setBreed] = useState(dog?.breed ?? "")
  const [birthDate, setBirthDate] = useState(dog?.birthDate ?? "")
  const [weightKg, setWeightKg] = useState(dog?.weightKg ?? "")
  const [mealsPerDay, setMealsPerDay] = useState(dog?.mealsPerDay ?? 3)
  const [environmentEnabled, setEnvironmentEnabled] = useState(
    dog?.environmentEnabled ?? false,
  )

  function handleNameChange(value: string): void {
    const sanitized = sanitizeNameInput(value)
    setName(sanitized)
    if (nameError) {
      const trimmed = sanitized.trim()
      if (trimmed.length >= 3) setNameError(null)
    }
  }

  function handleNameBlur(): void {
    const trimmed = name.trim()
    if (trimmed.length > 0 && trimmed.length < 3) {
      setNameError("Name must be at least 3 characters")
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 3) {
      setNameError("Name must be at least 3 characters")
      return
    }
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
          mealsPerDay,
          environmentEnabled,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Failed to save")
        return
      }

      if (data.slug) {
        setActiveDogSlug(data.slug)
      }

      toast.success(dog ? "Dog updated" : "Dog added")
      if (onClose) {
        onClose()
      } else {
        router.push("/settings")
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
          onChange={(e) => handleNameChange(e.target.value)}
          onBlur={handleNameBlur}
          maxLength={20}
          required
        />
        {nameError && (
          <p className="text-xs text-destructive">{nameError}</p>
        )}
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
        <Label htmlFor="mealsPerDay">Meals per day</Label>
        <Select
          value={String(mealsPerDay)}
          onValueChange={(v) => setMealsPerDay(Number(v))}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5].map((m) => (
              <SelectItem key={m} value={String(m)}>
                {m} meal{m > 1 ? "s" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-start space-x-3 py-2">
        <Checkbox
          id="environmentEnabled"
          checked={environmentEnabled}
          onCheckedChange={(checked) =>
            setEnvironmentEnabled(checked === true)
          }
        />
        <div className="space-y-0.5 leading-none">
          <Label htmlFor="environmentEnabled" className="cursor-pointer">
            Pollen and mold tracking
          </Label>
          <p className="text-xs text-muted-foreground">
            St. Catharines, ON
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onClose ? onClose() : router.push("/settings")}
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
