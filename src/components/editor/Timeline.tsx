import { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
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
  revealTime,
  videoTrack,
} from '@/lib/model/selectors'
import { useClipInsert } from '@/hooks/useClipInsert'
import { NUDGE_SEC } from '@/hooks/useEditorKeyboard'
import { formatTimecode } from '@/lib/media'
import { isPrimaryPointer, releaseCapture } from '@/lib/pointer'
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
  onPointerCancelClip,
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
  /** Distinct from up: the gesture was TAKEN AWAY, so it must not commit. */
  onPointerCancelClip: (clip: Clip, track: Track, e: React.PointerEvent) => void
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
        onPointerCancelClip(clip, track, e)
      }}
      style={{
        left: `${left.toFixed(2)}px`,
        width: `${width.toFixed(2)}px`,
        transform: dragging
          ? `translateX(${dragOffsetX.toFixed(2)}px)`
          : undefined,
      }}
      // Touch model: an UNSELECTED clip is scroll-transparent (`touch-pan-x`),
      // so a finger landing anywhere can still pan a long timeline. Selecting it
      // claims the gesture (`touch-none`) and the next drag repositions it —
      // tap-to-select-then-drag, the same precedence the trim bars already use.
      className={`absolute inset-y-0 select-none [-webkit-touch-callout:none] ${
        selected ? 'touch-none' : 'touch-pan-x'
      } ${dragging ? 'z-30 cursor-grabbing' : 'cursor-grab'}`}
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
            {/* Square corners so the square-inner-edged trim bars meet it flush —
                the bars' rounded OUTER corners give the selection its capsule ends. */}
            <div className="absolute inset-0 border-[3px] border-select" />
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
              // Sit just OUTSIDE the clip: the left bar flush against the clip's
              // left edge (extending leftward), the right bar against its right
              // edge — flanking the selection, never covering the thumbnail.
              //
              // The bar stays 12px WIDE (it's a visual edge marker; widening it
              // would swallow neighbours on a gapless-packed track), but a
              // transparent ::after grows the HIT area to ~36×70. Biased inward
              // so only 8px encroaches on the neighbouring clip — the rest
              // lands on this clip's own body, where trim rightly beats move.
              className={`absolute -inset-y-[3px] z-30 flex w-3 cursor-ew-resize touch-none items-center justify-center bg-select after:absolute after:-inset-y-2 after:content-[''] ${
                edge === 'left'
                  ? 'right-full rounded-l-[4px] after:-left-2 after:-right-4'
                  : 'left-full rounded-r-[4px] after:-left-4 after:-right-2'
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
  const moveClipToIndex = useEditorStore((s) => s.moveClipToIndex)
  const trimClip = useEditorStore((s) => s.trimClip)
  const { insertAssetAtTime } = useClipInsert()

  const scrubRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  // Scrub gesture bookkeeping. `live` means "seek continuously as the pointer
  // moves" — true for mouse/pen, false for touch (where the native pan owns
  // horizontal drags, so touch seeks on TAP instead; see the pointerup branch).
  const scrubDragRef = useRef<{
    pointerId: number
    startClientX: number
    moved: boolean
    live: boolean
  } | null>(null)
  // Dragging the playhead knob itself. This is the precise-scrub path on touch
  // (where the track surface yields horizontal drags to the native pan) and a
  // usability win on desktop.
  const playheadDragRef = useRef<number | null>(null)
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
    const reveal = revealTime(clip, currentTime)
    if (reveal != null) onSeek(reveal)
  }

  /** clientX → timeline seconds (clamped ≥0), accounting for scroll + inset. */
  const clientXToTime = (clientX: number) => {
    const el = scrubRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.max(0, (clientX - rect.left - TRACK_PAD) / TIMELINE_PX_PER_SEC)
  }

  // The drop target for panel media (packed model per-track).
  const dropTrack = videoTrack(project)

  /** True while any timeline gesture owns a pointer — gestures are exclusive,
   *  so a second finger can't corrupt the one in flight. */
  const gestureBusy = () =>
    clipDragRef.current != null ||
    trimDragRef.current != null ||
    scrubDragRef.current != null ||
    playheadDragRef.current != null

  // --- Drag the playhead knob (works identically on mouse and touch) ---
  const onPlayheadPointerDown = (e: React.PointerEvent) => {
    if (!isPrimaryPointer(e) || gestureBusy()) return
    // Keep the press off the scrub surface underneath (which would also seek).
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    playheadDragRef.current = e.pointerId
  }

  const onPlayheadPointerMove = (e: React.PointerEvent) => {
    if (playheadDragRef.current !== e.pointerId) return
    seekFromClientX(e.clientX)
  }

  const onPlayheadPointerUp = (e: React.PointerEvent) => {
    if (playheadDragRef.current !== e.pointerId) return
    releaseCapture(e.currentTarget, e.pointerId)
    playheadDragRef.current = null
  }

  /** Tear down a clip-reposition gesture: release capture and clear both the
   *  imperative ref and the render state. Shared by up and cancel. */
  const releaseClipDrag = (el: Element, pointerId: number) => {
    releaseCapture(el, pointerId)
    clipDragRef.current = null
    setClipDrag(null)
    setDropIndicatorX(null)
  }

  // --- Reposition a clip already on the timeline (pointer-capture gesture) ---
  const onClipPointerDown = (
    clip: Clip,
    _track: Track,
    e: React.PointerEvent,
  ) => {
    if (!isPrimaryPointer(e) || gestureBusy()) return
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
    if (!d || d.pointerId !== e.pointerId || d.clipId !== clip.id) return
    const dx = e.clientX - d.startClientX
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return
      d.moved = true
    }
    const others = track.clips.filter((c) => c.id !== clip.id)
    const index = insertionIndex(track.clips, clientXToTime(e.clientX), clip.id)
    setDropIndicatorX(boundaryX(others, index))
    setClipDrag({ clipId: clip.id, offsetX: dx })
  }

  const onClipPointerUp = (clip: Clip, track: Track, e: React.PointerEvent) => {
    const d = clipDragRef.current
    if (!d || d.pointerId !== e.pointerId || d.clipId !== clip.id) return
    releaseClipDrag(e.currentTarget, e.pointerId)
    if (!d.moved) return
    const index = insertionIndex(track.clips, clientXToTime(e.clientX), clip.id)
    // Snapshot immediately before the (single) mutation, not when the drag
    // crosses the threshold — so an abandoned drag leaves no undo entry.
    onEditStart()
    moveClipToIndex(clip.id, index)
  }

  /** The browser took the gesture (native pan, OS interrupt). Drop it silently:
   *  no reorder, and — because the snapshot happens at the commit point — no
   *  stray undo entry either. */
  const onClipPointerCancel = (
    clip: Clip,
    _track: Track,
    e: React.PointerEvent,
  ) => {
    const d = clipDragRef.current
    if (!d || d.pointerId !== e.pointerId || d.clipId !== clip.id) return
    releaseClipDrag(e.currentTarget, e.pointerId)
  }

  // --- Trim a clip by dragging its left/right edge handle (gapless ripple) ---
  const onTrimPointerDown = (
    clip: Clip,
    edge: 'left' | 'right',
    e: React.PointerEvent,
  ) => {
    if (!isPrimaryPointer(e) || gestureBusy()) return
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
    if (!d || d.pointerId !== e.pointerId || d.clipId !== clip.id) return
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

  // Shared by up AND cancel: the trim is applied live on every move, so ending
  // the gesture is the correct response either way — there is nothing to commit.
  const onTrimPointerUp = (clip: Clip, e: React.PointerEvent) => {
    const d = trimDragRef.current
    if (!d || d.pointerId !== e.pointerId || d.clipId !== clip.id) return
    releaseCapture(e.currentTarget, e.pointerId)
    trimDragRef.current = null
  }

  // --- Drop a media item from the panel onto the timeline (HTML5 DnD) ---
  const isMediaDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(MEDIA_ASSET_MIME)

  const onTimelineDragOver = (e: React.DragEvent) => {
    if (!isMediaDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const index = insertionIndex(dropTrack.clips, clientXToTime(e.clientX))
    setDropIndicatorX(boundaryX(dropTrack.clips, index))
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
    onEditStart()
    // Same seam the touch tap-to-add path uses (see useClipInsert).
    insertAssetAtTime(assetId, clientXToTime(e.clientX))
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
    // `relative` anchors the mobile contextual tool pill; the height comes from
    // --timeline-h (styles.css) so the toast offset can't drift from it.
    <footer className="relative flex h-[var(--timeline-h)] shrink-0 flex-col border-t border-edge bg-surface/70">
      <div className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-edge/70 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        {/* Below lg these move into the contextual pill at the bottom of the
            timeline, so the narrow transport row doesn't overflow. */}
        <div className="col-start-1 hidden items-center gap-1 lg:flex">
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

        {/* `col-start-2` is load-bearing: the side cells are `display:none`
            below lg, which removes them from the grid ENTIRELY, so without
            explicit placement this auto-places into column 1 — a `1fr` track.
            That both un-centres the transport and squeezes it hard enough to
            wrap the timecode onto three lines and overflow the row. */}
        <div className="col-start-2 flex items-center gap-1">
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
          {/* Step back/forward — the ←/→ shortcuts' only on-screen equivalent,
              and the precise-seek path before Split when there's no keyboard. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  onSeek(currentTime - NUDGE_SEC)
                }}
                disabled={!hasClips}
                aria-label={`Back ${NUDGE_SEC.toString()} second`}
                className="h-7 w-7"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back {NUDGE_SEC}s (←)</TooltipContent>
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
                  onSeek(currentTime + NUDGE_SEC)
                }}
                disabled={!hasClips}
                aria-label={`Forward ${NUDGE_SEC.toString()} second`}
                className="h-7 w-7"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Forward {NUDGE_SEC}s (→)</TooltipContent>
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
          <div className="ml-2 whitespace-nowrap font-mono text-xs tabular-nums sm:ml-3">
            <span className="text-ink">{formatTimecode(currentTime)}</span>
            <span className="text-muted"> / {formatTimecode(total)}</span>
          </div>
        </div>

        {/* Decorative — dropped below lg, where the width is needed. */}
        <div className="col-start-3 hidden justify-end lg:flex">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted/50">
            On-device · WebCodecs
          </span>
        </div>
      </div>

      <div
        ref={viewportRef}
        // `overscroll-x-contain` keeps a horizontal swipe here from chaining out
        // to the document — iOS otherwise reads it as a back-navigation.
        className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-1.5"
      >
        <div
          ref={scrubRef}
          onPointerDown={(e) => {
            // Reached only off-clip (clips stop propagation).
            if (!isPrimaryPointer(e) || gestureBusy()) return
            // Touch can't drag-scrub here: this surface sits inside a horizontal
            // scroller and yields the drag to the native pan (touch-action:
            // pan-x), so the browser will fire pointercancel. Touch therefore
            // seeks on TAP (in pointerup) and scrubs via the playhead knob.
            const live = e.pointerType !== 'touch'
            scrubDragRef.current = {
              pointerId: e.pointerId,
              startClientX: e.clientX,
              moved: false,
              live,
            }
            if (live) {
              selectClip(null)
              e.currentTarget.setPointerCapture(e.pointerId)
              seekFromClientX(e.clientX)
            }
          }}
          onPointerMove={(e) => {
            const s = scrubDragRef.current
            if (!s || s.pointerId !== e.pointerId) return
            if (Math.abs(e.clientX - s.startClientX) > DRAG_THRESHOLD) {
              s.moved = true
            }
            if (s.live) seekFromClientX(e.clientX)
          }}
          onPointerUp={(e) => {
            const s = scrubDragRef.current
            if (!s || s.pointerId !== e.pointerId) return
            scrubDragRef.current = null
            releaseCapture(e.currentTarget, e.pointerId)
            // A touch that didn't travel is a tap: deselect + seek there.
            if (!s.live && !s.moved) {
              selectClip(null)
              seekFromClientX(e.clientX)
            }
          }}
          onPointerCancel={(e) => {
            // The native pan won — this was a scroll, not a scrub.
            if (scrubDragRef.current?.pointerId === e.pointerId) {
              scrubDragRef.current = null
            }
          }}
          onDragEnter={(e) => {
            if (isMediaDrag(e)) e.preventDefault()
          }}
          onDragOver={onTimelineDragOver}
          onDragLeave={onTimelineDragLeave}
          onDrop={onTimelineDrop}
          style={{ width: `${trackWidth.toString()}px` }}
          // `pan-x` hands horizontal touch drags to the parent scroller (so a
          // long timeline is pannable) while still delivering pointerdown/up —
          // which is what makes tap-to-seek work. `pinch-zoom` is kept so the
          // page remains zoomable for accessibility.
          className="relative h-full cursor-pointer select-none [touch-action:pan-x_pinch-zoom]"
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
                    onPointerCancelClip={onClipPointerCancel}
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
            {/* The knob is the grab target: a transparent 44×36 box around a
                9px marker. `touch-none` claims the drag from the scroller, so
                this is how you scrub precisely on touch. */}
            <span
              role="slider"
              tabIndex={0}
              aria-label="Playhead"
              aria-valuemin={0}
              aria-valuemax={Math.round(rulerDuration * 10) / 10}
              aria-valuenow={Math.round(currentTime * 10) / 10}
              onPointerDown={onPlayheadPointerDown}
              onPointerMove={onPlayheadPointerMove}
              onPointerUp={onPlayheadPointerUp}
              onPointerCancel={onPlayheadPointerUp}
              className="pointer-events-auto absolute left-1/2 top-0 z-30 flex h-9 w-11 -translate-x-1/2 cursor-ew-resize touch-none items-start justify-center"
            >
              <span className="h-3.5 w-[9px] rounded-[2px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.6)]" />
            </span>
          </div>

          {dropIndicatorX != null && (
            <div
              className="pointer-events-none absolute bottom-2 top-7 z-20 w-[3px] -translate-x-1/2 rounded-full bg-select shadow-[0_0_6px_rgba(0,0,0,0.5)]"
              style={{ left: `${dropIndicatorX.toFixed(2)}px` }}
            />
          )}
        </div>
      </div>

      {/* Below lg the transport row has no space for the tools, so they appear
          here as a contextual pill whenever something is selected. Same `tools`
          array as the desktop row — one definition, two renderings. */}
      {selectedClip && (
        <div className="absolute bottom-3 right-[max(0.5rem,env(safe-area-inset-right))] z-30 flex items-center gap-1 rounded-full border border-edge bg-raised/95 p-1 shadow-lg backdrop-blur lg:hidden">
          {tools.map(({ Icon, label, onClick, enabled }) => (
            <Button
              key={label}
              variant="ghost"
              size="icon"
              onClick={onClick}
              disabled={!enabled}
              aria-label={label}
              className="h-9 w-9 rounded-full"
            >
              <Icon className="h-4 w-4" />
            </Button>
          ))}
        </div>
      )}
    </footer>
  )
}
