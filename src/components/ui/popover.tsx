import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

// Radix rather than hand-rolled: the content must portal out of an
// `overflow-auto` panel, close on Escape and outside-press, and — critically —
// its outside-press must NOT reach PreviewStage's frame handler, which would
// deselect the very clip being edited. Radix's dismissable layer handles that;
// hand-rolling outside-press is where the bugs live.

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor

function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-xl border border-edge bg-popover p-1 text-ink shadow-xl outline-none',
          // Its own scroll must not chain out to the mobile sheet behind it.
          'overscroll-contain',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent }
