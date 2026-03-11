"use client"

import { useRouter } from "next/navigation"
import { ResponsiveModal } from "@/components/responsive-modal"
import { QuickPoopLogger } from "@/components/quick-poop-logger"
import { TreatLoggerContent } from "@/components/treat-logger"
import { ItchinessLogger } from "@/components/itchiness-logger"
import { DailyCheckInContent } from "@/components/daily-checkin"
import { QuickLogGrid } from "@/components/quick-log-grid"
import { useActiveDog, type LogMode } from "@/components/active-dog-provider"
import { format } from "date-fns"

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
    window.dispatchEvent(new Event("log-saved"))
  }

  return (
    <>
      {/* Selector */}
      <ResponsiveModal
        open={logMode === "selector"}
        onOpenChange={(open) => !open && close()}
        title="New log entry"
      >
        <div className="py-2">
          {activeDogId && (
            <QuickLogGrid dogId={activeDogId} onSelect={selectOption} />
          )}
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
