// The < lg replacement for the desktop side panels: a bottom tab rail with a
// media sheet above it. Renders nothing at lg+ (every part is `lg:hidden`).
//
// The sheet must stay `fixed` and the rail `shrink-0` — see the PreviewStage
// container-query contract in CLAUDE.md for why.

import { useEffect, useState } from 'react'
import { MediaBin, MediaRail } from '@/components/editor/MediaPanel'
import { cn } from '@/lib/utils'

interface MobileDockProps {
  onPickFile: () => void
  onSeek: (t: number) => void
  onAddToTimeline: (assetId: string) => void
}

export function MobileDock({
  onPickFile,
  onSeek,
  onAddToTimeline,
}: MobileDockProps) {
  // Ephemeral UI state, so local rather than in the store (which is scoped to
  // the document). Generalizes to `panel: 'media' | 'inspector' | null` when the
  // inspector grows real controls.
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      {/* Dismiss layer. Deliberately NOT modal — you need to see the timeline
          and preview while choosing what to insert. */}
      {open && (
        <div
          onPointerDown={() => {
            setOpen(false)
          }}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}

      <div
        aria-hidden={!open}
        className={cn(
          'fixed inset-x-0 z-40 flex flex-col rounded-t-2xl border-t border-edge bg-surface shadow-2xl lg:hidden',
          'bottom-[calc(var(--rail-h)+env(safe-area-inset-bottom))]',
          'max-h-[min(60dvh,26rem)] transition-transform duration-200 ease-out motion-reduce:transition-none',
          // Parked below the opaque rail when closed, and inert so its buttons
          // can't be tabbed to or tapped through.
          open ? 'translate-y-0' : 'pointer-events-none translate-y-full',
        )}
      >
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-edge" />
        <MediaBin
          onPickFile={onPickFile}
          onSeek={onSeek}
          onAddToTimeline={onAddToTimeline}
          onPicked={() => {
            setOpen(false)
          }}
        />
      </div>

      <nav
        className={cn(
          'z-50 flex shrink-0 items-stretch justify-around gap-1 border-t border-edge bg-surface px-2 lg:hidden',
          'h-[calc(var(--rail-h)+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)]',
          'pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]',
        )}
      >
        <MediaRail
          orientation="horizontal"
          mediaActive={open}
          onToggleMedia={() => {
            setOpen((o) => !o)
          }}
        />
      </nav>
    </>
  )
}
