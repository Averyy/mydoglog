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
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ChevronDown, Minus, Pencil, ThumbsDown, ThumbsUp } from "lucide-react"
import { format } from "date-fns"
import type { ProductSummary } from "@/lib/types"

// ── Scorecard card design showcase ──
// Same data rendered with different layout approaches. Filter toggles between designs.

interface FoodData {
  brandName: string
  productName: string
  imageUrl: string
  productType: string | null
  quantity?: string
  quantityUnit?: string
  isCurrent: boolean
  dateLabel: string
  scorecard: {
    avgStool?: number; stoolColor?: string; stoolDays?: number
    avgItch?: number; itchColor?: string; itchDays?: number
    poopLabel?: string; itchLabel?: string
    verdict?: { label: string; bg: string; text: string }
    digestiveImpact?: string
    itchImpact?: string
  } | null
  logStats?: { avgStool: number; stoolColor: string; stoolLogs: number; avgItch: number; itchColor: string; itchLogs: number }
}

const SAMPLE_CARDS: FoodData[] = [
  {
    brandName: "Purina",
    productName: "Pro Plan Veterinary Diets HA Hydrolyzed Chicken Flavour Canned Canine Formula",
    imageUrl: "/products-large/purina/purina-wet-pro-plan-veterinary-diets-ha-hydrolyzed-chicken-flavour-canned-canine-formula.webp",
    productType: "wet_food",
    quantity: "630", quantityUnit: "g",
    isCurrent: true,
    dateLabel: "Active since Mar 4, 2026",
    scorecard: null,
    logStats: { avgStool: 4.5, stoolColor: "text-score-fair", stoolLogs: 4, avgItch: 1.5, itchColor: "text-score-good", itchLogs: 2 },
  },
  {
    brandName: "Authority",
    productName: "Digestive Support All Life Stages Wet Dog Food Supplement Topper - Pumpkin",
    imageUrl: "/products-large/authority/authority-supplements-digestive-support-all-life-stages-wet-dog-food-supplement-topper-pumpkin.webp",
    productType: "topper",
    quantity: "90", quantityUnit: "g",
    isCurrent: true,
    dateLabel: "Active since Mar 4, 2026",
    scorecard: null,
    logStats: { avgStool: 4.5, stoolColor: "text-score-fair", stoolLogs: 4, avgItch: 1.5, itchColor: "text-score-good", itchLogs: 2 },
  },
  {
    brandName: "Purina",
    productName: "Pro Plan Veterinary Diets HA Hydrolyzed Chicken Flavour Canned Canine Formula",
    imageUrl: "/products-large/purina/purina-wet-pro-plan-veterinary-diets-ha-hydrolyzed-chicken-flavour-canned-canine-formula.webp",
    productType: "wet_food",
    isCurrent: false,
    dateLabel: "Sep 1, 2025 - Mar 3, 2026",
    scorecard: { avgStool: 3.0, stoolColor: "text-score-good", stoolDays: 183, avgItch: 0, itchColor: "text-score-excellent", itchDays: 183 },
  },
  {
    brandName: "Authority",
    productName: "Digestive Support All Life Stages Wet Dog Food Supplement Topper - Pumpkin",
    imageUrl: "/products-large/authority/authority-supplements-digestive-support-all-life-stages-wet-dog-food-supplement-topper-pumpkin.webp",
    productType: "topper",
    isCurrent: false,
    dateLabel: "Jan 1, 2025 - Mar 3, 2026",
    scorecard: { digestiveImpact: "Better", itchImpact: "No change", stoolDays: 426 },
  },
  {
    brandName: "Hill's",
    productName: "Hypoallergenic Dog Treats",
    imageUrl: "/products-large/hill-s/hill-s-treats-hypoallergenic-dog-treats.webp",
    productType: "treat",
    isCurrent: false,
    dateLabel: "Dec 1, 2025 - Jan 31, 2026",
    scorecard: { digestiveImpact: "Worse", itchImpact: "No change", stoolDays: 62 },
  },
  {
    brandName: "Purina",
    productName: "Pro Plan Adult Sensitive Skin & Stomach Salmon & Rice Entree Classic Adult Dog Food",
    imageUrl: "/products-large/purina/purina-wet-pro-plan-adult-sensitive-skin-stomach-salmon-rice-entree-classic-adult-dog-food.webp",
    productType: "wet_food",
    isCurrent: false,
    dateLabel: "Aug 10, 2025 - Aug 16, 2025",
    scorecard: { avgStool: 6.0, stoolColor: "text-score-poor", stoolDays: 7, avgItch: 0, itchColor: "text-score-excellent", itchDays: 7 },
  },
]

const SUPPLEMENT_TYPES = new Set(["supplement", "probiotic", "topper", "treat"])
const TYPE_LABELS: Record<string, string> = { treat: "Treat", topper: "Supplement", supplement: "Supplement", probiotic: "Probiotic" }

// ────────────────────────────────────────────────────
// LAYOUT A: Current (baseline -what exists today)
// ────────────────────────────────────────────────────

function LayoutACurrent({ card }: { card: FoodData }): React.ReactElement {
  const isSupplement = card.productType != null && SUPPLEMENT_TYPES.has(card.productType)
  return (
    <Card className={`overflow-hidden gap-0 py-0 ${card.isCurrent ? "border-dashed" : ""}`}>
      <div className="flex items-center justify-center bg-muted px-3 py-3">
        <img src={card.imageUrl} alt={card.productName} className="h-28 w-auto object-contain mix-blend-multiply" />
      </div>
      <CardContent className="flex flex-1 flex-col pt-3 pb-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-text-tertiary">{card.brandName}</p>
        <p className="mt-0.5 text-sm font-semibold leading-snug text-foreground">{card.productName}</p>
        {isSupplement && <Badge variant="outline" className="mt-1 w-fit text-[10px] text-muted-foreground">{TYPE_LABELS[card.productType!] ?? card.productType}</Badge>}
        {card.quantity && <p className="mt-1 text-xs text-muted-foreground">{card.quantity}{card.quantityUnit} daily</p>}
        <div className="mt-3 flex flex-1 flex-col gap-3">
          {card.logStats && (
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              <div className="flex items-baseline gap-1.5">
                <span className={`text-lg font-bold tabular-nums ${card.logStats.stoolColor}`}>{card.logStats.avgStool}</span>
                <span className="text-xs text-muted-foreground">avg stool <span className="text-text-tertiary">({card.logStats.stoolLogs} logs)</span></span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-lg font-bold tabular-nums ${card.logStats.itchColor}`}>{card.logStats.avgItch}</span>
                <span className="text-xs text-muted-foreground">avg itch <span className="text-text-tertiary">({card.logStats.itchLogs} logs)</span></span>
              </div>
            </div>
          )}
          <div className="mt-auto flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{card.dateLabel}</p>
            {card.isCurrent ? (
              <Badge variant="outline" className="shrink-0 text-[10px]">Current</Badge>
            ) : (
              <button type="button" className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline underline-offset-2"><Pencil className="size-3" /> Edit</button>
            )}
          </div>
          {card.scorecard && (
            <>
              <Separator />
              <div className="space-y-2">
                {card.scorecard.verdict && (
                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${card.scorecard.verdict.bg} ${card.scorecard.verdict.text}`}>{card.scorecard.verdict.label}</span>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {card.scorecard.poopLabel && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Poop:</span> {card.scorecard.poopLabel}</p>}
                  {card.scorecard.itchLabel && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Itch:</span> {card.scorecard.itchLabel}</p>}
                  {card.scorecard.digestiveImpact && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Digestive impact:</span> {card.scorecard.digestiveImpact}</p>}
                  {card.scorecard.itchImpact && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Itch impact:</span> {card.scorecard.itchImpact}</p>}
                </div>
              </div>
            </>
          )}
          <button type="button" className="flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2">
            <ChevronDown className="size-3 transition-transform -rotate-90" /> View ingredients
          </button>
        </div>
      </CardContent>
    </Card>
  )
}

// ────────────────────────────────────────────────────
// LAYOUT B: "Structured" -name first (2-line clamp), Current tag on image,
// type as plain text, divider, 3-col score grid, no bg colors inside
// ────────────────────────────────────────────────────

// Shared score grid used by both B variants
function ScoreGrid({ card }: { card: FoodData }): React.ReactElement | null {
  if (card.logStats) {
    return (
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className={`text-xl font-bold tabular-nums ${card.logStats.stoolColor}`}>{card.logStats.avgStool}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Stool</p>
        </div>
        <div>
          <p className={`text-xl font-bold tabular-nums ${card.logStats.itchColor}`}>{card.logStats.avgItch}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Itch</p>
        </div>
        <div>
          <p className="text-xl font-bold tabular-nums text-muted-foreground">{card.logStats.stoolLogs + card.logStats.itchLogs}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Days</p>
        </div>
      </div>
    )
  }
  if (!card.scorecard) return null
  if (card.scorecard.avgStool != null || card.scorecard.avgItch != null) {
    return (
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className={`text-xl font-bold tabular-nums ${card.scorecard.stoolColor ?? "text-foreground"}`}>{card.scorecard.avgStool ?? "—"}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Stool</p>
        </div>
        <div>
          <p className={`text-xl font-bold tabular-nums ${card.scorecard.itchColor ?? "text-foreground"}`}>{card.scorecard.avgItch ?? "—"}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Itch</p>
        </div>
        <div>
          <p className="text-xl font-bold tabular-nums text-muted-foreground">{Math.max(card.scorecard.stoolDays ?? 0, card.scorecard.itchDays ?? 0)}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Days</p>
        </div>
      </div>
    )
  }
  if (card.scorecard.digestiveImpact || card.scorecard.itchImpact) {
    return (
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="flex flex-col items-center">
          <div className="flex h-7 items-center justify-center">
            {card.scorecard.digestiveImpact === "Better" ? (
              <ThumbsUp className="size-[18px] text-score-good" />
            ) : card.scorecard.digestiveImpact === "Worse" ? (
              <ThumbsDown className="size-[18px] text-score-poor" />
            ) : (
              <Minus className="size-[18px] text-muted-foreground" />
            )}
          </div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Stool</p>
        </div>
        <div className="flex flex-col items-center">
          <div className="flex h-7 items-center justify-center">
            {card.scorecard.itchImpact === "Better" ? (
              <ThumbsUp className="size-[18px] text-score-good" />
            ) : card.scorecard.itchImpact === "Worse" ? (
              <ThumbsDown className="size-[18px] text-score-poor" />
            ) : (
              <Minus className="size-[18px] text-muted-foreground" />
            )}
          </div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Itch</p>
        </div>
        <div>
          <p className="text-xl font-bold tabular-nums text-muted-foreground">{Math.max(card.scorecard.stoolDays ?? 0, card.scorecard.itchDays ?? 0)}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Days</p>
        </div>
      </div>
    )
  }
  return null
}

// B1: Score strip with warm bg, no divider
function LayoutB1Strip({ card }: { card: FoodData }): React.ReactElement {
  return (
    <Card className="overflow-hidden gap-0 py-0">
      <div className="relative flex items-center justify-center bg-muted px-3 py-3">
        <img src={card.imageUrl} alt={card.productName} className="h-28 w-auto object-contain mix-blend-multiply" />
        {card.isCurrent && (
          <Badge variant="outline" className="absolute top-2 right-2 text-[10px] bg-background">Current</Badge>
        )}
      </div>
      <CardContent className="flex flex-1 flex-col pt-3 pb-3 px-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-text-tertiary">{card.brandName}</p>
        <p className="mt-0.5 text-sm font-semibold leading-snug text-foreground line-clamp-2">{card.productName}</p>
        <p className="mt-1 pb-3 text-[11px] text-text-tertiary">{card.dateLabel}</p>

        {/* Score strip -warm bg, bleeds to card edges, pinned to bottom */}
        <div className="-mx-4 mt-auto pt-2 bg-score-strip px-4 py-2">
          <ScoreGrid card={card} />
        </div>

        <div className="pt-3 flex items-center justify-between gap-2">
          <button type="button" className="flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2">
            <ChevronDown className="size-3 transition-transform -rotate-90" /> View ingredients
          </button>
          {!card.isCurrent && (
            <button type="button" className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline underline-offset-2"><Pencil className="size-3" /> Edit</button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// B2: Score section with spacing only, no divider, no bg
function LayoutB2Spaced({ card }: { card: FoodData }): React.ReactElement {
  return (
    <Card className="overflow-hidden gap-0 py-0">
      <div className="relative flex items-center justify-center bg-muted px-3 py-3">
        <img src={card.imageUrl} alt={card.productName} className="h-28 w-auto object-contain mix-blend-multiply" />
        {card.isCurrent && (
          <Badge variant="outline" className="absolute top-2 right-2 text-[10px] bg-background">Current</Badge>
        )}
      </div>
      <CardContent className="flex flex-1 flex-col pt-3 pb-3 px-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-text-tertiary">{card.brandName}</p>
        <p className="mt-0.5 text-sm font-semibold leading-snug text-foreground line-clamp-2">{card.productName}</p>
        <p className="mt-1 text-[11px] text-text-tertiary">{card.dateLabel}</p>

        {/* Score section -spacing only */}
        <div className="my-4">
          <ScoreGrid card={card} />
        </div>

        <div className="mt-auto flex items-center justify-between gap-2">
          <button type="button" className="flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2">
            <ChevronDown className="size-3 transition-transform -rotate-90" /> View ingredients
          </button>
          {!card.isCurrent && (
            <button type="button" className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline underline-offset-2"><Pencil className="size-3" /> Edit</button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Layout registry ──

type LayoutId = "current" | "strip" | "spaced"

const LAYOUTS: { id: LayoutId; label: string; description: string }[] = [
  { id: "current", label: "A: Current", description: "Existing layout (baseline)" },
  { id: "strip", label: "B: Score Strip", description: "Scores in a warm bg strip that bleeds to card edges, no divider" },
  { id: "spaced", label: "C: Spaced", description: "Scores separated by vertical spacing only, no divider, no bg" },
]

function renderCard(layout: LayoutId, card: FoodData, idx: number): React.ReactElement {
  const key = `${layout}-${idx}`
  switch (layout) {
    case "current": return <LayoutACurrent key={key} card={card} />
    case "strip": return <LayoutB1Strip key={key} card={card} />
    case "spaced": return <LayoutB2Spaced key={key} card={card} />
  }
}

function ScorecardCardShowcase(): React.ReactElement {
  const [activeLayout, setActiveLayout] = useState<LayoutId>("current")
  const activeConfig = LAYOUTS.find((l) => l.id === activeLayout)!

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Food Scorecard Cards
      </h2>
      {/* Layout filter tags */}
      <div className="flex flex-wrap gap-1.5">
        {LAYOUTS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveLayout(id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              activeLayout === id
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-item-hover"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{activeConfig.description}</p>
      {/* Cards grid -3 wide */}
      <div className="grid grid-cols-3 gap-3">
        {SAMPLE_CARDS.map((card, idx) => renderCard(activeLayout, card, idx))}
      </div>
    </section>
  )
}

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

      {/* ── Food Scorecard Cards ── */}
      <ScorecardCardShowcase />

      {/* Logo iterations */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Logo Iterations
        </h2>
        <div className="flex items-end gap-8">
          {/* Current -can (BrandMark component) */}
          <div className="flex flex-col items-center gap-2">
            <BrandMark size={48} />
            <span className="text-xs text-muted-foreground">Current (can)</span>
          </div>

          {/* Old -circle badge */}
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

          {/* Iteration B -Kibble bag */}
          <div className="flex flex-col items-center gap-2">
            <svg width="60" height="80" viewBox="-1.5 1.5 35 46" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              {/* Bag body -standup pouch: straight sides, flat bottom */}
              <path
                d="M0,8 L0,44 Q0,46 2,46 L30,46 Q32,46 32,44 L32,8 Z"
                fill="#E8DCC8" stroke="#6B8C6F" strokeWidth="1.3" strokeLinejoin="round"
              />
              {/* Top seal -folded/crimped edge */}
              <path d="M0,8 L0,5 Q0,3 2,3 L30,3 Q32,3 32,5 L32,8" fill="#E8DCC8" stroke="#6B8C6F" strokeWidth="1.3" strokeLinejoin="round" />
              {/* Seal crimp line */}
              <line x1="4" y1="5.5" x2="28" y2="5.5" stroke="#6B8C6F" strokeWidth="0.7" strokeLinecap="round" opacity="0.45" />
              {/* Shoulder seam where seal meets body */}
              <line x1="0" y1="8" x2="32" y2="8" stroke="#6B8C6F" strokeWidth="0.5" opacity="0.25" />
              {/* Dog face -centered in bag */}
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

      {/* DatePickerInput -logger style */}
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

      {/* FecalScorePicker -Option A: Vertical */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Option A -Vertical List
        </h2>
        <FecalScorePickerVertical
          value={fecalVertical}
          onChange={setFecalVertical}
        />
      </section>

      {/* FecalScorePicker -Option B: Horizontal Scroll */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Option B -Horizontal Scroll Cards
        </h2>
        <FecalScorePickerHorizontal
          value={fecalHorizontal}
          onChange={setFecalHorizontal}
        />
      </section>

      {/* ScorePicker -Poop (1-7) */}
      <section className="space-y-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            ScorePicker -Firmness (1-7)
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

      {/* ScorePicker -Itch (1-5) */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          ScorePicker -Itchiness (1-5)
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
