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
  LiaBarsSolid,
  LiaBalanceScaleSolid,
  LiaSunSolid,
  LiaMoonSolid,
} from "react-icons/lia"
import { useTheme } from "next-themes"
import { cn, isNavActive } from "@/lib/utils"
import { useActiveDog } from "@/components/active-dog-provider"
import { toast } from "sonner"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"

interface NavItem {
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  href?: string
  dogHref?: (slug: string) => string
  prominent?: boolean
}

const NAV_LINKS: NavItem[] = [
  { label: "Home", icon: LiaHomeSolid, href: "/" },
  { label: "Food", icon: LiaUtensilsSolid, dogHref: (slug) => `/${slug}/food` },
  { label: "Log", icon: LiaPlusSolid, prominent: true },
  { label: "Meds", icon: LiaCapsulesSolid, dogHref: (slug) => `/${slug}/meds` },
  { label: "Insights", icon: LiaLightbulbSolid, dogHref: (slug) => `/${slug}/insights` },
]

function resolveHref(link: NavItem, activeDogSlug: string | null): string {
  if (link.href) return link.href
  if (link.dogHref && activeDogSlug) return link.dogHref(activeDogSlug)
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
  const { activeDogSlug } = useActiveDog()

  return (
    <nav className="flex items-center gap-8 text-sm text-text-secondary">
      {NAV_LINKS.filter((link) => !link.prominent).map((link) => {
        const href = resolveHref(link, activeDogSlug)

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
        href={activeDogSlug ? `/${activeDogSlug}/compare` : "/"}
        className={cn(
          "transition-colors hover:text-text-primary",
          pathname.endsWith("/compare") && "text-text-primary font-medium",
        )}
      >
        Compare
      </Link>
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

function MenuThemeToggle(): React.ReactElement {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) return <span className="size-5" />

  const isDark = resolvedTheme === "dark"

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-text-secondary hover:bg-item-hover transition-colors"
    >
      {isDark ? <LiaSunSolid className="size-5" /> : <LiaMoonSolid className="size-5" />}
      <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
    </button>
  )
}

export function BottomNav(): React.ReactElement {
  const pathname = usePathname()
  const { activeDogId, activeDogSlug, setLogMode } = useActiveDog()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  function handleLogPress(): void {
    if (!activeDogId) {
      toast.error("Add a dog first")
      return
    }
    setLogMode("selector")
  }

  const homeHref = "/"
  const foodHref = activeDogSlug ? `/${activeDogSlug}/food` : "/"
  const insightsHref = activeDogSlug ? `/${activeDogSlug}/insights` : "/"
  const medsHref = activeDogSlug ? `/${activeDogSlug}/meds` : "/"
  const compareHref = activeDogSlug ? `/${activeDogSlug}/compare` : "/"

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-bg-primary md:hidden">
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around">
        {/* Home */}
        <Link
          href={homeHref}
          className={cn(
            "flex flex-1 min-h-[44px] flex-col items-center justify-center gap-0.5",
            isNavActive(homeHref, pathname) ? "text-primary" : "text-text-tertiary",
          )}
        >
          <LiaHomeSolid className="size-5" />
          <span className="text-[10px] font-medium">Home</span>
        </Link>

        {/* Food */}
        <Link
          href={foodHref}
          className={cn(
            "flex flex-1 min-h-[44px] flex-col items-center justify-center gap-0.5",
            isNavActive(foodHref, pathname) ? "text-primary" : "text-text-tertiary",
          )}
        >
          <LiaUtensilsSolid className="size-5" />
          <span className="text-[10px] font-medium">Food</span>
        </Link>

        {/* Log (+) */}
        <button
          type="button"
          onClick={handleLogPress}
          aria-label="Log"
          className="flex flex-1 min-h-[44px] flex-col items-center justify-center gap-0.5"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <LiaPlusSolid className="size-5" />
          </span>
        </button>

        {/* Insights */}
        <Link
          href={insightsHref}
          className={cn(
            "flex flex-1 min-h-[44px] flex-col items-center justify-center gap-0.5",
            isNavActive(insightsHref, pathname) ? "text-primary" : "text-text-tertiary",
          )}
        >
          <LiaLightbulbSolid className="size-5" />
          <span className="text-[10px] font-medium">Insights</span>
        </Link>

        {/* Menu — render popover only after mount to avoid hydration mismatch from Radix IDs */}
        {mounted ? (
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex flex-1 min-h-[44px] flex-col items-center justify-center gap-0.5",
                  menuOpen ? "text-primary" : "text-text-tertiary",
                )}
              >
                <LiaBarsSolid className="size-5" />
                <span className="text-[10px] font-medium">Menu</span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              sideOffset={12}
              className="w-48 p-1"
            >
              <Link
                href={medsHref}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-item-hover",
                  isNavActive(medsHref, pathname) ? "text-primary font-medium" : "text-text-secondary",
                )}
              >
                <LiaCapsulesSolid className="size-5" />
                <span>Meds</span>
              </Link>
              <Link
                href={compareHref}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-item-hover",
                  pathname.endsWith("/compare") ? "text-primary font-medium" : "text-text-secondary",
                )}
              >
                <LiaBalanceScaleSolid className="size-5" />
                <span>Compare</span>
              </Link>
              <Link
                href="/settings"
                onClick={() => setMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-item-hover",
                  isNavActive("/settings", pathname) ? "text-primary font-medium" : "text-text-secondary",
                )}
              >
                <LiaDogSolid className="size-5" />
                <span>Dog</span>
              </Link>
              <div className="my-0.5 h-px bg-border" />
              <MenuThemeToggle />
            </PopoverContent>
          </Popover>
        ) : (
          <span className="flex flex-1 min-h-[44px] flex-col items-center justify-center gap-0.5 text-text-tertiary">
            <LiaBarsSolid className="size-5" />
            <span className="text-[10px] font-medium">Menu</span>
          </span>
        )}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  )
}
