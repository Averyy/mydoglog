"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ResponsiveModal } from "@/components/responsive-modal"
import { LiaInfoCircleSolid } from "react-icons/lia"
import { cn } from "@/lib/utils"
import Image from "next/image"

export const SCORES = [
  {
    score: 1,
    label: "Hard pellets",
    description:
      "Very hard and dry; requires much effort to expel from body; no residue left on ground when picked up. Often expelled as individual pellets.",
    color: "#D4A944",
  },
  {
    score: 2,
    label: "Ideal",
    description:
      "Firm, but not hard; should be pliable; segmented appearance; little or no residue left on ground when picked up.",
    color: "#6B8C6F",
    ideal: true,
  },
  {
    score: 3,
    label: "Soft",
    description:
      "Log-like; little or no segmentation visible; moist surface; leaves residue, but holds form when picked up.",
    color: "#8FB896",
  },
  {
    score: 4,
    label: "Soggy",
    description:
      "Very moist (soggy); distinct log shape visible; leaves residue and loses form when picked up.",
    color: "#D4A944",
  },
  {
    score: 5,
    label: "Soft piles",
    description:
      "Very moist but has distinct shape; present in piles rather than as distinct logs; leaves residue and loses form when picked up.",
    color: "#D4A944",
  },
  {
    score: 6,
    label: "No shape",
    description:
      "Has texture, but no defined shape; occurs as piles or as spots; leaves residue when picked up.",
    color: "#C97C5D",
  },
  {
    score: 7,
    label: "Liquid",
    description:
      "Watery, no texture, flat; occurs as puddles.",
    color: "#B84A3A",
  },
]

interface FecalScoreGuideProps {
  className?: string
  onSelect?: (score: number) => void
}

export function FecalScoreGuide({ className, onSelect }: FecalScoreGuideProps): React.ReactElement {
  const [open, setOpen] = useState(false)

  function handleSelect(score: number): void {
    if (onSelect) {
      onSelect(score)
      setOpen(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={cn("text-muted-foreground", className)}
        aria-label="Fecal scoring guide"
        onClick={() => setOpen(true)}
      >
        <LiaInfoCircleSolid className="size-4" />
      </Button>
      <ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        title="Purina Fecal Scoring Chart"
        description={
          onSelect
            ? "Tap a score to select it. Score 2 is ideal."
            : "Score 2 is ideal. Based on the Nestlé Purina fecal scoring system."
        }
        size="lg"
      >
        <div className="space-y-1.5">
          {SCORES.map((s) => {
            const isClickable = !!onSelect
            const Row = isClickable ? "button" : "div"
            return (
              <Row
                key={s.score}
                type={isClickable ? "button" : undefined}
                onClick={isClickable ? () => handleSelect(s.score) : undefined}
                className={cn(
                  "flex w-full gap-3 rounded-lg border p-3 text-left transition-colors",
                  s.ideal
                    ? "border-border-hover bg-item-hover"
                    : "border-transparent",
                  isClickable && "cursor-pointer hover:border-border-hover hover:bg-item-hover active:bg-item-active",
                )}
              >
                <div className="relative size-16 shrink-0 overflow-hidden rounded-md">
                  <Image
                    src={`/images/fecal-scores/score${s.score}.png`}
                    alt={`Score ${s.score}: ${s.label}`}
                    fill
                    className="object-cover"
                    sizes="64px"
                  />
                </div>
                <div className="flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex size-5 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: s.color }}
                    >
                      {s.score}
                    </span>
                    <span className="text-sm font-semibold">{s.label}</span>
                    {s.ideal && (
                      <span className="rounded-full bg-item-hover px-2 py-0.5 text-[10px] font-semibold text-primary">
                        IDEAL
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {s.description}
                  </p>
                </div>
              </Row>
            )
          })}
        </div>
        <div className="border-t pt-3 mt-3">
          <p className="text-[10px] text-muted-foreground">
            Source: Nestlé Purina PetCare — Fecal Scoring System. Consult your veterinarian for digestive health concerns.
          </p>
        </div>
      </ResponsiveModal>
    </>
  )
}
