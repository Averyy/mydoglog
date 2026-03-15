import { cn } from "@/lib/utils"

interface BrandMarkProps {
  className?: string
  size?: number
}

export function BrandMark({ className, size = 40 }: BrandMarkProps): React.ReactElement {
  return (
    <div className={cn("flex items-center justify-center", className)}>
      <svg
        width={size * 0.75}
        height={size}
        viewBox="3.5 7 29 37"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Can body — closed path, curved bottom */}
        <path d="M5,12 V37 C5,41 11,43 18,43 C25,43 31,41 31,37 V12 Z" className="fill-[#E8DCC8] stroke-[#6B8C6F] dark:fill-[#4A4238] dark:stroke-[#8FB896]" strokeWidth="1.3" strokeLinejoin="round" />
        {/* Top lid */}
        <ellipse cx="18" cy="12" rx="13" ry="4" className="fill-[#E8DCC8] stroke-[#6B8C6F] dark:fill-[#4A4238] dark:stroke-[#8FB896]" strokeWidth="1.3" />
        {/* Lid inner rim */}
        <ellipse cx="18" cy="12" rx="10.5" ry="2.5" fill="none" className="stroke-[#F4EDE3] dark:stroke-[#5A5248]" strokeWidth="0.7" />
        {/* Dog face */}
        <g transform="translate(6, 17)">
          <circle cx="12" cy="13" r="9" className="fill-[#F4EDE3] dark:fill-[#D4C9B5]" />
          <path
            d="M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.702 11.702 0 0 0-.493-3.309"
            className="stroke-[#6B8C6F] dark:stroke-[#8FB896]"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8.5 8.5c-.384 1.05-1.083 2.028-2.344 2.5-1.931.722-3.576-.297-3.656-1-.113-.994 1.177-6.53 4-7 1.923-.321 3.651.845 3.651 2.235A7.497 7.497 0 0 1 14 5.277c0-1.39 1.844-2.598 3.767-2.277 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 1-1.261-.472-1.855-1.45-2.239-2.5"
            className="fill-[#F4EDE3] stroke-[#6B8C6F] dark:fill-[#D4C9B5] dark:stroke-[#8FB896]"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M8 14v.5" className="stroke-[#6B5D4F] dark:stroke-[#3D3631]" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M16 14v.5" className="stroke-[#6B5D4F] dark:stroke-[#3D3631]" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M11.25 16.25h1.5L12 17z" className="stroke-[#6B5D4F] dark:stroke-[#3D3631]" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    </div>
  )
}
