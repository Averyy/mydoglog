import { cn } from "@/lib/utils"

interface CompareRowProps {
  label: string
  /** Optional qualifier shown after label e.g. "(min)" */
  qualifier?: string
  values: (string | null)[]
  className?: string
  mono?: boolean
  /** Use nutrition-label styling (bold label, thin rule separator) */
  nutritionStyle?: boolean
}

const LABEL_WIDTH = "120px"

export function CompareRow({
  label,
  qualifier,
  values,
  className,
  mono = false,
  nutritionStyle = false,
}: CompareRowProps): React.ReactElement {
  return (
    <div
      className={cn(
        "grid items-baseline gap-6 px-3 sm:px-4",
        nutritionStyle ? "border-t border-compare-rule py-[5px]" : "py-1.5",
        className,
      )}
      style={{
        gridTemplateColumns: `${LABEL_WIDTH} repeat(${values.length}, minmax(0, 1fr))`,
      }}
    >
      <span className={cn(
        "truncate text-xs",
        nutritionStyle
          ? "font-bold leading-tight text-foreground"
          : "text-muted-foreground",
      )}>
        {label}
        {qualifier && (
          <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">
            ({qualifier})
          </span>
        )}
      </span>
      {values.map((value, i) => (
        <div key={i} className="flex justify-center">
          <span
            className={cn(
              "select-text text-sm tabular-nums",
              mono && "font-mono",
              value === null ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {value ?? "—"}
          </span>
        </div>
      ))}
    </div>
  )
}

export { LABEL_WIDTH }
