"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { DogForm } from "@/components/dog-form"

interface AddDogModalProps {
  trigger?: React.ReactNode
}

export function AddDogModal({ trigger }: AddDogModalProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  function handleClose(): void {
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="lg">Add your dog</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a dog</DialogTitle>
          <DialogDescription className="sr-only">
            Fill in your dog's details to start tracking.
          </DialogDescription>
        </DialogHeader>
        <DogForm onClose={handleClose} />
      </DialogContent>
    </Dialog>
  )
}
