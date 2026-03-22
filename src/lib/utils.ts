import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Convert a DB product image path to its small thumbnail equivalent. */
export function smallImageUrl(imageUrl: string): string {
  if (imageUrl.startsWith("/products/")) {
    const rest = imageUrl.slice("/products/".length)
    const dotIdx = rest.lastIndexOf(".")
    const stem = dotIdx >= 0 ? rest.slice(0, dotIdx) : rest
    return `/products-small/${stem}.webp`
  }
  return imageUrl
}

/** Convert a DB product image path to its large display equivalent. */
export function largeImageUrl(imageUrl: string): string {
  if (imageUrl.startsWith("/products/")) {
    const rest = imageUrl.slice("/products/".length)
    const dotIdx = rest.lastIndexOf(".")
    const stem = dotIdx >= 0 ? rest.slice(0, dotIdx) : rest
    return `/products-large/${stem}.webp`
  }
  return imageUrl
}

/** Strip redundant brand name prefix from a product name for compact display. */
export function stripBrandPrefix(name: string, brandName: string): string {
  if (name.toLowerCase().startsWith(brandName.toLowerCase())) {
    const stripped = name.slice(brandName.length).replace(/^[\s\-–—]+/, "")
    if (stripped.length > 0) return stripped
  }
  return name
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Get today's date as YYYY-MM-DD in America/Toronto timezone. */
export function getToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" })
}

/** Shared nav active-state check used by bottom nav and desktop nav. */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/"
  if (pathname === href) return true
  if (!pathname.startsWith(href + "/")) return false
  // Only match direct children (one segment deep), not deeply nested paths
  // e.g. /dogs matches /dogs/new but NOT /dogs/[id]/feeding
  const rest = pathname.slice(href.length + 1)
  return !rest.includes("/")
}
