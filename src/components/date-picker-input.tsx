"use client"

import { useState, useEffect } from "react"
import { Calendar } from "@/components/ui/calendar"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { CalendarIcon } from "lucide-react"
import { format, parse, isValid } from "date-fns"

interface DatePickerInputProps {
  value: string
  onChange: (date: string) => void
  placeholder?: string
  className?: string
}

function formatDisplay(date: Date): string {
  const now = new Date()
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return "Today"
  }
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  })
}

export function DatePickerInput({
  value,
  onChange,
  placeholder = "Pick a date",
  className,
}: DatePickerInputProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState<Date | undefined>(undefined)
  const [displayValue, setDisplayValue] = useState("")

  // Sync display text when value changes externally
  useEffect(() => {
    if (value) {
      const date = parse(value, "yyyy-MM-dd", new Date())
      if (isValid(date)) {
        setDisplayValue(formatDisplay(date))
        setMonth(date)
      }
    } else {
      setDisplayValue("")
    }
  }, [value])

  const selectedDate = value
    ? parse(value, "yyyy-MM-dd", new Date())
    : undefined
  const validSelected =
    selectedDate && isValid(selectedDate) ? selectedDate : undefined

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const text = e.target.value
    setDisplayValue(text)
    const parsed = new Date(text)
    if (isValid(parsed) && !isNaN(parsed.getTime())) {
      onChange(format(parsed, "yyyy-MM-dd"))
      setMonth(parsed)
    }
  }

  function handleCalendarSelect(day: Date | undefined): void {
    if (day) {
      onChange(format(day, "yyyy-MM-dd"))
      setDisplayValue(formatDisplay(day))
      setOpen(false)
    }
  }

  return (
    <InputGroup className={className}>
      <InputGroupInput
        value={displayValue}
        placeholder={placeholder}
        onChange={handleInputChange}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setOpen(true)
          }
        }}
      />
      <InputGroupAddon align="inline-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <InputGroupButton
              variant="ghost"
              size="icon-xs"
              aria-label="Select date"
            >
              <CalendarIcon />
            </InputGroupButton>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto overflow-hidden p-0"
            align="end"
            alignOffset={-8}
            sideOffset={10}
          >
            <Calendar
              mode="single"
              selected={validSelected}
              month={month}
              onMonthChange={setMonth}
              captionLayout="dropdown"
              onSelect={handleCalendarSelect}
            />
          </PopoverContent>
        </Popover>
      </InputGroupAddon>
    </InputGroup>
  )
}
