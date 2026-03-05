"use client"

import { useRouter } from "next/navigation"
import { Clipboard, Cookie, Droplets, CalendarCheck } from "lucide-react"
import { ResponsiveModal } from "@/components/responsive-modal"
import { QuickPoopLogger } from "@/components/quick-poop-logger"
import { TreatLoggerContent } from "@/components/treat-logger"
import { ItchinessLogger } from "@/components/itchiness-logger"
import { DailyCheckInContent } from "@/components/daily-checkin"
import { useActiveDog, type LogMode } from "@/components/active-dog-provider"
import { format } from "date-fns"

const SELECTOR_OPTIONS: {
  mode: LogMode
  label: string
  icon: typeof Clipboard
}[] = [
  { mode: "checkin", label: "Daily Check-in", icon: CalendarCheck },
  { mode: "poop", label: "Log Stool", icon: Clipboard },
  { mode: "itch", label: "Log Itchiness", icon: Droplets },
  { mode: "treat", label: "Log Treat", icon: Cookie },
]

export function LogActionSheet(): React.ReactElement {
  const router = useRouter()
  const { activeDogId, logMode, setLogMode } = useActiveDog()

  function close(): void {
    setLogMode("closed")
  }

  function selectOption(mode: LogMode): void {
    setLogMode("closed")
    requestAnimationFrame(() => setLogMode(mode))
  }

  function handleSaved(): void {
    close()
    router.refresh()
  }

  return (
    <>
      {/* Selector */}
      <ResponsiveModal
        open={logMode === "selector"}
        onOpenChange={(open) => !open && close()}
        title="New log entry"
        description="What would you like to log?"
      >
        <div className="grid grid-cols-2 gap-3 py-2">
          {SELECTOR_OPTIONS.map((opt) => {
            const Icon = opt.icon
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => selectOption(opt.mode)}
                className="flex min-h-[80px] flex-col items-center justify-center gap-2 rounded-lg border border-border bg-bg-primary px-4 py-4 text-text-secondary transition-colors hover:border-accent hover:text-accent"
              >
                <Icon className="size-6" strokeWidth={1.5} />
                <span className="text-[13px] font-medium">{opt.label}</span>
              </button>
            )
          })}
        </div>
      </ResponsiveModal>

      {/* Poop logger */}
      <ResponsiveModal
        open={logMode === "poop"}
        onOpenChange={(open) => !open && close()}
        title="Log stool"
        description="Scroll to select the stool score."
      >
        {logMode === "poop" && activeDogId && (
          <QuickPoopLogger dogId={activeDogId} onSaved={handleSaved} />
        )}
      </ResponsiveModal>

      {/* Treat logger */}
      <ResponsiveModal
        open={logMode === "treat"}
        onOpenChange={(open) => !open && close()}
        title="Log treat"
        description="Record a treat or snack."
      >
        {logMode === "treat" && activeDogId && (
          <TreatLoggerContent dogId={activeDogId} onSaved={handleSaved} />
        )}
      </ResponsiveModal>

      {/* Itch logger */}
      <ResponsiveModal
        open={logMode === "itch"}
        onOpenChange={(open) => !open && close()}
        title="Log itchiness"
        description="Scroll to select the itchiness level."
      >
        {logMode === "itch" && activeDogId && (
          <ItchinessLogger dogId={activeDogId} onSaved={handleSaved} />
        )}
      </ResponsiveModal>

      {/* Daily check-in */}
      <ResponsiveModal
        open={logMode === "checkin"}
        onOpenChange={(open) => !open && close()}
        title={`${format(new Date(), "EEEE MMM d")} check-in`}
        size="lg"
      >
        {logMode === "checkin" && activeDogId && (
          <DailyCheckInContent dogId={activeDogId} onSaved={handleSaved} />
        )}
      </ResponsiveModal>
    </>
  )
}
