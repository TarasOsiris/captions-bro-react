import { useId } from 'react'
import { cn } from '@/lib/utils'

// Inspector layout atoms. ONE two-column grid that reads correctly in both the
// 256px desktop column and a full-width mobile sheet — deliberately no `sm:`
// variants, which CLAUDE.md reserves for text density, never structure.

/** A labelled row. `children` receives the generated id to bind the control. */
function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string
  /** Live value readout, right-aligned next to the label (e.g. "48 px"). */
  hint?: string
  className?: string
  children: (id: string) => React.ReactNode
}) {
  const id = useId()
  return (
    <div
      className={cn(
        'grid grid-cols-[4.5rem_1fr] items-center gap-2',
        className,
      )}
    >
      <label
        htmlFor={id}
        className="flex min-w-0 items-baseline gap-1 text-[11px] text-muted"
      >
        <span className="truncate">{label}</span>
        {hint && (
          <span className="ml-auto shrink-0 font-mono tabular-nums text-[10px] text-muted/70">
            {hint}
          </span>
        )}
      </label>
      {children(id)}
    </div>
  )
}

/** A full-width row for controls that need the whole panel (textarea, presets). */
function FieldBlock({
  label,
  className,
  children,
}: {
  label?: string
  className?: string
  children: (id: string) => React.ReactNode
}) {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-[11px] text-muted">
          {label}
        </label>
      )}
      {children(id)}
    </div>
  )
}

/**
 * A collapsible inspector section. Native `<details>`: keyboard and a11y come
 * free, and the open/closed state lives in the DOM rather than the store — so
 * expanding a section causes zero re-renders anywhere else.
 *
 * `name` makes it an exclusive accordion where supported (Safari 17.2+ /
 * Chrome 120+); older browsers simply allow several open at once, which is a
 * benign degradation. Pass a DISTINCT name per layout instance, or the desktop
 * column and the mobile sheet would fight over one group.
 */
function Section({
  title,
  name,
  defaultOpen = false,
  children,
}: {
  title: string
  name?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details
      name={name}
      open={defaultOpen}
      className="group border-b border-edge/60 last:border-b-0"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted marker:content-none hover:text-ink [&::-webkit-details-marker]:hidden">
        {title}
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="flex flex-col gap-2.5 pb-3.5">{children}</div>
    </details>
  )
}

export { Field, FieldBlock, Section }
