import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[18px] border-0 bg-clip-padding text-[16px] font-semibold tracking-[-0.01em] whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        /* Figma Button kinds: Primary (blue = money), Dark, Secondary, Soft, Danger; plus the step CTA colours */
        default: "bg-blue text-white hover:bg-[#0538b0]",
        dark: "bg-dark text-white hover:bg-black",
        secondary: "bg-white text-ink ring-[1.5px] ring-line ring-inset hover:bg-surface",
        outline: "bg-white text-ink ring-[1.5px] ring-line ring-inset hover:bg-surface",
        soft: "bg-surface text-ink hover:bg-[#eceef4]",
        destructive: "bg-red-bg text-red hover:bg-[#ffe3ea]",
        green: "bg-green text-white hover:bg-[#075a2e]",
        gold: "bg-amber text-white hover:bg-[#8a5b06]",
        red: "bg-red text-white hover:bg-[#7a0221]",
        ghost: "text-ink hover:bg-surface",
        link: "text-blue underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[52px] gap-2 px-5",
        lg: "h-[52px] gap-2 px-5",
        sm: "h-10 gap-1.5 rounded-[14px] px-3.5 text-[14px] [&_svg:not([class*='size-'])]:size-4",
        xs: "h-8 gap-1 rounded-[12px] px-2.5 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-11 rounded-full",
        "icon-xs": "size-6 rounded-full [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-full",
        "icon-lg": "size-12 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
