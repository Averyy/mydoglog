"use client"

import { useState, cloneElement } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ResponsiveModal } from "@/components/responsive-modal"
import { DogForm } from "@/components/dog-form"

interface AddDogModalProps {
  trigger?: React.ReactElement<{ onClick?: () => void }>
}

export function AddDogModal({ trigger }: AddDogModalProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  function handleClose(): void {
    setOpen(false)
    router.refresh()
  }

  const triggerElement = trigger ?? <Button size="lg">Add your dog</Button>

  return (
    <>
      {cloneElement(triggerElement, { onClick: () => setOpen(true) })}

      <ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        title="Add a dog"
        description="Fill in your dog's details to start tracking."
      >
        <DogForm onClose={handleClose} />
      </ResponsiveModal>
    </>
  )
}
