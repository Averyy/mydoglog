"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FecalScorePickerHorizontal } from "@/components/fecal-score-picker"
import { CollapsibleNotes } from "@/components/collapsible-notes"
import { WhenInput } from "@/components/when-input"
import { toast } from "sonner"
import { format } from "date-fns"

interface QuickPoopLoggerProps {
  dogId: string
  onSaved: () => void
}

export function QuickPoopLogger({
  dogId,
  onSaved,
}: QuickPoopLoggerProps): React.ReactElement {
  const [selectedScore, setSelectedScore] = useState<number | null>(null)
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [time, setTime] = useState<string | null>(format(new Date(), "HH:mm"))
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  async function handleSave(): Promise<void> {
    if (selectedScore === null) return

    setSaving(true)
    try {
      const datetime =
        date && time ? new Date(`${date}T${time}`).toISOString() : undefined

      const body = {
        entries: [
          {
            firmnessScore: selectedScore,
            notes: notes.trim() || undefined,
          },
        ],
        date,
        datetime,
      }

      const res = await fetch(`/api/dogs/${dogId}/poop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        toast.error("Failed to log stool")
        return
      }

      toast.success("Stool logged")
      onSaved()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Score picker */}
      <FecalScorePickerHorizontal
        value={selectedScore}
        onChange={setSelectedScore}
      />

      {/* Date/time */}
      <WhenInput date={date} onDateChange={setDate} time={time} onTimeChange={setTime} />

      {/* Notes */}
      <div className="pt-2">
        <CollapsibleNotes value={notes} onChange={setNotes} label="Add stool note" />
      </div>

      {/* Save */}
      <Button
        onClick={handleSave}
        disabled={saving || selectedScore === null}
        className="mt-2 w-full"
      >
        {saving ? "Saving..." : "Save"}
      </Button>
    </div>
  )
}
