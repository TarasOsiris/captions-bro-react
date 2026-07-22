import { useEffect, useRef, useState } from 'react'
import {
  Copy,
  Pause,
  Play,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useEditorStore } from '@/store/editorStore'
import { assetOf, clipById, projectDuration } from '@/lib/model/selectors'
import { formatTimecode } from '@/lib/media'
import { clamp } from '@/lib/utils'
import { TIMELINE_PX_PER_SEC, TIMELINE_TILE_W } from '@/lib/thumbs'
import type { Clip, Track } from '@/lib/model/types'

interface TimelineProps {
  onTogglePlay: () => void
  onSeek: (t: number) => void
  /** Snapshot for undo before a structural edit (split/duplicate/delete). */
  onEditStart: () => void
}

/** Horizontal inset (px) so overhanging clip chrome stays on-screen at scroll ends. */
const TRACK_PAD = 24
const MIN_LABEL_PX = 56
const RULER_FALLBACK_SEC = 30

/** Major-tick spacing (s) — smallest that keeps labels ≥MIN_LABEL_PX apart. */
function tickStep(): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  for (const s of steps) {
    if (s * TIMELINE_PX_PER_SEC >= MIN_LABEL_PX) return s
  }
  return 1800
}

function ClipBox({
  clip,
  track,
  selected,
  onSelect,
}: {
  clip: Clip
  track: Track
  selected: boolean
  onSelect: (e: React.PointerEvent) => void
}) {
  const asset = useEditorStore((s) => assetOf(s.project, clip))
  const width = clip.duration * TIMELINE_PX_PER_SEC
  const left = TRACK_PAD + clip.start * TIMELINE_PX_PER_SEC
  const thumbs = asset?.thumbs ?? []
  const tileCount = Math.max(1, Math.ceil(width / TIMELINE_TILE_W))
  const label = asset?.name ?? (clip.type === 'text' ? clip.text : clip.type)

  return (
    <div
      onPointerDown={(e) => {
        // Don't let a clip press reach the scrub handler (which seeks + deselects).
        e.stopPropagation()
        onSelect(e)
      }}
      style={{ left: `${left.toFixed(2)}px`, width: `${width.toFixed(2)}px` }}
      className="absolute inset-y-0 cursor-pointer"
    >
      <div
        className={`absolute inset-0 overflow-hidden bg-black ${selected ? 'rounded-none ring-0' : 'rounded-[9px]'}`}
      >
        {track.type === 'video' && thumbs.length > 0 ? (
          <div className="absolute inset-0">
            {Array.from({ length: tileCount }, (_, i) => {
              const src =
                thumbs[
                  Math.min(
                    thumbs.length - 1,
                    Math.floor(((i + 0.5) / tileCount) * thumbs.length),
                  )
                ]
              return (
                <div
                  key={i}
                  style={{
                    backgroundImage: `url("${src}")`,
                    left: `${(i * TIMELINE_TILE_W).toString()}px`,
                    width: `${(TIMELINE_TILE_W + 1).toString()}px`,
                  }}
                  className="absolute inset-y-0 bg-cover bg-center"
                />
              )
            })}
          </div>
        ) : (
          <div className="h-full w-full bg-linear-to-r from-raised via-edge/50 to-raised" />
        )}
        <span className="absolute bottom-1 left-1.5 max-w-[80%] truncate rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/90">
          {label}
        </span>
      </div>

      {selected && (
        <div className="pointer-events-none absolute -inset-y-[3px] inset-x-0 z-20">
          <div className="absolute inset-0 rounded-[4px] border-[3px] border-select" />
        </div>
      )}
    </div>
  )
}

export function Timeline({ onTogglePlay, onSeek, onEditStart }: TimelineProps) {
  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const playing = useEditorStore((s) => s.playing)
  const selectedClipId = useEditorStore((s) => s.selectedClipId)
  const selectClip = useEditorStore((s) => s.selectClip)
  const splitClip = useEditorStore((s) => s.splitClip)
  const duplicateClip = useEditorStore((s) => s.duplicateClip)
  const removeClip = useEditorStore((s) => s.removeClip)

  const scrubRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [viewportWidth, setViewportWidth] = useState(0)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      setViewportWidth(entries[0].contentRect.width)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [])

  const total = projectDuration(project)
  const hasClips = total > 0
  const rulerDuration = Math.max(total, RULER_FALLBACK_SEC)
  const contentWidth = rulerDuration * TIMELINE_PX_PER_SEC
  const rulerWidth = Math.max(contentWidth, viewportWidth - TRACK_PAD * 2)
  const trackWidth = TRACK_PAD * 2 + rulerWidth
  const playheadX = TRACK_PAD + clamp(currentTime, 0, rulerDuration) * TIMELINE_PX_PER_SEC

  const selectedClip = clipById(project, selectedClipId)
  const canSplit =
    selectedClip != null &&
    currentTime > selectedClip.start &&
    currentTime < selectedClip.start + selectedClip.duration

  const seekFromClientX = (clientX: number) => {
    const el = scrubRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const t = (clientX - rect.left - TRACK_PAD) / TIMELINE_PX_PER_SEC
    onSeek(clamp(t, 0, total))
  }

  const selectClipAt = (clip: Clip) => {
    selectClip(clip.id)
    // Bring the playhead onto the clip so the preview shows it.
    if (currentTime < clip.start || currentTime > clip.start + clip.duration) {
      onSeek(clip.start)
    }
  }

  const doSplit = () => {
    if (!selectedClip || !canSplit) return
    onEditStart()
    splitClip(selectedClip.id, currentTime)
    selectClip(null)
  }
  const doDuplicate = () => {
    if (!selectedClip) return
    onEditStart()
    const id = duplicateClip(selectedClip.id)
    if (id) selectClip(id)
  }
  const doDelete = () => {
    if (!selectedClip) return
    onEditStart()
    removeClip(selectedClip.id)
    selectClip(null)
  }

  const step = tickStep()
  const minorStep = step / 5
  const tickCount = Math.floor(rulerWidth / TIMELINE_PX_PER_SEC / minorStep)
  const ticks: Array<{ t: number; major: boolean }> = []
  for (let i = 0; i <= tickCount; i++) {
    ticks.push({ t: i * minorStep, major: i % 5 === 0 })
  }

  const tools = [
    { Icon: Scissors, label: 'Split', onClick: doSplit, enabled: canSplit },
    {
      Icon: Copy,
      label: 'Duplicate',
      onClick: doDuplicate,
      enabled: selectedClip != null,
    },
    {
      Icon: Trash2,
      label: 'Delete',
      onClick: doDelete,
      enabled: selectedClip != null,
    },
  ]

  return (
    <footer className="flex h-72 shrink-0 flex-col border-t border-edge bg-surface/70">
      <div className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-edge/70 px-3">
        <div className="flex items-center gap-1">
          {tools.map(({ Icon, label, onClick, enabled }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClick}
                  disabled={!enabled}
                  aria-label={label}
                  className="h-7 w-7"
                >
                  <Icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  onSeek(0)
                }}
                disabled={!hasClips}
                aria-label="Jump to start"
                className="h-7 w-7"
              >
                <SkipBack className="h-4 w-4" fill="currentColor" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Jump to start</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={onTogglePlay}
                disabled={!hasClips}
                aria-label={playing ? 'Pause' : 'Play'}
                className="h-8 w-8 rounded-full bg-ink p-0 text-bg hover:bg-white"
              >
                {playing ? (
                  <Pause className="h-4 w-4" fill="currentColor" />
                ) : (
                  <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {playing ? 'Pause (Space)' : 'Play (Space)'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  onSeek(total)
                }}
                disabled={!hasClips}
                aria-label="Jump to end"
                className="h-7 w-7"
              >
                <SkipForward className="h-4 w-4" fill="currentColor" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Jump to end</TooltipContent>
          </Tooltip>
          <div className="ml-3 font-mono text-xs tabular-nums">
            <span className="text-ink">{formatTimecode(currentTime)}</span>
            <span className="text-muted"> / {formatTimecode(total)}</span>
          </div>
        </div>

        <div className="flex justify-end">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted/50">
            On-device · WebCodecs
          </span>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden pb-2 pt-1.5"
      >
        <div
          ref={scrubRef}
          onPointerDown={(e) => {
            // Reached only off-clip (clips stop propagation): deselect + scrub.
            selectClip(null)
            draggingRef.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            seekFromClientX(e.clientX)
          }}
          onPointerMove={(e) => {
            if (draggingRef.current) seekFromClientX(e.clientX)
          }}
          onPointerUp={(e) => {
            draggingRef.current = false
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId)
            }
          }}
          onPointerCancel={() => {
            draggingRef.current = false
          }}
          style={{ width: `${trackWidth.toString()}px` }}
          className="relative h-full cursor-pointer select-none"
        >
          <div className="relative h-6">
            {ticks.map(({ t, major }) => {
              const left = `${(TRACK_PAD + t * TIMELINE_PX_PER_SEC).toFixed(2)}px`
              return major ? (
                <div key={t}>
                  <span
                    className="absolute top-0 -translate-x-1/2 font-mono text-[10px] tabular-nums text-muted/70"
                    style={{ left }}
                  >
                    {formatTimecode(t).replace(/\.\d$/, '')}
                  </span>
                  <span
                    className="absolute bottom-0 h-1.5 w-px bg-muted/40"
                    style={{ left }}
                  />
                </div>
              ) : (
                <span
                  key={t}
                  className="absolute bottom-0 h-1 w-px bg-muted/20"
                  style={{ left }}
                />
              )
            })}
          </div>

          {hasClips ? (
            project.tracks.map((track) => (
              <div key={track.id} className="relative mt-2 h-14">
                {track.clips.map((clip) => (
                  <ClipBox
                    key={clip.id}
                    clip={clip}
                    track={track}
                    selected={clip.id === selectedClipId}
                    onSelect={() => {
                      selectClipAt(clip)
                    }}
                  />
                ))}
              </div>
            ))
          ) : (
            <div className="mt-2 flex h-14 items-center px-6">
              <div className="flex h-full w-full items-center justify-center rounded-[11px] border border-dashed border-edge/80 text-xs text-muted">
                Import a clip to start
              </div>
            </div>
          )}

          <div
            className="pointer-events-none absolute inset-y-0 z-10"
            style={{ left: `${playheadX.toFixed(2)}px` }}
          >
            <div className="absolute inset-y-0 left-1/2 top-1 w-[3px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_4px_rgba(0,0,0,0.6)]" />
            <div className="absolute left-1/2 top-0 h-3.5 w-[9px] -translate-x-1/2 rounded-[2px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.6)]" />
          </div>
        </div>
      </div>
    </footer>
  )
}
