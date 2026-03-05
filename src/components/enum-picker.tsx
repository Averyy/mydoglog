"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

interface EnumOption {
  value: string
  label: string
}

interface EnumPickerProps {
  options: EnumOption[]
  value: string | null
  onChange: (value: string) => void
}

export function EnumPicker({ options, value, onChange }: EnumPickerProps) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value ?? ""}
      onValueChange={(v: string) => {
        if (v) onChange(v)
      }}
      className="flex w-full"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          aria-label={option.label}
          className="min-h-[44px] flex-1 bg-background text-sm font-medium"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
