"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ResponsiveModal } from "@/components/responsive-modal"
import { toast } from "sonner"
import { TIMELINE_OPTIONS, type ExportSection } from "@/lib/export-llm"

interface ExportLlmModalProps {
  dogId: string
  dogName: string
  environmentEnabled: boolean
}

/** Each toggle maps to one or more ExportSection keys sent to the API. */
interface SectionGroup {
  id: string
  label: string
  description: string
  sections: ExportSection[]
  envOnly?: boolean
}

const SECTION_GROUPS: SectionGroup[] = [
  {
    id: "profile-diet",
    label: "Profile & Current Diet",
    description: "Dog info, active food plan, supplements, treats, medications",
    sections: ["profile", "current-diet", "supplements", "medications"],
  },
  {
    id: "history",
    label: "Food & Medication History",
    description: "All feeding periods and medication records over time",
    sections: ["food-history", "medication-history"],
  },
  {
    id: "daily-log",
    label: "Daily Log Table",
    description: "Day-by-day poop, itch, pollen, food, and medication data",
    sections: ["daily-log"],
  },
  {
    id: "analysis",
    label: "Ingredient Analysis",
    description: "Correlation scores, cross-reactivity groups, computed stats",
    sections: ["correlation", "cross-reactivity", "reference-stats", "links"],
  },
  {
    id: "pollen",
    label: "Pollen & Symptoms",
    description: "Symptom averages grouped by pollen level",
    sections: ["pollen"],
    envOnly: true,
  },
]

export function ExportLlmModal({
  dogId,
  dogName,
  environmentEnabled,
}: ExportLlmModalProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [timeline, setTimeline] = useState("6m")
  const [excludedGroups, setExcludedGroups] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const visibleGroups = SECTION_GROUPS.filter(
    (g) => !g.envOnly || environmentEnabled,
  )

  const allExcluded = visibleGroups.every((g) => excludedGroups.has(g.id))

  // Abort in-flight request when modal closes or component unmounts
  useEffect(() => {
    if (!open && abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }, [open])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  function toggleGroup(groupId: string): void {
    setExcludedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  function getExcludedSections(): ExportSection[] {
    const excluded: ExportSection[] = []
    for (const group of SECTION_GROUPS) {
      if (excludedGroups.has(group.id)) {
        excluded.push(...group.sections)
      }
    }
    return excluded
  }

  const handleDownload = useCallback(async (): Promise<void> => {
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const params = new URLSearchParams({ timeline })
      const excluded = getExcludedSections()
      if (excluded.length > 0) {
        params.set("exclude", excluded.join(","))
      }

      const res = await fetch(`/api/dogs/${dogId}/export/llm?${params}`, {
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`Export failed: ${res.status}`)
      }

      const { text } = await res.json()
      const safeName = dogName.replace(/[^a-zA-Z0-9_-]/g, "_")
      const now = new Date()
      const mm = String(now.getMonth() + 1).padStart(2, "0")
      const dd = String(now.getDate()).padStart(2, "0")
      const yyyy = now.getFullYear()
      const filename = `${safeName}-${mm}-${dd}-${yyyy}-Export.md`

      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      toast.success("Export downloaded")
      setOpen(false)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      toast.error("Failed to generate export")
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dogId, dogName, timeline, excludedGroups])

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        ✨ Export for AI
      </Button>

      <ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        title={`Export ${dogName} for AI`}
        description="Generate a structured data export to paste into Claude or another LLM for diet and health advice."
      >
        <div className="space-y-5">
          {/* Timeline selector */}
          <div className="space-y-1.5">
            <label
              htmlFor="export-timeline-select"
              className="text-sm font-medium text-foreground"
            >
              Daily log time range
            </label>
            <Select value={timeline} onValueChange={setTimeline}>
              <SelectTrigger id="export-timeline-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent showScrollButtons={false}>
                {TIMELINE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Section groups */}
          <div className="space-y-1.5">
            <span id="export-sections-label" className="text-sm font-medium text-foreground">
              Sections
            </span>
            <p className="text-xs text-muted-foreground">
              Preamble and scoring systems are always included.
            </p>
            <div
              className="mt-2 space-y-1"
              role="group"
              aria-labelledby="export-sections-label"
            >
              {visibleGroups.map((group) => {
                const checked = !excludedGroups.has(group.id)
                return (
                  <label
                    key={group.id}
                    className="flex items-start gap-3 rounded-md px-3 py-2.5 cursor-pointer transition-colors hover:bg-item-hover-subtle active:bg-item-active"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleGroup(group.id)}
                      className="mt-0.5"
                    />
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium leading-none">
                        {group.label}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {group.description}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Download button */}
          <Button
            className="w-full"
            onClick={handleDownload}
            disabled={loading || allExcluded}
          >
            {loading ? "Generating..." : "Download Export"}
          </Button>
        </div>
      </ResponsiveModal>
    </>
  )
}
