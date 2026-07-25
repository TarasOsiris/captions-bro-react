import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center rounded-lg font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default: 'bg-primary text-white hover:brightness-110',
        secondary: 'bg-raised text-ink hover:brightness-110',
        ghost: 'text-muted hover:bg-raised hover:text-ink',
        outline:
          'border border-edge text-muted hover:border-muted hover:text-ink',
        destructive: 'bg-destructive text-white hover:brightness-110',
      },
      size: {
        default: 'h-8 gap-2 px-4 text-sm',
        sm: 'h-7 gap-1.5 px-3 text-xs',
        // Icon buttons are visually small (call sites routinely override down to
        // h-7/h-6), which puts them well under the 44px touch minimum. A
        // transparent ::after grows the HIT area by 8px on every side without
        // moving a single pixel — 40–48px depending on the override, and no
        // per-call-site churn. `relative` is required: the base string sets no
        // position, so the pseudo-element would otherwise anchor to an ancestor.
        // `disabled:pointer-events-none` in the base keeps disabled areas inert.
        icon: "relative h-8 w-8 rounded-md after:absolute after:-inset-2 after:content-['']",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

interface ButtonProps
  extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
