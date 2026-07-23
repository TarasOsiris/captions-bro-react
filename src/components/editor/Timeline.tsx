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
import {
  assetOf,
  clipById,
  insertionIndex,
  projectDuration,
  resolveTrim,
} from '@/lib/model/selectors'
import { clipFromAsset } from '@/lib/model/factories'
import { formatTimecode } from '@/lib/media'
import { clamp } from '@/lib/utils'
import { MEDIA_ASSET_MIME } from '@/lib/dnd'
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
/** Pointer travel (px) before a clip press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 4
/** Shortest a clip can be trimmed to (s), so a trimmed clip stays grabbable. */
const MIN_CLIP_DURATION = 0.1

/** X (px) of the boundary before `index` on a packed track — where an inserted/
 *  moved clip's left edge will land. Mirrors the clip-left math in ClipBox. */
function boundaryX(clips: Clip[], index: number): number {
  let t = 0
  for (let i = 0; i < index && i < clips.length; i++) t += clips[i].duration
  return TRACK_PAD + t * TIMELINE_PX_PER_SEC
}

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
  dragging,
  dragOffsetX,
  onPointerDownClip,
  onPointerMoveClip,
  onPointerUpClip,
  onTrimDown,
  onTrimMove,
  onTrimUp,
}: {
  clip: Clip
  track: Track
  selected: boolean
  /** True while this clip is the one being repositioned (lifts + offsets it). */
  dragging: boolean
  dragOffsetX: number
  onPointerDownClip: (clip: Clip, track: Track, e: React.PointerEvent) => void
  onPointerMoveClip: (clip: Clip, track: Track, e: React.PointerEvent) => void
  onPointerUpClip: (clip: Clip, track: Track, e: React.PointerEvent) => void
  onTrimDown: (
    clip: Clip,
    edge: 'left' | 'right',
    e: React.PointerEvent,
  ) => void
  onTrimMove: (clip: Clip, e: React.PointerEvent) => void
  onTrimUp: (clip: Clip, e: React.PointerEvent) => void
}) {
  const asset = useEditorStore((s) => assetOf(s.project, clip))
  const width = clip.duration * TIMELINE_PX_PER_SEC
  const left = TRACK_PAD + clip.start * TIMELINE_PX_PER_SEC
  const thumbs = asset?.thumbs ?? []
  // Filmstrip frames are sampled across the whole asset; map each tile to the
  // clip's trimmed source window [trimIn, trimIn+duration] so trims scrub visibly.
  const assetDur = asset?.durationSec ?? 0
  const tileCount = Math.max(1, Math.ceil(width / TIMELINE_TILE_W))
  const label = asset?.name ?? (clip.type === 'text' ? clip.text : clip.type)

  return (
    <div
      onPointerDown={(e) => {
        onPointerDownClip(clip, track, e)
      }}
      onPointerMove={(e) => {
        onPointerMoveClip(clip, track, e)
      }}
      onPointerUp={(e) => {
        onPointerUpClip(clip, track, e)
      }}
      onPointerCancel={(e) => {
        onPointerUpClip(clip, track, e)
      }}
      style={{
        left: `${left.toFixed(2)}px`,
        width: `${width.toFixed(2)}px`,
        transform: dragging
          ? `translateX(${dragOffsetX.toFixed(2)}px)`
          : undefined,
      }}
      className={`absolute inset-y-0 ${dragging ? 'z-30 cursor-grabbing' : 'cursor-grab'}`}
    >
      <div
        className={`absolute inset-0 overflow-hidden bg-black ${selected ? 'rounded-none ring-0' : 'rounded-[9px]'} ${dragging ? 'shadow-[0_8px_24px_rgba(0,0,0,0.55)]' : ''}`}
      >
        {track.type === 'video' && thumbs.length > 0 ? (
          <div className="absolute inset-0">
            {Array.from({ length: tileCount }, (_, i) => {
              const f = (i + 0.5) / tileCount
              const assetFrac =
                assetDur > 0 ? (clip.trimIn + f * clip.duration) / assetDur : f
              const src =
                thumbs[
                  Math.min(
                    thumbs.length - 1,
                    Math.max(0, Math.floor(assetFrac * thumbs.length)),
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
        <>
          <div className="pointer-events-none absolute -inset-y-[3px] inset-x-0 z-20">
            <div className="absolute inset-0 rounded-[4px] border-[3px] border-select" />
          </div>
          {(['left', 'right'] as const).map((edge) => (
            <span
              key={edge}
              onPointerDown={(e) => {
                onTrimDown(clip, edge, e)
              }}
              onPointerMove={(e) => {
                onTrimMove(clip, e)
              }}
              onPointerUp={(e) => {
                onTrimUp(clip, e)
              }}
              onPointerCancel={(e) => {
                onTrimUp(clip, e)
              }}
              className={`absolute inset-y-0 z-30 flex w-3 cursor-ew-resize touch-none items-center justify-center bg-select ${
                edge === 'left'
                  ? 'left-0 rounded-l-[9px]'
                  : 'right-0 rounded-r-[9px]'
              }`}
            >
              <span className="h-4 w-0.5 rounded-full bg-black/45" />
            </span>
          ))}
        </>
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
  const addClipAtIndex = useEditorStore((s) => s.addClipAtIndex)
  const moveClipToIndex = useEditorStore((s) => s.moveClipToIndex)
  const trimClip = useEditorStore((s) => s.trimClip)
  const resetExport = useEditorStore((s) => s.resetExport)

  const scrubRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [viewportWidth, setViewportWidth] = useState(0)

  // Reposition-gesture bookkeeping (imperative) + render state for the lifted clip.
  const clipDragRef = useRef<{
    pointerId: number
    clipId: string
    startClientX: number
    moved: boolean
  } | null>(null)
  const [clipDrag, setClipDrag] = useState<{
    clipId: string
    offsetX: number
  } | null>(null)
  // Edge-trim gesture bookkeeping (imperative); geometry updates live via trimClip.
  const trimDragRef = useRef<{
    pointerId: number
    clipId: string
    edge: 'left' | 'right'
    startClientX: number
    origStart: number
    origTrimIn: number
    origDuration: number
    snapshotted: boolean
  } | null>(null)
  // X (px) of the magnetic insertion caret, shared by panel-drop and reposition.
  const [dropIndicatorX, setDropIndicatorX] = useState<number | null>(null)

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
  const playheadX =
    TRACK_PAD + clamp(currentTime, 0, rulerDuration) * TIMELINE_PX_PER_SEC

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

  /** clientX → timeline seconds (clamped ≥0), accounting for scroll + inset. */
  const clientXToTime = (clientX: number) => {
    const el = scrubRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.max(0, (clientX - rect.left - TRACK_PAD) / TIMELINE_PX_PER_SEC)
  }

  // The drop target for panel media (single video track today; packed model per-track).
  const videoTrack =
    project.tracks.find((t) => t.type === 'video') ?? project.tracks[0]

  // --- Reposition a clip already on the timeline (pointer-capture gesture) ---
  const onClipPointerDown = (
    clip: Clip,
    _track: Track,
    e: React.PointerEvent,
  ) => {
    // Don't let the press reach the scrub handler (which seeks + deselects).
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    clipDragRef.current = {
      pointerId: e.pointerId,
      clipId: clip.id,
      startClientX: e.clientX,
      moved: false,
    }
    selectClipAt(clip)
  }

  const onClipPointerMove = (
    clip: Clip,
    track: Track,
    e: React.PointerEvent,
  ) => {
    const d = clipDragRef.current
    if (!d || d.clipId !== clip.id) return
    const dx = e.clientX - d.startClientX
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return
      d.moved = true
      onEditStart() // one undo snapshot for the whole gesture
    }
    const others = track.clips.filter((c) => c.id !== clip.id)
    const index = insertionIndex(track.clips, clientXToTime(e.clientX), clip.id)
    setDropIndicatorX(boundaryX(others, index))
    setClipDrag({ clipId: clip.id, offsetX: dx })
  }

  const onClipPointerUp = (clip: Clip, track: Track, e: React.PointerEvent) => {
    const d = clipDragRef.current
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    clipDragRef.current = null
    setClipDrag(null)
    setDropIndicatorX(null)
    if (d?.moved) {
      const index = insertionIndex(
        track.clips,
        clientXToTime(e.clientX),
        clip.id,
      )
      moveClipToIndex(clip.id, index)
    }
  }

  // --- Trim a clip by dragging its left/right edge handle (gapless ripple) ---
  const onTrimPointerDown = (
    clip: Clip,
    edge: 'left' | 'right',
    e: React.PointerEvent,
  ) => {
    // Keep the press off the clip-move / scrub handlers below it.
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    trimDragRef.current = {
      pointerId: e.pointerId,
      clipId: clip.id,
      edge,
      startClientX: e.clientX,
      origStart: clip.start,
      origTrimIn: clip.trimIn,
      origDuration: clip.duration,
      snapshotted: false,
    }
  }

  const onTrimPointerMove = (clip: Clip, e: React.PointerEvent) => {
    const d = trimDragRef.current
    if (!d || d.clipId !== clip.id) return
    const deltaSec = (e.clientX - d.startClientX) / TIMELINE_PX_PER_SEC
    if (!d.snapshotted) {
      if (Math.abs(e.clientX - d.startClientX) < DRAG_THRESHOLD) return
      d.snapshotted = true
      onEditStart() // one undo snapshot for the whole gesture
    }
    // A still image has no source timeline; video is bounded by its intrinsic length.
    const asset = assetOf(useEditorStore.getState().project, clip)
    const sourceLen =
      clip.type === 'video'
        ? (asset?.durationSec ?? Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY
    const { trimIn, duration } = resolveTrim(
      d.edge,
      { trimIn: d.origTrimIn, duration: d.origDuration },
      deltaSec,
      sourceLen,
      MIN_CLIP_DURATION,
    )
    trimClip(clip.id, trimIn, duration)
  }

  const onTrimPointerUp = (clip: Clip, e: React.PointerEvent) => {
    const d = trimDragRef.current
    if (!d || d.clipId !== clip.id) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    trimDragRef.current = null
  }

  // --- Drop a media item from the panel onto the timeline (HTML5 DnD) ---
  const isMediaDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(MEDIA_ASSET_MIME)

  const onTimelineDragOver = (e: React.DragEvent) => {
    if (!isMediaDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const index = insertionIndex(videoTrack.clips, clientXToTime(e.clientX))
    setDropIndicatorX(boundaryX(videoTrack.clips, index))
  }

  const onTimelineDragLeave = (e: React.DragEvent) => {
    // Ignore leaves onto descendants (e.g. moving across a clip) to avoid flicker.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDropIndicatorX(null)
  }

  const onTimelineDrop = (e: React.DragEvent) => {
    setDropIndicatorX(null)
    const assetId = e.dataTransfer.getData(MEDIA_ASSET_MIME)
    if (!assetId) return
    e.preventDefault()
    const st = useEditorStore.getState()
    if (!Object.hasOwn(st.project.assets, assetId)) return
    const asset = st.project.assets[assetId]
    const track =
      st.project.tracks.find((t) => t.type === 'video') ?? st.project.tracks[0]
    const index = insertionIndex(track.clips, clientXToTime(e.clientX))
    const clip = clipFromAsset(asset)
    onEditStart()
    addClipAtIndex(clip, track.id, index)
    selectClip(clip.id)
    resetExport()
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
          onDragEnter={(e) => {
            if (isMediaDrag(e)) e.preventDefault()
          }}
          onDragOver={onTimelineDragOver}
          onDragLeave={onTimelineDragLeave}
          onDrop={onTimelineDrop}
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
                    dragging={clipDrag?.clipId === clip.id}
                    dragOffsetX={
                      clipDrag?.clipId === clip.id ? clipDrag.offsetX : 0
                    }
                    onPointerDownClip={onClipPointerDown}
                    onPointerMoveClip={onClipPointerMove}
                    onPointerUpClip={onClipPointerUp}
                    onTrimDown={onTrimPointerDown}
                    onTrimMove={onTrimPointerMove}
                    onTrimUp={onTrimPointerUp}
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

          {dropIndicatorX != null && (
            <div
              className="pointer-events-none absolute bottom-2 top-7 z-20 w-[3px] -translate-x-1/2 rounded-full bg-select shadow-[0_0_6px_rgba(0,0,0,0.5)]"
              style={{ left: `${dropIndicatorX.toFixed(2)}px` }}
            />
          )}
        </div>
      </div>
    </footer>
  )
}
