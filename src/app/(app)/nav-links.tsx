"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LiaHomeSolid,
  LiaLightbulbSolid,
  LiaPlusSolid,
  LiaDogSolid,
  LiaUtensilsSolid,
  LiaCapsulesSolid,
  LiaSunSolid,
  LiaMoonSolid,
} from "react-icons/lia"
import { useTheme } from "next-themes"
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
  { label: "Home", icon: LiaHomeSolid, href: "/" },
  { label: "Food", icon: LiaUtensilsSolid, dogHref: (id) => `/dogs/${id}/food` },
  { label: "Log", icon: LiaPlusSolid, prominent: true },
  { label: "Insights", icon: LiaLightbulbSolid, dogHref: (id) => `/dogs/${id}/insights` },
  { label: "Meds", icon: LiaCapsulesSolid, dogHref: (id) => `/dogs/${id}/meds` },
]

function resolveHref(link: NavItem, activeDogId: string | null): string {
  if (link.href) return link.href
  if (link.dogHref && activeDogId) return link.dogHref(activeDogId)
  return "/"
}

function ThemeToggle(): React.ReactElement {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return <span className="size-5" />
  }

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="p-1 rounded text-text-tertiary hover:text-text-primary transition-colors"
      aria-label="Toggle theme"
    >
      {resolvedTheme === "dark" ? <LiaSunSolid className="size-5" /> : <LiaMoonSolid className="size-5" />}
    </button>
  )
}

export function DesktopNavLinks(): React.ReactElement {
  const pathname = usePathname()
  const { activeDogId } = useActiveDog()

  return (
    <nav className="flex items-center gap-6 text-sm text-text-secondary">
      {NAV_LINKS.filter((link) => !link.prominent).map((link) => {
        const href = resolveHref(link, activeDogId)

        return (
          <Link
            key={link.label}
            href={href}
            className={cn(
              "transition-colors hover:text-text-primary",
              isNavActive(href, pathname) && "text-text-primary font-medium",
            )}
          >
            {link.label}
          </Link>
        )
      })}
      <Link
        href="/settings"
        className={cn(
          "transition-colors hover:text-text-primary",
          isNavActive("/settings", pathname) && "text-text-primary font-medium",
        )}
      >
        <span className="sr-only">Settings</span>
        <LiaDogSolid className="size-5" />
      </Link>
      <ThemeToggle />
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

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-bg-primary md:hidden">
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around">
        {NAV_LINKS.map((link) => {
          const Icon = link.icon
          const href = resolveHref(link, activeDogId)
          const active = isNavActive(href, pathname)

          if (link.prominent) {
            return (
              <button
                key={link.label}
                type="button"
                onClick={handleLogPress}
                aria-label="Log"
                className="flex flex-1 min-h-[44px] flex-col items-center justify-center gap-0.5"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Icon className="size-5" />
                </span>
              </button>
            )
          }

          return (
            <Link
              key={link.label}
              href={href}
              className={cn(
                "flex flex-1 min-h-[44px] flex-col items-center justify-center gap-0.5",
                active ? "text-primary" : "text-text-tertiary",
              )}
            >
              <Icon className="size-5" />
              <span className="text-[10px] font-medium">{link.label}</span>
            </Link>
          )
        })}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  )
}
