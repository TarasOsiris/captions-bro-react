// The < lg replacement for the desktop side panels: a bottom tab rail with a
// sheet above it. Renders nothing at lg+ (every part is `lg:hidden`).
//
// The sheet must stay `fixed` and the rail `shrink-0` — see the PreviewStage
// container-query contract in CLAUDE.md for why.
//
// Which sheet is showing comes from the store's `panel`, read RAW here (null =
// closed) while the desktop panel reads `panel ?? 'media'`. That single
// difference in interpretation is what lets the two layouts behave differently
// with no JS breakpoint fork.

import { useEffect } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { MediaBin, MediaRail } from '@/components/editor/MediaPanel'
import { TextPresetBin } from '@/components/editor/TextPanel'
import { InspectorBody } from '@/components/editor/inspector/InspectorBody'
import { MOBILE_PANEL_ID } from '@/components/editor/panelIds'
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
  const panel = useEditorStore((s) => s.panel)
  const setPanel = useEditorStore((s) => s.setPanel)
  const togglePanel = useEditorStore((s) => s.togglePanel)
  const open = panel != null

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open, setPanel])

  return (
    <>
      {/* Dismiss layer. Deliberately NOT modal — you need to see the timeline
          and preview while choosing what to insert. Skipped entirely for the
          inspector: you must be able to watch the preview while styling, and a
          tap here would reach PreviewStage's frame handler and deselect the very
          clip being edited. */}
      {open && panel !== 'inspector' && (
        <div
          onPointerDown={() => {
            setPanel(null)
          }}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}

      <div
        id={MOBILE_PANEL_ID}
        role="tabpanel"
        aria-hidden={!open}
        className={cn(
          'fixed inset-x-0 z-40 flex flex-col rounded-t-2xl border-t border-edge bg-surface shadow-2xl lg:hidden',
          'bottom-[calc(var(--rail-h)+env(safe-area-inset-bottom))]',
          'transition-transform duration-200 ease-out motion-reduce:transition-none',
          // The inspector is a long form, so it gets more room. This is a
          // DATA-driven class (which panel is open), not a viewport-driven one,
          // so the CSS-only-breakpoints rule still holds.
          panel === 'inspector'
            ? 'max-h-[min(58dvh,32rem)]'
            : 'max-h-[min(60dvh,26rem)]',
          // Parked below the opaque rail when closed, and inert so its buttons
          // can't be tabbed to or tapped through.
          open ? 'translate-y-0' : 'pointer-events-none translate-y-full',
        )}
      >
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-edge" />
        {panel === 'text' ? (
          <TextPresetBin
            // Insert, then go straight to styling it — the phone equivalent of
            // the desktop's always-visible inspector column.
            onPicked={() => {
              setPanel('inspector')
            }}
          />
        ) : panel === 'inspector' ? (
          <InspectorBody variant="sheet" />
        ) : (
          <MediaBin
            onPickFile={onPickFile}
            onSeek={onSeek}
            onAddToTimeline={onAddToTimeline}
            onPicked={() => {
              setPanel(null)
            }}
          />
        )}
      </div>

      <nav
        role="tablist"
        aria-orientation="horizontal"
        aria-label="Editor panels"
        className={cn(
          'z-50 flex shrink-0 items-stretch justify-around gap-1 border-t border-edge bg-surface px-2 lg:hidden',
          'h-[calc(var(--rail-h)+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)]',
          'pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]',
        )}
      >
        <MediaRail
          orientation="horizontal"
          activeTab={panel}
          panelId={MOBILE_PANEL_ID}
          onSelect={togglePanel}
        />
      </nav>
    </>
  )
}
