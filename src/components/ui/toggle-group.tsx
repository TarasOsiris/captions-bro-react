import { cn } from '@/lib/utils'

// Two shapes, hand-rolled over the existing visual language:
//
//   ToggleButton     — independent on/off (bold, italic, underline, caps).
//                      `aria-pressed`, inside a `role="group"`.
//   SegmentedControl — mutually exclusive (alignment). `role="radiogroup"` with
//                      roving tabindex, so arrow keys move between options and
//                      Tab treats the whole control as one stop.
//
// Both grow their hit area with a transparent `::after` rather than a bigger
// visual, per CLAUDE.md — the drawn size is the design, the touched size is 44px.

const cell =
  "relative flex h-8 flex-1 items-center justify-center rounded-md text-sm font-medium transition after:absolute after:-inset-1 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"

function ToggleGroup({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex gap-1 rounded-lg bg-raised/60 p-1', className)}
    >
      {children}
    </div>
  )
}

function ToggleButton({
  pressed,
  onPressedChange,
  label,
  className,
  children,
}: {
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
  /** Always set: these are icon-only, and tooltips are hover-only on touch. */
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={() => {
        onPressedChange(!pressed)
      }}
      className={cn(
        cell,
        pressed
          ? 'bg-accent/20 text-accent'
          : 'text-muted hover:bg-raised hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}

interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: React.ReactNode
}

function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: SegmentOption<T>[]
  className?: string
}) {
  const move = (delta: number) => {
    const i = options.findIndex((o) => o.value === value)
    const next = options[(i + delta + options.length) % options.length]
    onChange(next.value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('flex gap-1 rounded-lg bg-raised/60 p-1', className)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          move(1)
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1)
        }
      }}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            // Roving tabindex: only the selected option is a tab stop.
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(option.value)
            }}
            className={cn(
              cell,
              selected
                ? 'bg-accent/20 text-accent'
                : 'text-muted hover:bg-raised hover:text-ink',
            )}
          >
            {option.icon ?? option.label}
          </button>
        )
      })}
    </div>
  )
}

export { ToggleGroup, ToggleButton, SegmentedControl }
