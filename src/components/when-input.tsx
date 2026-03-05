"use client"

import { DatePickerInput } from "@/components/date-picker-input"
import { TimeInput } from "@/components/time-input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { format } from "date-fns"

interface WhenInputProps {
  date: string
  onDateChange: (date: string) => void
  time: string | null
  onTimeChange: (time: string | null) => void
}

export function WhenInput({
  date,
  onDateChange,
  time,
  onTimeChange,
}: WhenInputProps): React.ReactElement {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">When</Label>
      <div className="flex items-center gap-2">
        <DatePickerInput
          value={date}
          onChange={onDateChange}
          className="min-w-0 w-0 flex-1"
        />
        <TimeInput value={time} onChange={onTimeChange} className="min-w-0 w-0 flex-1" />
        <Button
          type="button"
          variant="secondary"
          className="h-11 shrink-0 rounded-lg px-5 text-sm font-semibold"
          onClick={() => {
            onDateChange(format(new Date(), "yyyy-MM-dd"))
            onTimeChange(format(new Date(), "HH:mm"))
          }}
        >
          Now
        </Button>
      </div>
    </div>
  )
}
