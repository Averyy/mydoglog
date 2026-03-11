"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { cn } from "@/lib/utils"

const SIZE_CLASSES = {
  default: "sm:max-w-md",
  lg: "sm:max-w-xl",
  wide: "sm:max-w-3xl",
} as const

interface ResponsiveModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  /** Dialog width on desktop. Mobile drawer is always full-width. */
  size?: keyof typeof SIZE_CLASSES
  children: React.ReactNode
}

export function ResponsiveModal({
  open,
  onOpenChange,
  title,
  description,
  size = "default",
  children,
}: ResponsiveModalProps): React.ReactElement {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent {...(!description ? { "aria-describedby": undefined } : {})}>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            {description && (
              <DrawerDescription>{description}</DrawerDescription>
            )}
          </DrawerHeader>
          <div
            className="max-h-[calc(90vh-8rem)] overflow-x-hidden overflow-y-auto px-4 pb-4"
            data-vaul-no-drag
          >
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[85vh]",
          size === "wide" ? "flex flex-col overflow-hidden p-0 gap-0" : "overflow-x-hidden overflow-y-auto",
          SIZE_CLASSES[size],
        )}
        {...(!description ? { "aria-describedby": undefined } : {})}
      >
        {size === "wide" ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{title}</DialogTitle>
              {description && <DialogDescription>{description}</DialogDescription>}
            </DialogHeader>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <DialogDescription>{description}</DialogDescription>
              )}
            </DialogHeader>
            <div className="min-w-0">{children}</div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
