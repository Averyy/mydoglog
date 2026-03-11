"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { ResponsiveModal } from "@/components/responsive-modal"
import { MedicationPicker, type MedicationPickerResult } from "@/components/medication-picker"
import { DatePickerInput } from "@/components/date-picker-input"
import { CollapsibleNotes } from "@/components/collapsible-notes"
import { toast } from "sonner"
import { DOSING_INTERVAL_LABELS } from "@/lib/labels"
import type { MedicationSummary } from "@/lib/types"

const INTERVAL_OPTIONS = Object.entries(DOSING_INTERVAL_LABELS).map(
  ([value, label]) => ({ value, label }),
)

interface MedicationFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dogId: string
  medication: MedicationSummary | null
  onSaved: () => void
}

export function MedicationForm({
  open,
  onOpenChange,
  dogId,
  medication,
  onSaved,
}: MedicationFormProps): React.ReactElement {
  const isEdit = !!medication

  const [pickerValue, setPickerValue] = useState<MedicationPickerResult | null>(null)
  const [dosage, setDosage] = useState("")
  const [interval, setInterval] = useState("")
  const [startDate, setStartDate] = useState("")
  const [currentlyTaking, setCurrentlyTaking] = useState(true)
  const [endDate, setEndDate] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Initialize form when opening
  useEffect(() => {
    if (!open) return
    if (medication) {
      setPickerValue({
        medicationProductId: medication.medicationProductId,
        name: medication.name,
        defaultIntervals: [],
        dosageForm: medication.dosageForm ?? null,
        description: medication.description ?? null,
        commonSideEffects: medication.commonSideEffects ?? null,
        sideEffectsSources: medication.sideEffectsSources ?? null,
      })
      setDosage(medication.dosage ?? "")
      setInterval(medication.interval ?? "")
      setStartDate(medication.startDate)
      setCurrentlyTaking(!medication.endDate)
      setEndDate(medication.endDate ?? "")
      setNotes(medication.notes ?? "")
    } else {
      setPickerValue(null)
      setDosage("")
      setInterval("")
      setStartDate(new Date().toISOString().split("T")[0])
      setCurrentlyTaking(true)
      setEndDate("")
      setNotes("")
    }
  }, [open, medication])

  function handlePickerChange(result: MedicationPickerResult): void {
    setPickerValue(result)
    // Pre-fill interval from catalog defaults
    if (result.defaultIntervals.length > 0 && !interval) {
      setInterval(result.defaultIntervals[0])
    }
  }

  async function handleSave(): Promise<void> {
    if (!pickerValue?.name.trim()) {
      toast.error("Select a medication")
      return
    }

    setSaving(true)
    try {
      if (isEdit) {
        const res = await fetch(`/api/medications/${medication!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: pickerValue.name.trim(),
            dosage: dosage.trim() || null,
            medicationProductId: pickerValue.medicationProductId,
            interval: interval || null,
            endDate: !currentlyTaking && endDate ? endDate : null,
            notes: notes.trim() || null,
          }),
        })
        if (!res.ok) {
          const data = await res.json()
          toast.error(data.error ?? "Failed to update medication")
          return
        }
        toast.success("Medication updated")
      } else {
        const res = await fetch(`/api/dogs/${dogId}/medications`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: pickerValue.name.trim(),
            dosage: dosage.trim() || undefined,
            medicationProductId: pickerValue.medicationProductId || undefined,
            interval: interval || undefined,
            startDate: startDate || undefined,
            endDate: !currentlyTaking && endDate ? endDate : undefined,
            notes: notes.trim() || undefined,
          }),
        })
        if (!res.ok) {
          const data = await res.json()
          toast.error(data.error ?? "Failed to add medication")
          return
        }
        toast.success("Medication added")
      }
      onSaved()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!medication) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/medications/${medication.id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        toast.error("Failed to delete medication")
        return
      }
      toast.success("Medication deleted")
      onSaved()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit medication" : "Add medication"}
    >
      <div className="space-y-4">
        {/* Medication picker */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Medication
          </Label>
          <MedicationPicker value={pickerValue} onChange={handlePickerChange} />
        </div>

        {/* Dosage + Interval row */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Dosage &amp; interval
          </Label>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. 4.25mg"
              value={dosage}
              onChange={(e) => setDosage(e.target.value)}
              className="min-w-0 w-0 flex-1"
            />
            <Select value={interval} onValueChange={setInterval}>
              <SelectTrigger className="min-w-0 w-0 flex-1">
                <SelectValue placeholder="Interval" />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Start date */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Start date
          </Label>
          <DatePickerInput value={startDate} onChange={setStartDate} placeholder="Pick a date" />
        </div>

        {/* Currently taking checkbox + end date */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={currentlyTaking}
              onCheckedChange={(checked) => {
                setCurrentlyTaking(!!checked)
                if (!checked && !endDate) {
                  setEndDate(new Date().toISOString().split("T")[0])
                }
              }}
            />
            <span className="text-sm">Currently taking</span>
          </label>
          {!currentlyTaking && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                End date
              </Label>
              <DatePickerInput value={endDate} onChange={setEndDate} placeholder="Pick end date" />
            </div>
          )}
        </div>

        {/* Notes */}
        <CollapsibleNotes
          value={notes}
          onChange={setNotes}
          label="Add notes"
          placeholder="Optional notes..."
        />

        {/* Actions — matches log entry editor pattern */}
        <div className="flex items-center justify-between pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || deleting}>
            Cancel
          </Button>
          <div className="flex items-center gap-6">
            {isEdit && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="link" size="sm" className="text-destructive px-0" disabled={saving || deleting}>
                    {deleting ? "Deleting..." : "Delete"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete medication?</AlertDialogTitle>
                    <AlertDialogDescription>This medication record will be permanently removed.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={handleDelete}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button onClick={handleSave} disabled={saving || deleting}>
              {saving ? "Saving..." : isEdit ? "Save changes" : "Add medication"}
            </Button>
          </div>
        </div>
      </div>
    </ResponsiveModal>
  )
}
