import { cn } from "@/lib/utils"

interface CompareSectionProps {
  title: string
  children: React.ReactNode
  trailing?: React.ReactNode
  /** Use thick nutrition-label style bars */
  nutritionStyle?: boolean
}

export function CompareSection({
  title,
  children,
  trailing,
  nutritionStyle = false,
}: CompareSectionProps): React.ReactElement {
  return (
    <div className={cn(
      nutritionStyle
        ? "border-t-[3px] border-foreground"
        : "border-t border-border",
    )}>
      <div className="flex items-center justify-between px-3 pb-1 pt-3 sm:px-4">
        <span className={cn(
          "uppercase tracking-widest",
          nutritionStyle
            ? "text-xs font-bold text-foreground"
            : "text-[11px] font-medium text-muted-foreground",
        )}>
          {title}
        </span>
        {trailing}
      </div>
      {children}
    </div>
  )
}
