"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

export function DeleteDogButton({
  dogId,
  dogName,
}: {
  dogId: string
  dogName: string
}) {
  const router = useRouter()

  async function handleDelete() {
    if (!confirm(`Delete ${dogName}? This will also delete all their logs.`)) {
      return
    }

    const res = await fetch(`/api/dogs/${dogId}`, { method: "DELETE" })
    if (res.ok) {
      toast.success(`${dogName} deleted`)
      router.refresh()
    } else {
      toast.error("Failed to delete")
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDelete}
      className="text-destructive hover:text-destructive"
    >
      Delete
    </Button>
  )
}
