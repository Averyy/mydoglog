import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { BottomNav, DesktopNavLinks } from "./nav-links"
import Link from "next/link"
import { BrandMark } from "@/components/brand-mark"
import { ActiveDogProvider } from "@/components/active-dog-provider"
import { LogActionSheet } from "@/components/log-action-sheet"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}): Promise<React.ReactElement> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    redirect("/login")
  }

  return (
    <ActiveDogProvider>
      <div className="flex min-h-screen flex-col bg-bg-secondary">
        {/* Desktop top nav — hidden on mobile */}
        <header className="hidden border-b border-border bg-bg-primary md:block">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-text-primary">
              <BrandMark size={24} />
              MyDogLog
            </Link>
            <DesktopNavLinks />
          </div>
        </header>

        {/* Main content — bottom padding on mobile for fixed nav */}
        <div className="mx-auto flex flex-1 flex-col max-w-5xl px-4 py-6 pb-24 md:pb-6 w-full">
          {children}
        </div>

        {/* Mobile bottom nav — visible only on mobile */}
        <BottomNav />
        <LogActionSheet />
      </div>
    </ActiveDogProvider>
  )
}
