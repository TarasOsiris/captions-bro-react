import { useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * An auto-growing textarea.
 *
 * A real `<textarea>` rather than a contentEditable div, deliberately: both
 * `useEditorKeyboard` already skips its global shortcuts (undo included) when
 * the event target is a TEXTAREA, so Space, Delete and Cmd+Z stop fighting the
 * editor for free — and emoji, IME composition and the mobile keyboard all work
 * with no extra code.
 */
function TextArea({
  id,
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder,
  rows = 2,
  maxRows = 8,
  className,
  'aria-label': ariaLabel,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  placeholder?: string
  rows?: number
  maxRows?: number
  className?: string
  'aria-label'?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Grow to fit, capped. Layout effect so it never paints at the wrong height.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 18
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * maxRows + 16)}px`
  }, [value, maxRows])

  return (
    <textarea
      id={id}
      ref={ref}
      rows={rows}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => {
        onChange(e.target.value)
      }}
      onFocus={onFocus}
      onBlur={onBlur}
      className={cn(
        'w-full resize-none rounded-lg border border-edge bg-surface px-2 py-1.5 text-xs leading-relaxed text-ink outline-none placeholder:text-muted/60 focus:border-accent',
        className,
      )}
    />
  )
}

export { TextArea }
