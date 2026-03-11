"use client"

import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { cn } from "@/lib/utils"

interface ResponsivePopoverProps {
  trigger: React.ReactNode
  /** Accessible title for the drawer on mobile */
  title?: string
  /** PopoverContent alignment on desktop */
  align?: "start" | "center" | "end"
  /** Extra className for the desktop PopoverContent */
  contentClassName?: string
  children: React.ReactNode
}

export function ResponsivePopover({
  trigger,
  title = "Details",
  align = "start",
  contentClassName,
  children,
}: ResponsivePopoverProps): React.ReactElement {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  if (isMobile) {
    return (
      <>
        <span className="contents" onClick={() => setOpen(true)}>{trigger}</span>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent aria-describedby={undefined}>
            <div className="pb-3" />
            <DrawerHeader className="sr-only">
              <DrawerTitle>{title}</DrawerTitle>
            </DrawerHeader>
            <div className="max-h-[calc(85vh-4rem)] overflow-y-auto overscroll-contain px-4 pb-6">
              {children}
            </div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-auto max-w-[min(90vw,560px)] max-h-[70vh] overflow-y-auto p-0", contentClassName)}
        align={align}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
