"use client"

import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { DatePickerInput } from "@/components/date-picker-input"
import { TimeInput } from "@/components/time-input"
import { LiaPenSolid } from "react-icons/lia"
import { useIsMobile } from "@/hooks/use-is-mobile"

interface EditPlanDatesProps {
  planGroupId: string
  startDate: string
  startDatetime: string | null
  endDate: string | null
  endDatetime: string | null
  onSaved: () => void
}

/** Extract HH:mm from an ISO datetime string, or null. */
function extractTime(datetime: string | null): string | null {
  if (!datetime) return null
  const d = new Date(datetime)
  if (isNaN(d.getTime())) return null
  return d.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Toronto" })
}

/** Combine a YYYY-MM-DD date and HH:mm time into an ISO string in America/Toronto, or null if no time. */
function combineDatetime(date: string, time: string | null): string | null {
  if (!time) return null
  // Get Toronto's UTC offset for this date/time using Intl formatting
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    timeZoneName: "shortOffset",
    year: "numeric",
  })
  // Parse a reference date in the target day to get the offset (handles DST)
  const refDate = new Date(`${date}T12:00:00Z`)
  const parts = formatter.formatToParts(refDate)
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? ""
  // offsetPart is like "GMT-5" or "GMT-4" — parse to build ISO offset
  const match = offsetPart.match(/GMT([+-]?\d+)(?::(\d+))?/)
  const offsetHours = match ? parseInt(match[1], 10) : -5
  const offsetMins = match && match[2] ? parseInt(match[2], 10) : 0
  const sign = offsetHours >= 0 ? "+" : "-"
  const absH = String(Math.abs(offsetHours)).padStart(2, "0")
  const absM = String(offsetMins).padStart(2, "0")
  return new Date(`${date}T${time}:00${sign}${absH}:${absM}`).toISOString()
}

function DateTimeFields({
  startDate,
  startTime,
  endDate,
  endTime,
  showEnd,
  saving,
  error,
  onStartDateChange,
  onStartTimeChange,
  onEndDateChange,
  onEndTimeChange,
  onSave,
  onClose,
}: {
  startDate: string
  startTime: string | null
  endDate: string
  endTime: string | null
  showEnd: boolean
  saving: boolean
  error: string | null
  onStartDateChange: (v: string) => void
  onStartTimeChange: (v: string | null) => void
  onEndDateChange: (v: string) => void
  onEndTimeChange: (v: string | null) => void
  onSave: () => void
  onClose: () => void
}): React.ReactElement {
  return (
    <div className="space-y-3">
      <fieldset className="space-y-1.5">
        <legend className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Start</legend>
        <div className="flex items-center gap-2">
          <DatePickerInput
            value={startDate}
            onChange={onStartDateChange}
            className="min-w-0 w-0 flex-1"
          />
          <TimeInput
            value={startTime}
            onChange={onStartTimeChange}
            className="min-w-0 w-0 flex-1"
          />
        </div>
      </fieldset>

      {showEnd && (
        <fieldset className="space-y-1.5">
          <legend className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">End</legend>
          <div className="flex items-center gap-2">
            <DatePickerInput
              value={endDate}
              onChange={onEndDateChange}
              className="min-w-0 w-0 flex-1"
            />
            <TimeInput
              value={endTime}
              onChange={onEndTimeChange}
              className="min-w-0 w-0 flex-1"
            />
          </div>
        </fieldset>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">{error}</p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  )
}

export function EditPlanDates({
  planGroupId,
  startDate: initialStartDate,
  startDatetime: initialStartDatetime,
  endDate: initialEndDate,
  endDatetime: initialEndDatetime,
  onSaved,
}: EditPlanDatesProps): React.ReactElement {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [startDate, setStartDate] = useState(initialStartDate)
  const [startTime, setStartTime] = useState<string | null>(extractTime(initialStartDatetime))
  const [endDate, setEndDate] = useState(initialEndDate ?? "")
  const [endTime, setEndTime] = useState<string | null>(extractTime(initialEndDatetime))

  const showEnd = initialEndDate !== null

  function resetFields(): void {
    setStartDate(initialStartDate)
    setStartTime(extractTime(initialStartDatetime))
    setEndDate(initialEndDate ?? "")
    setEndTime(extractTime(initialEndDatetime))
  }

  async function handleSave(): Promise<void> {
    if (showEnd && endDate && endDate < startDate) {
      setError("End date must be on or after start date.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        startDate,
        startDatetime: combineDatetime(startDate, startTime),
      }
      if (showEnd) {
        body.endDate = endDate || null
        body.endDatetime = endDate ? combineDatetime(endDate, endTime) : null
      }

      const res = await fetch(`/api/food/groups/${planGroupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setOpen(false)
        onSaved()
      } else {
        setError("Failed to save. Please try again.")
      }
    } catch {
      setError("Failed to save. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  function handleClose(): void {
    resetFields()
    setOpen(false)
  }

  const trigger = (
    <button
      type="button"
      className="inline-flex items-center justify-center size-5 rounded text-muted-foreground hover:text-foreground hover:bg-item-hover transition-colors"
      aria-label="Edit dates"
    >
      <LiaPenSolid className="size-3" />
    </button>
  )

  const fields = (
    <DateTimeFields
      startDate={startDate}
      startTime={startTime}
      endDate={endDate}
      endTime={endTime}
      showEnd={showEnd}
      saving={saving}
      error={error}
      onStartDateChange={setStartDate}
      onStartTimeChange={setStartTime}
      onEndDateChange={setEndDate}
      onEndTimeChange={setEndTime}
      onSave={handleSave}
      onClose={handleClose}
    />
  )

  if (isMobile) {
    return (
      <>
        <span className="contents" onClick={() => { resetFields(); setOpen(true) }}>{trigger}</span>
        <Drawer open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
          <DrawerContent aria-describedby={undefined}>
            <div className="pb-3" />
            <DrawerHeader className="sr-only">
              <DrawerTitle>Edit dates</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-6">
              {fields}
            </div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={(o) => { if (!o) handleClose(); else { resetFields(); setOpen(true) } }}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start" sideOffset={4}>
        {fields}
      </PopoverContent>
    </Popover>
  )
}
