import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * A numeric text field that commits on blur or Enter and reverts on Escape.
 *
 * `type="text"` with `inputMode="decimal"` rather than `type="number"`: Safari's
 * spinners can't be styled, iOS shows the wrong keyboard affordances, and
 * `type=number` happily accepts `1e5`. We parse ourselves instead.
 *
 * Because it commits once per edit rather than per keystroke, the caller takes
 * exactly one undo snapshot per value change — no session bookkeeping needed.
 */
function NumberField({
  id,
  value,
  onCommit,
  min = -Infinity,
  max = Infinity,
  step = 1,
  suffix,
  decimals = 2,
  className,
  'aria-label': ariaLabel,
}: {
  id?: string
  value: number
  onCommit: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  decimals?: number
  className?: string
  'aria-label'?: string
}) {
  const format = (n: number) => String(Number(n.toFixed(decimals)))
  const [draft, setDraft] = useState(() => format(value))
  const [editing, setEditing] = useState(false)

  // Track external changes (a canvas drag, undo) — but never while the user is
  // mid-edit, or their keystrokes would be overwritten.
  useEffect(() => {
    if (!editing) setDraft(format(value))
    // `format` is derived from `decimals`, which is in the dep list.
  }, [value, editing, decimals])

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw.replace(',', '.'))
    if (!Number.isFinite(parsed)) {
      setDraft(format(value))
      return
    }
    const clamped = Math.min(max, Math.max(min, parsed))
    setDraft(format(clamped))
    if (clamped !== value) onCommit(clamped)
  }

  return (
    <div
      className={cn(
        'flex h-8 items-center rounded-lg border border-edge bg-surface px-2 focus-within:border-accent',
        className,
      )}
    >
      <input
        id={id}
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
        }}
        onFocus={() => {
          setEditing(true)
        }}
        onBlur={(e) => {
          setEditing(false)
          commit(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(draft)
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraft(format(value))
            e.currentTarget.blur()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const delta = e.key === 'ArrowUp' ? step : -step
            commit(String(value + delta))
          }
        }}
        className="w-full min-w-0 bg-transparent font-mono text-xs tabular-nums text-ink outline-none"
      />
      {suffix && (
        <span className="ml-1 shrink-0 text-[10px] text-muted">{suffix}</span>
      )}
    </div>
  )
}

export { NumberField }
