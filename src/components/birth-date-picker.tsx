"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { format, parse, isValid } from "date-fns"
import { cn } from "@/lib/utils"

interface BirthDatePickerProps {
  value: string
  onChange: (date: string) => void
  placeholder?: string
  className?: string
}

export function BirthDatePicker({
  value,
  onChange,
  placeholder = "Select date",
  className,
}: BirthDatePickerProps): React.ReactElement {
  const [open, setOpen] = useState(false)

  const selectedDate = value
    ? parse(value, "yyyy-MM-dd", new Date())
    : undefined
  const validSelected =
    selectedDate && isValid(selectedDate) ? selectedDate : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-11 w-full justify-start rounded-lg font-normal hover:bg-item-hover-subtle data-[state=open]:bg-item-hover",
            !value && "text-muted-foreground",
            className,
          )}
        >
          {validSelected
            ? validSelected.toLocaleDateString()
            : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto overflow-hidden p-0" align="start">
        <Calendar
          mode="single"
          selected={validSelected}
          defaultMonth={validSelected}
          captionLayout="dropdown"
          fromYear={2000}
          toYear={new Date().getFullYear()}
          onSelect={(date) => {
            if (date) {
              onChange(format(date, "yyyy-MM-dd"))
              setOpen(false)
            }
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
