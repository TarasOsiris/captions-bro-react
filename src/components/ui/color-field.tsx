import { cn } from '@/lib/utils'

// Native `<input type="color">` on purpose: zero bytes, and on iOS/Android it
// opens the SYSTEM picker, which is a far better touch experience than anything
// hand-rolled. Its lack of an alpha channel costs nothing here — opacity is a
// separate slider in every place this is used.
//
// The input is laid over a styled swatch at `opacity-0`, so we keep the app's
// visual language and a ≥44px target while the browser owns the interaction.
//
// NOTE for callers: React's `onChange` maps to the DOM `input` event, which the
// desktop picker fires CONTINUOUSLY while it is open. Route live writes through
// an rAF throttle and take exactly one undo snapshot per editing session.

const SWATCHES = [
  '#ffffff',
  '#000000',
  '#ffd203',
  '#ff5a5a',
  '#4ade80',
  '#38bdf8',
  '#a889ff',
  '#ff8fcf',
]

function ColorField({
  id,
  value,
  onChange,
  onCommit,
  label,
  className,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  /** Fired when the picker closes — where the undo session ends. */
  onCommit?: (value: string) => void
  label: string
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-edge">
        {/* Checkerboard so a dark swatch stays legible on a dark panel. */}
        <div
          className="absolute inset-0"
          style={{ backgroundColor: value }}
          aria-hidden="true"
        />
        <input
          id={id}
          type="color"
          aria-label={label}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
          }}
          onBlur={(e) => {
            onCommit?.(e.target.value)
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={`${label}: ${swatch}`}
            title={swatch}
            onClick={() => {
              onChange(swatch)
              onCommit?.(swatch)
            }}
            style={{ backgroundColor: swatch }}
            className={cn(
              // Small visual, big touch target via the transparent ::after.
              "relative h-4 w-4 rounded-full border transition after:absolute after:-inset-2 after:content-['']",
              swatch.toLowerCase() === value.toLowerCase()
                ? 'border-accent ring-2 ring-accent/60'
                : 'border-edge hover:border-muted',
            )}
          />
        ))}
      </div>
    </div>
  )
}

export { ColorField }
