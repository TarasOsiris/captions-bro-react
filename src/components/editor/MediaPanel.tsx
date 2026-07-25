// The media bin and its navigation rail.
//
// Exported in three pieces so the same UI serves both layouts without a JS
// breakpoint fork (which would remount things on resize):
//   MediaRail  — the 4 nav items; vertical on desktop, a tab bar on mobile
//   MediaBin   — the clip grid; a sidebar column on desktop, sheet body on mobile
//   MediaPanel — the desktop <aside> composing both, `hidden … lg:flex`
// MobileDock composes MediaRail + MediaBin for the < lg layout.

import { useState } from 'react'
import { Captions, Film, Music, Plus, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useEditorStore } from '@/store/editorStore'
import { allClips, assetOf, revealTime } from '@/lib/model/selectors'
import type { Clip } from '@/lib/model/types'
import { cn } from '@/lib/utils'
import { formatBytes, formatDuration } from '@/lib/media'
import { MEDIA_ASSET_MIME } from '@/lib/dnd'

interface MediaBinProps {
  onPickFile: () => void
  /** Move the playhead onto a tapped clip, so the preview shows what's selected. */
  onSeek: (t: number) => void
  /** Place another copy of this asset at the playhead (the touch insert path). */
  onAddToTimeline: (assetId: string) => void
  /** Fired after a tile is picked, so the mobile sheet can close itself. */
  onPicked?: () => void
}

function RailItem({
  icon,
  label,
  active = false,
  orientation = 'vertical',
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  orientation?: 'vertical' | 'horizontal'
  onClick?: () => void
}) {
  const enabled = active || onClick != null

  const button = (
    <Button
      variant="ghost"
      aria-disabled={!enabled}
      // The "coming soon" state used to live ONLY in a hover tooltip, which
      // never opens on touch — so these read as broken buttons on a phone. The
      // badge below puts it on the control itself (and into the a11y name).
      aria-label={enabled ? label : `${label} — coming soon`}
      onClick={
        enabled
          ? onClick
          : (e) => {
              e.preventDefault()
            }
      }
      className={cn(
        'h-auto w-12 flex-col gap-1 rounded-lg px-0 py-2 text-[10px] font-medium',
        orientation === 'horizontal' && 'w-full max-w-20 flex-1',
        active
          ? 'bg-raised text-ink hover:bg-raised hover:text-ink'
          : enabled
            ? 'text-muted'
            : 'cursor-default text-muted/50 hover:bg-transparent hover:text-muted/50',
      )}
    >
      {icon}
      {label}
      {!enabled && (
        <span className="text-[8px] uppercase tracking-wide opacity-70">
          Soon
        </span>
      )}
    </Button>
  )

  if (enabled) return button

  // Hover tooltip is now purely additive — the label above carries the meaning.
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={orientation === 'vertical' ? 'right' : 'top'}>
        {label} — coming soon
      </TooltipContent>
    </Tooltip>
  )
}

export function MediaRail({
  orientation = 'vertical',
  mediaActive = true,
  onToggleMedia,
}: {
  orientation?: 'vertical' | 'horizontal'
  /** Whether the Media panel is the one currently showing. */
  mediaActive?: boolean
  /** Mobile only — toggles the media sheet. Omitted on desktop (always open). */
  onToggleMedia?: () => void
}) {
  const items = [
    { icon: <Film className="h-5 w-5" />, label: 'Media' },
    { icon: <Type className="h-5 w-5" />, label: 'Text' },
    { icon: <Music className="h-5 w-5" />, label: 'Audio' },
    { icon: <Captions className="h-5 w-5" />, label: 'Captions' },
  ]

  return (
    <>
      {items.map(({ icon, label }, i) => (
        <RailItem
          key={label}
          icon={icon}
          label={label}
          orientation={orientation}
          active={i === 0 && mediaActive}
          onClick={i === 0 ? onToggleMedia : undefined}
        />
      ))}
    </>
  )
}

export function MediaBin({
  onPickFile,
  onSeek,
  onAddToTimeline,
  onPicked,
}: MediaBinProps) {
  const project = useEditorStore((s) => s.project)
  const selectedClipId = useEditorStore((s) => s.selectedClipId)
  const selectClip = useEditorStore((s) => s.selectClip)
  // Importing is the one thing an in-progress export blocks; read it here
  // rather than threading a `disabled` prop through every layout wrapper.
  const disabled = useEditorStore((s) => s.exportPhase === 'exporting')
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const clips = allClips(project)

  /** Select a clip and reveal it — same rule as Timeline's `selectClipAt`.
   *  Selecting without moving the playhead onto the clip leaves the preview
   *  showing something else, which reads as a no-op tap on mobile (where the
   *  sheet closes right after). */
  const pick = (clip: Clip) => {
    selectClip(clip.id)
    const reveal = revealTime(clip, useEditorStore.getState().currentTime)
    if (reveal != null) onSeek(reveal)
    onPicked?.()
  }

  return (
    <>
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          Media
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={onPickFile}
              disabled={disabled}
              aria-label="Import media"
              className="h-6 w-6"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Import media</TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pt-1">
        {clips.length > 0 ? (
          // auto-fill rather than a fixed column count: 3 columns in the 288px
          // desktop sidebar, 4 in a full-width mobile sheet, one class, no
          // breakpoint.
          <div className="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-2">
            {clips.map((clip) => {
              const asset = assetOf(project, clip)
              const thumb =
                asset && asset.thumbs.length > 0 ? asset.thumbs[0] : null
              const assetId = clip.assetId
              const canDrag = assetId != null
              return (
                // A wrapper, not a <button>: the "+" affordance below has to be
                // a real sibling button — nesting it inside the tile would be
                // invalid HTML and break click delivery.
                <div key={clip.id} className="group relative">
                  <button
                    type="button"
                    draggable={canDrag}
                    onDragStart={(e) => {
                      if (assetId == null) return
                      // Payload is the asset id — drop creates a new clip from it.
                      e.dataTransfer.setData(MEDIA_ASSET_MIME, assetId)
                      e.dataTransfer.setData('text/plain', asset?.name ?? '')
                      e.dataTransfer.effectAllowed = 'copy'
                      setDraggingId(clip.id)
                    }}
                    onDragEnd={() => {
                      setDraggingId(null)
                    }}
                    onClick={() => {
                      pick(clip)
                    }}
                    className={cn(
                      'block w-full select-none text-left [-webkit-touch-callout:none]',
                      canDrag && 'cursor-grab active:cursor-grabbing',
                      clip.id === selectedClipId ? 'opacity-100' : 'opacity-90',
                      draggingId === clip.id && 'opacity-40',
                    )}
                  >
                    <div
                      className={cn(
                        'relative aspect-video overflow-hidden rounded-md border bg-black',
                        clip.id === selectedClipId
                          ? 'border-select ring-1 ring-select/70'
                          : 'border-edge ring-1 ring-transparent',
                      )}
                    >
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          draggable={false}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted/60">
                          <Film className="h-6 w-6" />
                        </div>
                      )}
                      <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[10px] tabular-nums text-white/90">
                        {formatDuration(clip.duration)}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <p className="truncate text-xs text-ink">
                        {asset?.name ?? clip.type}
                      </p>
                      {asset && (
                        <p className="font-mono text-[10px] text-muted">
                          {formatBytes(asset.sizeBytes)}
                        </p>
                      )}
                    </div>
                  </button>

                  {/* Touch has no HTML5 drag-and-drop, so this is the ONLY way
                      to insert into the middle of a timeline on a phone.
                      Always visible on coarse pointers; hover-revealed on fine. */}
                  {canDrag && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddToTimeline(assetId)
                        onPicked?.()
                      }}
                      aria-label={`Add ${asset?.name ?? 'clip'} to the timeline at the playhead`}
                      className="absolute bottom-1 left-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition after:absolute after:-inset-2 after:content-[''] hover:bg-black/85 focus-visible:opacity-100 group-hover:opacity-100 disabled:pointer-events-none [@media(pointer:coarse)]:opacity-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <Button
            variant="outline"
            onClick={onPickFile}
            disabled={disabled}
            className="flex aspect-video h-auto w-full flex-col gap-2 rounded-md border-dashed text-[11px]"
          >
            <Plus className="h-4 w-4" />
            <span>Import media</span>
          </Button>
        )}
      </div>
    </>
  )
}

/** Desktop sidebar. Below `lg` the panels are dropped entirely and MobileDock
 *  takes over — see the layout notes in CLAUDE.md. */
export function MediaPanel(props: MediaBinProps) {
  return (
    <aside className="hidden shrink-0 border-r border-edge bg-surface lg:flex">
      <nav className="flex w-16 flex-col items-center gap-1 border-r border-edge/60 py-3">
        <MediaRail orientation="vertical" />
      </nav>

      <div className="flex w-72 flex-col">
        <MediaBin {...props} />
      </div>
    </aside>
  )
}
