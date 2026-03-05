"use client"

import { useState } from "react"
import { DatePickerInput } from "@/components/date-picker-input"
import { BirthDatePicker } from "@/components/birth-date-picker"
import { DateRangePicker } from "@/components/date-range-picker"
import { TimeInput } from "@/components/time-input"
import { ProductPicker } from "@/components/product-picker"
import { ScorePicker } from "@/components/score-picker"
import { FecalScoreGuide } from "@/components/fecal-score-guide"
import { FecalScorePickerVertical, FecalScorePickerHorizontal } from "@/components/fecal-score-picker"
import { EnumPicker } from "@/components/enum-picker"
import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { format } from "date-fns"
import type { ProductSummary } from "@/lib/types"

export default function TestInputsPage(): React.ReactElement {
  // DatePickerInput
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"))

  // BirthDatePicker
  const [birthDate, setBirthDate] = useState("")

  // DateRangePicker
  const [rangeFrom, setRangeFrom] = useState("")
  const [rangeTo, setRangeTo] = useState("")

  // TimeInput
  const [time, setTime] = useState<string | null>(format(new Date(), "HH:mm"))

  // ProductPicker
  const [product, setProduct] = useState<ProductSummary | null>(null)

  // FecalScorePicker variants
  const [fecalVertical, setFecalVertical] = useState<number | null>(null)
  const [fecalHorizontal, setFecalHorizontal] = useState<number | null>(null)

  // ScorePicker (poop)
  const [poopScore, setPoopScore] = useState<number | null>(null)

  // ScorePicker (itch)
  const [itchScore, setItchScore] = useState<number | null>(null)

  // EnumPicker
  const [color, setColor] = useState<string | null>(null)

  // Standard inputs
  const [text, setText] = useState("")
  const [notes, setNotes] = useState("")
  const [quantity, setQuantity] = useState("")
  const [unit, setUnit] = useState("g")
  const [toggled, setToggled] = useState(false)

  return (
    <div className="mx-auto max-w-2xl space-y-10 py-8">
      <div>
        <h1 className="text-2xl font-bold">Input Components</h1>
        <p className="text-sm text-muted-foreground">
          All shared components in one place for styling iterations.
        </p>
      </div>

      {/* Logo iterations */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Logo Iterations
        </h2>
        <div className="flex items-end gap-8">
          {/* Current — can (BrandMark component) */}
          <div className="flex flex-col items-center gap-2">
            <BrandMark size={48} />
            <span className="text-xs text-muted-foreground">Current (can)</span>
          </div>

          {/* Old — circle badge */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center justify-center">
              <div className="brand-mark-badge flex items-center justify-center" style={{ width: 60, height: 60 }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <circle cx="12" cy="13" r="9" fill="#F4EDE3" />
                  <path d="M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.702 11.702 0 0 0-.493-3.309" stroke="#6B8C6F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M8.5 8.5c-.384 1.05-1.083 2.028-2.344 2.5-1.931.722-3.576-.297-3.656-1-.113-.994 1.177-6.53 4-7 1.923-.321 3.651.845 3.651 2.235A7.497 7.497 0 0 1 14 5.277c0-1.39 1.844-2.598 3.767-2.277 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 1-1.261-.472-1.855-1.45-2.239-2.5" fill="#F4EDE3" stroke="#6B8C6F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M8 14v.5" stroke="#6B5D4F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M16 14v.5" stroke="#6B5D4F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M11.25 16.25h1.5L12 17z" stroke="#6B5D4F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
            <span className="text-xs text-muted-foreground">Old (circle)</span>
          </div>

          {/* Iteration B — Kibble bag */}
          <div className="flex flex-col items-center gap-2">
            <svg width="60" height="80" viewBox="-1.5 1.5 35 46" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              {/* Bag body — standup pouch: straight sides, flat bottom */}
              <path
                d="M0,8 L0,44 Q0,46 2,46 L30,46 Q32,46 32,44 L32,8 Z"
                fill="#E8DCC8" stroke="#6B8C6F" strokeWidth="1.3" strokeLinejoin="round"
              />
              {/* Top seal — folded/crimped edge */}
              <path d="M0,8 L0,5 Q0,3 2,3 L30,3 Q32,3 32,5 L32,8" fill="#E8DCC8" stroke="#6B8C6F" strokeWidth="1.3" strokeLinejoin="round" />
              {/* Seal crimp line */}
              <line x1="4" y1="5.5" x2="28" y2="5.5" stroke="#6B8C6F" strokeWidth="0.7" strokeLinecap="round" opacity="0.45" />
              {/* Shoulder seam where seal meets body */}
              <line x1="0" y1="8" x2="32" y2="8" stroke="#6B8C6F" strokeWidth="0.5" opacity="0.25" />
              {/* Dog face — centered in bag */}
              <g transform="translate(2, 14) scale(1.15)">
                <circle cx="12" cy="13" r="9" fill="#F4EDE3" />
                <path d="M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.702 11.702 0 0 0-.493-3.309" stroke="#6B8C6F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8.5 8.5c-.384 1.05-1.083 2.028-2.344 2.5-1.931.722-3.576-.297-3.656-1-.113-.994 1.177-6.53 4-7 1.923-.321 3.651.845 3.651 2.235A7.497 7.497 0 0 1 14 5.277c0-1.39 1.844-2.598 3.767-2.277 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 1-1.261-.472-1.855-1.45-2.239-2.5" fill="#F4EDE3" stroke="#6B8C6F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8 14v.5" stroke="#6B5D4F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M16 14v.5" stroke="#6B5D4F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M11.25 16.25h1.5L12 17z" stroke="#6B5D4F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            </svg>
            <span className="text-xs text-muted-foreground">B: Kibble bag</span>
          </div>
        </div>
      </section>

      {/* DatePickerInput — logger style */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          DatePickerInput (loggers)
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <DatePickerInput value={date} onChange={setDate} className="w-auto min-w-[150px]" />
          <TimeInput value={time} onChange={setTime} />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-11 shrink-0 rounded-lg px-4 text-xs font-semibold uppercase tracking-wide"
            onClick={() => {
              setDate(format(new Date(), "yyyy-MM-dd"))
              setTime(format(new Date(), "HH:mm"))
            }}
          >
            Now
          </Button>
        </div>
      </section>

      {/* BirthDatePicker */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          BirthDatePicker (dog form)
        </h2>
        <div className="max-w-xs">
          <Label className="mb-2 block text-sm">Birth date</Label>
          <BirthDatePicker
            value={birthDate}
            onChange={setBirthDate}
            placeholder="Select birth date"
          />
        </div>
      </section>

      {/* DateRangePicker */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          DateRangePicker (plan editor / backfill)
        </h2>
        <div>
          <Label className="mb-2 block text-sm">Date range</Label>
          <DateRangePicker
            from={rangeFrom}
            to={rangeTo}
            onChange={(from, to) => {
              setRangeFrom(from)
              setRangeTo(to)
            }}
            placeholder="Select date range"
          />
        </div>
      </section>

      {/* ProductPicker */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          ProductPicker (food search)
        </h2>
        <div>
          <Label className="mb-2 block text-sm">Search food</Label>
          <ProductPicker
            value={product}
            onChange={setProduct}
            placeholder="Search products..."
          />
        </div>
        <div>
          <Label className="mb-2 block text-sm">Search treats</Label>
          <ProductPicker
            value={null}
            onChange={() => {}}
            productType="treat"
            placeholder="Search treats..."
          />
        </div>
      </section>

      {/* FecalScorePicker — Option A: Vertical */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Option A — Vertical List
        </h2>
        <FecalScorePickerVertical
          value={fecalVertical}
          onChange={setFecalVertical}
        />
      </section>

      {/* FecalScorePicker — Option B: Horizontal Scroll */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Option B — Horizontal Scroll Cards
        </h2>
        <FecalScorePickerHorizontal
          value={fecalHorizontal}
          onChange={setFecalHorizontal}
        />
      </section>

      {/* ScorePicker — Poop (1-7) */}
      <section className="space-y-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            ScorePicker — Firmness (1-7)
          </h2>
          <FecalScoreGuide onSelect={setPoopScore} />
        </div>
        <ScorePicker
          min={1}
          max={7}
          labels={["Hard pellets", "Ideal", "Soft", "Soggy", "Soft piles", "No shape", "Liquid"]}
          colors={["#D4A944", "#6B8C6F", "#8FB896", "#D4A944", "#D4A944", "#C97C5D", "#B84A3A"]}
          value={poopScore}
          onChange={setPoopScore}
        />
      </section>

      {/* ScorePicker — Itch (1-5) */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          ScorePicker — Itchiness (1-5)
        </h2>
        <ScorePicker
          min={1}
          max={5}
          labels={["None", "Mild", "Moderate", "Significant", "Severe"]}
          colors={["#6B8C6F", "#8FB896", "#D4A944", "#C97C5D", "#B84A3A"]}
          value={itchScore}
          onChange={setItchScore}
        />
      </section>

      {/* EnumPicker */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          EnumPicker (color chips)
        </h2>
        <EnumPicker
          options={[
            { value: "brown", label: "Brown" },
            { value: "dark_brown", label: "Dark brown" },
            { value: "black", label: "Black" },
            { value: "red", label: "Red" },
            { value: "orange", label: "Orange" },
            { value: "yellow", label: "Yellow" },
            { value: "green", label: "Green" },
          ]}
          value={color}
          onChange={setColor}
        />
      </section>

      {/* Standard shadcn inputs */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Standard Inputs
        </h2>
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block text-sm">Text input</Label>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Chicken elimination diet"
            />
          </div>
          <div>
            <Label className="mb-2 block text-sm">Textarea</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional observations..."
              rows={3}
            />
          </div>
          <div className="flex gap-2">
            <div>
              <Label className="mb-2 block text-sm">Quantity</Label>
              <Input
                type="number"
                step="0.25"
                placeholder="Qty"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-24"
              />
            </div>
            <div>
              <Label className="mb-2 block text-sm">Unit</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cup">cup</SelectItem>
                  <SelectItem value="can">can</SelectItem>
                  <SelectItem value="g">g</SelectItem>
                  <SelectItem value="scoop">scoop</SelectItem>
                  <SelectItem value="piece">piece</SelectItem>
                  <SelectItem value="tbsp">tbsp</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Toggle / Switch</Label>
            <Switch checked={toggled} onCheckedChange={setToggled} />
          </div>
        </div>
      </section>

      {/* Buttons */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Buttons
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div>
          <Button className="w-full min-h-[48px] text-base">Full-width Save</Button>
        </div>
      </section>
    </div>
  )
}
