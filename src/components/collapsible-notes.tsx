"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { MessageSquare } from "lucide-react"

interface CollapsibleNotesProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
}

export function CollapsibleNotes({
  value,
  onChange,
  placeholder = "Any observations...",
  label = "Add note",
}: CollapsibleNotesProps): React.ReactElement {
  const [open, setOpen] = useState(value.length > 0)

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <MessageSquare className="size-3" />
        {label}
      </Button>
    )
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Notes
      </Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="resize-none"
      />
    </div>
  )
}
