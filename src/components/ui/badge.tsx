import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring-focus aria-invalid:border-destructive aria-invalid:ring-ring-destructive-light dark:aria-invalid:ring-ring-destructive-strong [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary-hover",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-muted",
        destructive:
          "bg-destructive text-white focus-visible:ring-ring-destructive-light dark:focus-visible:ring-ring-destructive-strong [a&]:hover:bg-destructive-hover",
        outline:
          "border-border text-foreground [a&]:hover:bg-secondary [a&]:hover:text-foreground",
        ghost: "[a&]:hover:bg-secondary [a&]:hover:text-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
