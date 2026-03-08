"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Lightbulb, Plus, Settings, Utensils } from "lucide-react"
import { cn, isNavActive } from "@/lib/utils"
import { useActiveDog } from "@/components/active-dog-provider"
import { toast } from "sonner"

interface NavItem {
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  href?: string
  dogHref?: (dogId: string) => string
  prominent?: boolean
}

const NAV_LINKS: NavItem[] = [
  { label: "Home", icon: Home, href: "/" },
  { label: "Food", icon: Utensils, dogHref: (id) => `/dogs/${id}/food` },
  { label: "Log", icon: Plus, prominent: true },
  { label: "Insights", icon: Lightbulb, dogHref: (id) => `/dogs/${id}/insights` },
  { label: "Settings", icon: Settings, href: "/settings" },
]

function resolveHref(link: NavItem, activeDogId: string | null): string | null {
  if (link.href) return link.href
  if (link.dogHref && activeDogId) return link.dogHref(activeDogId)
  return null
}

export function DesktopNavLinks(): React.ReactElement {
  const pathname = usePathname()
  const { activeDogId } = useActiveDog()

  return (
    <nav className="flex items-center gap-6 text-sm text-text-secondary">
      {NAV_LINKS.filter((link) => !link.prominent).map((link) => {
        const href = resolveHref(link, activeDogId)
        const isSettings = link.label === "Settings"

        if (!href) {
          return (
            <button
              key={link.label}
              type="button"
              onClick={() => toast.error("Add a dog first")}
              className="transition-colors hover:text-text-primary"
            >
              {link.label}
            </button>
          )
        }

        return (
          <Link
            key={link.label}
            href={href}
            className={cn(
              "transition-colors hover:text-text-primary",
              isNavActive(href, pathname) && "text-text-primary font-medium",
            )}
          >
            {isSettings ? <><span className="sr-only">Settings</span><Settings className="size-5" strokeWidth={1.5} /></> : link.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function BottomNav(): React.ReactElement {
  const pathname = usePathname()
  const { activeDogId, setLogMode } = useActiveDog()

  function handleLogPress(): void {
    if (!activeDogId) {
      toast.error("Add a dog first")
      return
    }
    setLogMode("selector")
  }

  function handleNoDog(): void {
    toast.error("Add a dog first")
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-bg-primary md:hidden">
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around">
        {NAV_LINKS.map((link) => {
          const Icon = link.icon
          const href = resolveHref(link, activeDogId)
          const active = href ? isNavActive(href, pathname) : false

          if (link.prominent) {
            return (
              <button
                key={link.label}
                type="button"
                onClick={handleLogPress}
                aria-label="Log"
                className="flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Icon className="size-5" strokeWidth={1.5} />
                </span>
              </button>
            )
          }

          if (!href) {
            return (
              <button
                key={link.label}
                type="button"
                onClick={handleNoDog}
                className="flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 text-text-tertiary"
              >
                <Icon className="size-5" strokeWidth={1.5} />
                <span className="text-[10px] font-medium">{link.label}</span>
              </button>
            )
          }

          return (
            <Link
              key={link.label}
              href={href}
              className={cn(
                "flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5",
                active ? "text-primary" : "text-text-tertiary",
              )}
            >
              <Icon className="size-5" strokeWidth={1.5} />
              <span className="text-[10px] font-medium">{link.label}</span>
            </Link>
          )
        })}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  )
}
