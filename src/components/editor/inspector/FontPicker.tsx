// Searchable font picker. A hand-rolled listbox over the shared Popover rather
// than a Radix Select, because every row renders its own family — a self-
// previewing list is the whole point, and Select fights per-row typography.

import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { FONT_CATEGORY_LABEL, TEXT_FONTS, hasBold } from '@/lib/text/fonts'
import { ensureFont } from '@/lib/text/fontLoader'
import { cn } from '@/lib/utils'
import type { FontCategory } from '@/lib/text/fonts'

export function FontPicker({
  id,
  value,
  onChange,
}: {
  id?: string
  value: string
  onChange: (family: string) => void
}) {
  const [open, setOpen] = useState(false)
  // Local, ephemeral, never in the store.
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = q
      ? TEXT_FONTS.filter((f) => f.family.toLowerCase().includes(q))
      : TEXT_FONTS
    const out = new Map<FontCategory, typeof TEXT_FONTS>()
    for (const font of matches) {
      const list = out.get(font.category) ?? []
      list.push(font)
      out.set(font.category, list)
    }
    return [...out.entries()]
  }, [query])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          // The family name is rendered IN that family — the control carries the
          // information, which is what makes it readable without a tooltip.
          className="flex h-8 w-full items-center justify-between gap-1 rounded-lg border border-edge bg-surface px-2 text-left text-xs text-ink transition hover:border-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <span
            className="truncate"
            style={{ fontFamily: `"${value}", system-ui, sans-serif` }}
          >
            {value}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[15rem] p-0">
        <div className="flex items-center gap-1.5 border-b border-edge px-2 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
            }}
            placeholder="Search fonts"
            aria-label="Search fonts"
            className="w-full bg-transparent text-xs text-ink outline-none placeholder:text-muted/60"
          />
        </div>

        <ul
          role="listbox"
          aria-label="Font family"
          className="max-h-64 overflow-y-auto overscroll-contain p-1"
        >
          {groups.length === 0 && (
            <li className="px-2 py-3 text-center text-[11px] text-muted">
              No fonts match “{query}”.
            </li>
          )}
          {groups.map(([category, fonts]) => (
            <li key={category}>
              <div className="px-2 pb-0.5 pt-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted/70">
                {FONT_CATEGORY_LABEL[category]}
              </div>
              <ul>
                {fonts.map((font) => {
                  const selected = font.family === value
                  return (
                    <li key={font.family}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          void ensureFont(font.family, {
                            bold: hasBold(font.family),
                          })
                          onChange(font.family)
                          setOpen(false)
                          setQuery('')
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition',
                          selected
                            ? 'bg-accent/15 text-accent'
                            : 'text-ink hover:bg-raised',
                        )}
                        style={{
                          fontFamily: `"${font.family}", system-ui, sans-serif`,
                        }}
                      >
                        <span className="truncate">{font.family}</span>
                        {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
