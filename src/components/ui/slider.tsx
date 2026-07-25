import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/lib/utils'

/**
 * A single-value slider.
 *
 * Radix rather than `<input type="range">` for two reasons that matter here:
 * `onValueCommit` (fired on release) is exactly the undo-session seam the
 * inspector needs — live `onValueChange` writes, one snapshot per drag — and a
 * native range thumb can only be sized through `::-webkit-slider-thumb`, which
 * rules out the transparent `::after` hit-area trick this codebase mandates.
 *
 * `touch-none` on the root: per the touch-action table in CLAUDE.md, a control
 * that owns its gesture outright claims it rather than sharing with a scroller.
 */
function Slider({
  className,
  value,
  onChange,
  onCommit,
  ...props
}: Omit<
  React.ComponentProps<typeof SliderPrimitive.Root>,
  // `onChange` too: the DOM handler in the spread would otherwise collide with
  // the value-shaped one below and widen it to accept a ChangeEvent.
  'value' | 'onValueChange' | 'onValueCommit' | 'onChange'
> & {
  value: number
  onChange: (value: number) => void
  /** Fired once when the drag ends — where the undo session closes. */
  onCommit?: (value: number) => void
}) {
  return (
    <SliderPrimitive.Root
      className={cn(
        'relative flex h-5 w-full touch-none select-none items-center',
        className,
      )}
      value={[value]}
      onValueChange={(v) => {
        onChange(v[0])
      }}
      onValueCommit={(v) => {
        onCommit?.(v[0])
      }}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-edge">
        <SliderPrimitive.Range className="absolute h-full bg-accent" />
      </SliderPrimitive.Track>
      {/* The visual thumb stays small; `after:-inset-3` lifts the hit area to
          ~40px without moving a pixel. */}
      <SliderPrimitive.Thumb
        className="relative block h-4 w-4 rounded-full border-2 border-accent bg-surface shadow transition-[box-shadow] after:absolute after:-inset-3 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:pointer-events-none"
        aria-label={props['aria-label']}
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }
