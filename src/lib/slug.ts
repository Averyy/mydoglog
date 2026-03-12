import { db, dogs } from "@/lib/db"
import { and, eq, ne } from "drizzle-orm"

export const RESERVED_SLUGS = new Set([
  // Existing routes
  "api", "login", "signup", "settings", "dogs", "test-inputs",
  // Common web paths
  "admin", "dashboard", "home", "app", "account", "profile", "help",
  "support", "about", "privacy", "terms", "tos", "contact", "pricing",
  "blog", "docs", "status", "health", "auth", "oauth", "callback",
  "verify", "reset", "invite", "share", "public", "static", "assets",
  "images", "fonts", "css", "js", "favicon", "robots", "sitemap",
  "feed", "rss", "mcp", "cron", "webhook", "webhooks", "setup",
  "onboarding", "welcome", "new", "create", "edit", "delete", "search",
  "explore", "notifications", "messages", "inbox", "log", "logs",
  "food", "meds", "insights", "poop", "treats", "products-small",
  "products-large",
])

/** Strip non-letters/non-spaces, collapse spaces, trim, cap at 20 chars. */
export function sanitizeDogName(raw: string): string {
  return raw
    .replace(/[^a-zA-Z ]/g, "")
    .replace(/ +/g, " ")
    .trim()
    .slice(0, 20)
}

/** Returns error message if invalid, null if ok. */
export function validateDogName(name: string): string | null {
  const sanitized = sanitizeDogName(name)
  if (sanitized.length < 3) {
    return "Name must be at least 3 characters"
  }
  return null
}

/** Lowercase, spaces → hyphens. Input must already be sanitized. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/ /g, "-")
}

/** Generate a unique slug for a dog within the owner's namespace. */
export async function generateUniqueSlug(
  name: string,
  ownerId: string,
  excludeDogId?: string,
): Promise<string> {
  let base = slugify(name)

  if (RESERVED_SLUGS.has(base)) {
    base = `dog-${base}`
  }

  // Get existing slugs for this owner
  const conditions = [eq(dogs.ownerId, ownerId)]
  if (excludeDogId) {
    conditions.push(ne(dogs.id, excludeDogId))
  }

  const existing = await db
    .select({ slug: dogs.slug })
    .from(dogs)
    .where(and(...conditions))

  const existingSlugs = new Set(existing.map((r) => r.slug))

  if (!existingSlugs.has(base)) return base

  let suffix = 2
  while (existingSlugs.has(`${base}-${suffix}`)) {
    suffix++
  }
  return `${base}-${suffix}`
}
