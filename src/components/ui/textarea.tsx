import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none hover:bg-item-hover-subtle hover:border-border-hover placeholder:text-muted-foreground focus-visible:bg-background focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-ring-destructive-light md:text-sm dark:bg-input-surface dark:aria-invalid:ring-ring-destructive-strong",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
