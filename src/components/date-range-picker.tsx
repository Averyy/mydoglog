"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { CalendarIcon } from "lucide-react"
import { format, parse, isValid } from "date-fns"
import { type DateRange, type Matcher } from "react-day-picker"
import { cn } from "@/lib/utils"

interface DateRangePickerProps {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  placeholder?: string
  className?: string
  disabled?: Matcher | Matcher[]
  defaultMonth?: Date
  modifiers?: Record<string, Matcher | Matcher[]>
  modifiersClassNames?: Record<string, string>
}

function toDate(value: string): Date | undefined {
  if (!value) return undefined
  const d = parse(value, "yyyy-MM-dd", new Date())
  return isValid(d) ? d : undefined
}

export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = "Pick a date",
  className,
  disabled,
  defaultMonth,
  modifiers,
  modifiersClassNames,
}: DateRangePickerProps): React.ReactElement {
  const fromDate = toDate(from)
  const toDate_ = toDate(to)

  const [range, setRange] = useState<DateRange | undefined>(
    fromDate || toDate_
      ? { from: fromDate, to: toDate_ }
      : undefined,
  )

  function handleSelect(selected: DateRange | undefined): void {
    setRange(selected)
    const f = selected?.from ? format(selected.from, "yyyy-MM-dd") : ""
    const t = selected?.to ? format(selected.to, "yyyy-MM-dd") : ""
    onChange(f, t)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-11 w-full justify-start gap-2 rounded-lg px-3 font-normal hover:bg-item-hover-subtle",
            !from && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
          {fromDate ? (
            toDate_ ? (
              <>
                {format(fromDate, "LLL dd, y")} –{" "}
                {format(toDate_, "LLL dd, y")}
              </>
            ) : (
              format(fromDate, "LLL dd, y")
            )
          ) : (
            <span>{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto overflow-hidden p-0" align="start">
        <Calendar
          mode="range"
          defaultMonth={defaultMonth ?? fromDate}
          selected={range}
          onSelect={handleSelect}
          numberOfMonths={2}
          captionLayout="dropdown"
          disabled={disabled}
          modifiers={modifiers}
          modifiersClassNames={modifiersClassNames}
        />
      </PopoverContent>
    </Popover>
  )
}
