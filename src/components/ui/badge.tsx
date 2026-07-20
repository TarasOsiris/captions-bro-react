import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border font-medium',
  {
    variants: {
      variant: {
        default: 'border-edge bg-raised text-muted',
        accent: 'border-transparent bg-accent/15 text-accent',
        warning: 'border-[#f5b344]/30 bg-[#f5b344]/10 text-[#f5c56b]',
      },
      size: {
        default: 'px-2.5 py-1 text-[11px]',
        sm: 'px-1.5 py-0.5 text-[10px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
