import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  Blend,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pause,
  Play,
  Scissors,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Trash2,
  Type,
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
  freeTrimWindow,
  insertionIndex,
  projectDuration,
  resolveTrim,
  revealTime,
  snapTargets,
  snapTime,
  videoTrack,
} from '@/lib/model/selectors'
import { laneHasRoom, resolveLaneStart } from '@/lib/model/lanes'
import { assetClipDuration } from '@/lib/model/factories'
import { useClipInsert } from '@/hooks/useClipInsert'
import { NUDGE_SEC } from '@/hooks/useEditorKeyboard'
import { DEFAULT_IMAGE_DURATION_SEC, formatTimecode } from '@/lib/media'
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
/** Visual seam (px) inset between adjacent clips — purely presentational; the
 *  document model stays gapless (repackTrack). Centered on each true boundary,
 *  so the playhead and insertion caret still land in the middle of it. */
const CLIP_GAP = 4
const MIN_LABEL_PX = 56
const RULER_FALLBACK_SEC = 30
/** Pointer travel (px) before a clip press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 4
/** Shortest a clip can be trimmed to (s), so a trimmed clip stays grabbable. */
const MIN_CLIP_DURATION = 0.1
/** How close (px) a dragged overlay clip must get to an edge before it snaps. */
const SNAP_PX = 8
/** How near (px) the pointer must be to the scroll viewport's top/bottom edge
 *  before a vertical clip drag starts nudging the lanes into view. */
const EDGE_SCROLL_ZONE = 24
const EDGE_SCROLL_STEP = 8

/**
 * Where an in-flight drag would land, resolved from the pointer by ONE
 * function for the indicator and the commit, so they cannot disagree.
 * - `main`: the magnetic track — an insertion slot and its caret.
 * - `lane`: a free spot on an existing overlay lane (the outline shows the
 *   exact landing window, which may be clamped away from the pointer).
 * - `seam`: between lanes / above the stack — a NEW lane directly above
 *   `belowTrackId` (array order is z-order, so above = later in the array).
 */
type DropTarget =
  | { kind: 'main'; trackId: string; index: number; caretX: number }
  | { kind: 'lane'; trackId: string; start: number; duration: number }
  | { kind: 'seam'; belowTrackId: string; seamY: number; start: number }

/** Half-gap (px) the seam indicator sits above a lane. */
const SEAM_OFFSET_PX = 5

/** The pointer zone the vertical hit-test resolves: a lane body (with the
 *  seam-above-it position precomputed from the same rect read) or a gap. */
type LaneZone =
  | { kind: 'main' | 'lane'; track: Track; seamYAbove: number }
  | { kind: 'seam'; belowTrackId: string; seamY: number }

/** The seam drop directly above a zone's lane — where a new lane grows. */
function seamOf(
  zone: { track: Track; seamYAbove: number },
  start: number,
): DropTarget {
  return {
    kind: 'seam',
    belowTrackId: zone.track.id,
    seamY: zone.seamYAbove,
    start,
  }
}

/** Land on the lane if the window fits, else stack onto a new lane above it —
 *  the shared tail of both drag resolvers. */
function laneOrSeam(
  zone: { track: Track; seamYAbove: number },
  start: number,
  duration: number,
): DropTarget {
  return laneHasRoom(zone.track.clips, start, duration)
    ? { kind: 'lane', trackId: zone.track.id, start, duration }
    : seamOf(zone, start)
}

/** Drag indicators re-resolve at pointer rate (dragover restates an unchanged
 *  target continuously); value-compare so an unchanged target keeps its object
 *  identity and React bails out of the re-render. */
function sameDropTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind) return false
  switch (a.kind) {
    case 'main':
      return (
        b.kind === 'main' &&
        a.trackId === b.trackId &&
        a.index === b.index &&
        a.caretX === b.caretX
      )
    case 'lane':
      return (
        b.kind === 'lane' &&
        a.trackId === b.trackId &&
        a.start === b.start &&
        a.duration === b.duration
      )
    case 'seam':
      return (
        b.kind === 'seam' &&
        a.belowTrackId === b.belowTrackId &&
        a.seamY === b.seamY &&
        a.start === b.start
      )
  }
}

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

/**
 * Memoized on purpose. immer hands out a NEW `project` object on every document
 * mutation, and Timeline subscribes to it wholesale — so without this, dragging
 * an inspector slider (or a preview handle) re-renders every clip on the
 * timeline at 60fps. `clip` and `track` keep their identity under immer unless
 * that clip actually changed, and every handler prop above is a stable
 * `useCallback`, so this memo genuinely holds.
 */
const ClipBox = memo(function ClipBox({
  clip,
  track,
  selected,
  dragging,
  dragOffsetX,
  dragOffsetY,
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
  dragOffsetY: number
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
  // Only the packed video track gets a seam; the overlay lane is free-positioned
  // and semantically has no "transition between clips", so it stays byte-identical.
  const gap = track.type === 'video' ? CLIP_GAP : 0
  const rawWidth = clip.duration * TIMELINE_PX_PER_SEC
  // Half the gap comes off each side, so the seam is centered on the real
  // boundary (where the playhead / insertion caret already sit). Clamp so a
  // ~0.1s sliver clip (MIN_CLIP_DURATION → 4px) can't collapse to zero/negative.
  const width = Math.max(rawWidth - gap, 2)
  const left = TRACK_PAD + clip.start * TIMELINE_PX_PER_SEC + gap / 2
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
          ? `translate(${dragOffsetX.toFixed(2)}px, ${dragOffsetY.toFixed(2)}px)`
          : undefined,
      }}
      // Touch model: an UNSELECTED clip is scroll-transparent (`pan-x pan-y`),
      // so a finger landing anywhere can still pan a long timeline OR reach a
      // lower lane. Selecting it claims the gesture (`touch-none`) and the next
      // drag repositions it — tap-to-select-then-drag, the same precedence the
      // trim bars already use.
      className={`absolute inset-y-0 select-none [-webkit-touch-callout:none] ${
        selected ? 'touch-none' : '[touch-action:pan-x_pan-y]'
      } ${dragging ? 'z-30 cursor-grabbing' : 'cursor-grab'}`}
    >
      <div
        className={`absolute inset-0 overflow-hidden bg-black ${selected ? 'rounded-none ring-0' : 'rounded-[9px]'} ${dragging ? 'shadow-[0_8px_24px_rgba(0,0,0,0.55)]' : ''}`}
      >
        {/* Filmstrip by CLIP type, not track type — media on an overlay lane
            (picture-in-picture) keeps its thumbnails there too. */}
        {clip.type !== 'text' && thumbs.length > 0 ? (
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
        ) : clip.type === 'text' ? (
          // Text has no filmstrip; an accent-tinted chip distinguishes the
          // overlay lane at a glance.
          <div className="flex h-full w-full items-center gap-1 bg-linear-to-r from-accent/30 via-accent/15 to-accent/30 px-1.5">
            <Type className="h-3 w-3 shrink-0 text-accent" />
            <span className="truncate text-[10px] font-medium text-ink/90">
              {label}
            </span>
          </div>
        ) : (
          <div className="h-full w-full bg-linear-to-r from-raised via-edge/50 to-raised" />
        )}
        {clip.type !== 'text' && (
          <span className="absolute bottom-1 left-1.5 max-w-[80%] truncate rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/90">
            {label}
          </span>
        )}
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
})

export function Timeline({ onTogglePlay, onSeek, onEditStart }: TimelineProps) {
  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const playing = useEditorStore((s) => s.playing)
  const selectedClipId = useEditorStore((s) => s.selectedClipId)
  const selectClip = useEditorStore((s) => s.selectClip)
  const splitClip = useEditorStore((s) => s.splitClip)
  const duplicateClip = useEditorStore((s) => s.duplicateClip)
  const removeClip = useEditorStore((s) => s.removeClip)
  const moveClipToTrack = useEditorStore((s) => s.moveClipToTrack)
  const moveClipToNewTrack = useEditorStore((s) => s.moveClipToNewTrack)
  const setPanel = useEditorStore((s) => s.setPanel)
  const setClipTrimWindow = useEditorStore((s) => s.setClipTrimWindow)
  const { insertAssetAtTime, insertAssetOnLane, insertAssetOnNewLane } =
    useClipInsert()

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
    startClientY: number
    sourceTrackId: string
    moved: boolean
  } | null>(null)
  const [clipDrag, setClipDrag] = useState<{
    clipId: string
    offsetX: number
    offsetY: number
  } | null>(null)
  // Live lane elements by track id — the vertical hit-test reads their rects
  // per move, so it stays correct across variable lane heights and mid-drag
  // scrolls without any cached geometry.
  const laneElsRef = useRef(new Map<string, HTMLDivElement>())
  // Edge-trim gesture bookkeeping (imperative); geometry updates live on every
  // move via setClipTrimWindow.
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
  // Where the in-flight drag (clip reposition OR panel drop) would land.
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

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

  const selectClipAt = useCallback(
    (clip: Clip) => {
      selectClip(clip.id)
      // Bring the playhead onto the clip so the preview shows it. Read the
      // playhead IMPERATIVELY: closing over `currentTime` would give this a new
      // identity on every frame of playback, which defeats the memoized ClipBox
      // below and re-renders every clip 60x/s.
      const reveal = revealTime(clip, useEditorStore.getState().currentTime)
      if (reveal != null) onSeek(reveal)
    },
    [selectClip, onSeek],
  )

  /** clientX → timeline seconds (clamped ≥0), accounting for scroll + inset. */
  const clientXToTime = useCallback((clientX: number) => {
    const el = scrubRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.max(0, (clientX - rect.left - TRACK_PAD) / TIMELINE_PX_PER_SEC)
  }, [])

  /** Lanes worth drawing: always the video track, plus any overlay track that
   *  actually holds something (the store prunes those, so this is a backstop). */
  const visibleTracks = project.tracks.filter(
    (t) => t.type !== 'overlay' || t.clips.length > 0,
  )

  /** Which lane (or seam between lanes) `clientY` is over, from the rendered
   *  lanes' live rects. Everything above the top lane — the sticky ruler
   *  included — is the "new topmost lane" seam; everything below the bottom
   *  (main) lane still targets it. Y values are scrubRef-relative, which is
   *  scroll-invariant (lanes and scrub surface move together). */
  const classifyLaneZone = useCallback((clientY: number): LaneZone | null => {
    const scrubRect = scrubRef.current?.getBoundingClientRect()
    if (!scrubRect) return null
    const tracks = useEditorStore.getState().project.tracks
    // Walk in VISUAL order — top of the stack first, i.e. the tracks array
    // (z-order, bottom-up) backwards.
    let above: DOMRect | null = null
    for (let i = tracks.length - 1; i >= 0; i--) {
      const el = laneElsRef.current.get(tracks[i].id)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (clientY < rect.top) {
        // In the gap above this lane (above the whole stack when none is).
        const gapTop = above?.bottom ?? rect.top - 2 * SEAM_OFFSET_PX
        return {
          kind: 'seam',
          belowTrackId: tracks[i].id,
          seamY: (gapTop + rect.top) / 2 - scrubRect.top,
        }
      }
      if (clientY <= rect.bottom || i === 0) {
        return {
          kind: tracks[i].type === 'video' ? 'main' : 'lane',
          track: tracks[i],
          seamYAbove: rect.top - scrubRect.top - SEAM_OFFSET_PX,
        }
      }
      above = rect
    }
    return null
  }, [])

  /** `raw` snapped to nearby clip edges and the playhead — the shared drag
   *  idiom of both resolvers. */
  const snapStart = useCallback((raw: number, excludeId?: string): number => {
    const st = useEditorStore.getState()
    return snapTime(
      Math.max(0, raw),
      snapTargets(st.project, st.currentTime, excludeId),
      SNAP_PX / TIMELINE_PX_PER_SEC,
    )
  }, [])

  const updateDropTarget = useCallback((next: DropTarget | null) => {
    setDropTarget((prev) => (sameDropTarget(prev, next) ? prev : next))
  }, [])

  /** True while any timeline gesture owns a pointer — gestures are exclusive,
   *  so a second finger can't corrupt the one in flight. */
  const gestureBusy = useCallback(
    () =>
      clipDragRef.current != null ||
      trimDragRef.current != null ||
      scrubDragRef.current != null ||
      playheadDragRef.current != null,
    [],
  )

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

  /** Where the dragged CLIP would land, from the live pointer. One resolver
   *  for the indicator (move) and the commit (up), so they cannot disagree. */
  const resolveClipDrop = useCallback(
    (
      clip: Clip,
      e: { clientX: number; clientY: number },
    ): DropTarget | null => {
      const d = clipDragRef.current
      const zone = classifyLaneZone(e.clientY)
      if (!d || !zone) return null
      // The everyday magnetic reorder needs no snap math — slot and caret only.
      if (zone.kind === 'main' && clip.type !== 'text') {
        const index = insertionIndex(
          zone.track.clips,
          clientXToTime(e.clientX),
          clip.id,
        )
        const others = zone.track.clips.filter((c) => c.id !== clip.id)
        return {
          kind: 'main',
          trackId: zone.track.id,
          index,
          caretX: boundaryX(others, index),
        }
      }
      // Time from the drag DELTA, not the pointer — the grab point inside the
      // clip stays under the finger. Snapped to nearby edges (every lane's clip
      // edges are targets) so captions land flush against cuts.
      const snapped = snapStart(
        clip.start + (e.clientX - d.startClientX) / TIMELINE_PX_PER_SEC,
        clip.id,
      )
      if (zone.kind === 'seam') return { ...zone, start: snapped }
      // Text never joins the magnetic track — remap to the lowest overlay
      // position, a new lane directly above the main one.
      if (zone.kind === 'main') return seamOf(zone, snapped)
      // An overlay lane. Within its own lane a clip clamps flush against its
      // siblings (it never spawns a lane by sliding sideways); arriving from
      // elsewhere onto occupied time means "stack it" — a new lane above.
      if (d.sourceTrackId === zone.track.id) {
        return {
          kind: 'lane',
          trackId: zone.track.id,
          start: resolveLaneStart(
            zone.track.clips,
            snapped,
            clip.duration,
            clip.id,
          ),
          duration: clip.duration,
        }
      }
      return laneOrSeam(zone, snapped, clip.duration)
    },
    [classifyLaneZone, snapStart, clientXToTime],
  )

  /** Tear down a clip-reposition gesture: release capture and clear both the
   *  imperative ref and the render state. Shared by up and cancel. */
  const releaseClipDrag = useCallback(
    (el: Element, pointerId: number) => {
      releaseCapture(el, pointerId)
      clipDragRef.current = null
      setClipDrag(null)
      updateDropTarget(null)
    },
    [updateDropTarget],
  )

  // --- Reposition a clip already on the timeline (pointer-capture gesture) ---
  const onClipPointerDown = useCallback(
    (clip: Clip, track: Track, e: React.PointerEvent) => {
      if (!isPrimaryPointer(e) || gestureBusy()) return
      // Don't let the press reach the scrub handler (which seeks + deselects).
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      clipDragRef.current = {
        pointerId: e.pointerId,
        clipId: clip.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        sourceTrackId: track.id,
        moved: false,
      }
      selectClipAt(clip)
    },
    [gestureBusy, selectClipAt],
  )

  const onClipPointerMove = useCallback(
    (clip: Clip, _track: Track, e: React.PointerEvent) => {
      const d = clipDragRef.current
      if (!d || d.pointerId !== e.pointerId || d.clipId !== clip.id) return
      const dx = e.clientX - d.startClientX
      const dy = e.clientY - d.startClientY
      if (!d.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        d.moved = true
      }
      setClipDrag({ clipId: clip.id, offsetX: dx, offsetY: dy })
      updateDropTarget(resolveClipDrop(clip, e))
      // Nudge the lanes into view when the pointer nears the viewport's
      // vertical edges — rects are re-read per move, so the hit-test stays
      // correct across the scroll.
      const vp = viewportRef.current
      if (vp) {
        const r = vp.getBoundingClientRect()
        if (e.clientY < r.top + EDGE_SCROLL_ZONE) {
          vp.scrollTop -= EDGE_SCROLL_STEP
        } else if (e.clientY > r.bottom - EDGE_SCROLL_ZONE) {
          vp.scrollTop += EDGE_SCROLL_STEP
        }
      }
    },
    [resolveClipDrop],
  )

  const onClipPointerUp = useCallback(
    (clip: Clip, _track: Track, e: React.PointerEvent) => {
      const d = clipDragRef.current
      if (!d || d.pointerId !== e.pointerId || d.clipId !== clip.id) return
      // Resolve BEFORE teardown (the resolver reads the gesture ref).
      const target = d.moved ? resolveClipDrop(clip, e) : null
      releaseClipDrag(e.currentTarget, e.pointerId)
      if (!target) return
      // Snapshot immediately before the (single) mutation, not when the drag
      // crosses the threshold — so an abandoned drag leaves no undo entry.
      // `moveClipToTrack` is same-track-safe, so one action covers reorder,
      // re-time and cross-lane moves alike.
      onEditStart()
      switch (target.kind) {
        case 'main':
          moveClipToTrack(clip.id, target.trackId, { index: target.index })
          return
        case 'lane':
          moveClipToTrack(clip.id, target.trackId, { start: target.start })
          return
        case 'seam':
          moveClipToNewTrack(clip.id, target.belowTrackId, target.start)
      }
    },
    [
      releaseClipDrag,
      resolveClipDrop,
      onEditStart,
      moveClipToTrack,
      moveClipToNewTrack,
    ],
  )

  /** The browser took the gesture (native pan, OS interrupt). Drop it silently:
   *  no reorder, and — because the snapshot happens at the commit point — no
   *  stray undo entry either. */
  const onClipPointerCancel = useCallback(
    (clip: Clip, _track: Track, e: React.PointerEvent) => {
      const d = clipDragRef.current
      if (!d || d.pointerId !== e.pointerId || d.clipId !== clip.id) return
      releaseClipDrag(e.currentTarget, e.pointerId)
    },
    [releaseClipDrag],
  )

  // --- Trim a clip by dragging its left/right edge handle (gapless ripple) ---
  const onTrimPointerDown = useCallback(
    (clip: Clip, edge: 'left' | 'right', e: React.PointerEvent) => {
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
    },
    [gestureBusy],
  )

  const onTrimPointerMove = useCallback(
    (clip: Clip, e: React.PointerEvent) => {
      const d = trimDragRef.current
      if (!d || d.pointerId !== e.pointerId || d.clipId !== clip.id) return
      const deltaSec = (e.clientX - d.startClientX) / TIMELINE_PX_PER_SEC
      if (!d.snapshotted) {
        if (Math.abs(e.clientX - d.startClientX) < DRAG_THRESHOLD) return
        d.snapshotted = true
        onEditStart() // one undo snapshot for the whole gesture
      }
      // A still image has no source timeline; video is bounded by its intrinsic length.
      const st = useEditorStore.getState()
      const asset = assetOf(st.project, clip)
      const sourceLen =
        clip.type === 'video'
          ? (asset?.durationSec ?? Number.POSITIVE_INFINITY)
          : Number.POSITIVE_INFINITY
      const next = resolveTrim(
        d.edge,
        { trimIn: d.origTrimIn, duration: d.origDuration },
        deltaSec,
        sourceLen,
        MIN_CLIP_DURATION,
      )
      // One commit for both track kinds: `freeTrimWindow` moves `start` with
      // the left edge (what a free lane needs), and the store routes — lane
      // clips clamp flush against neighbours, magnetic tracks re-pack and
      // ignore the start. No track-type branch here.
      setClipTrimWindow(
        clip.id,
        freeTrimWindow(
          d.edge,
          { start: d.origStart, duration: d.origDuration },
          next,
        ),
      )
    },
    [onEditStart, setClipTrimWindow],
  )

  // Shared by up AND cancel: the trim is applied live on every move, so ending
  // the gesture is the correct response either way — there is nothing to commit.
  const onTrimPointerUp = useCallback((clip: Clip, e: React.PointerEvent) => {
    const d = trimDragRef.current
    if (!d || d.pointerId !== e.pointerId || d.clipId !== clip.id) return
    releaseCapture(e.currentTarget, e.pointerId)
    trimDragRef.current = null
  }, [])

  // --- Drop a media item from the panel onto the timeline (HTML5 DnD) ---
  const isMediaDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(MEDIA_ASSET_MIME)

  /** Where the dragged ASSET would land. `assetId` comes from the store during
   *  dragover (dataTransfer is unreadable until drop) and from the drop event
   *  itself on commit — both name the same asset, so preview and commit agree. */
  const resolveAssetDrop = useCallback(
    (
      e: { clientX: number; clientY: number },
      assetId: string | null,
    ): DropTarget | null => {
      const st = useEditorStore.getState()
      const main = videoTrack(st.project)
      const zone = classifyLaneZone(e.clientY)
      const time = clientXToTime(e.clientX)
      if (!zone || zone.kind === 'main') {
        const index = insertionIndex(main.clips, time)
        return {
          kind: 'main',
          trackId: main.id,
          index,
          caretX: boundaryX(main.clips, index),
        }
      }
      // The committed clip gets its duration from `clipFromAsset`; sizing the
      // preview with the same `assetClipDuration` keeps the two in agreement.
      const asset = assetId != null ? st.project.assets[assetId] : undefined
      const duration = asset
        ? assetClipDuration(asset)
        : DEFAULT_IMAGE_DURATION_SEC
      const start = snapStart(time)
      if (zone.kind === 'seam') return { ...zone, start }
      // Occupied time on that lane ⇒ stack: a new lane directly above it.
      return laneOrSeam(zone, start, duration)
    },
    [classifyLaneZone, snapStart, clientXToTime],
  )

  const onTimelineDragOver = (e: React.DragEvent) => {
    if (!isMediaDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    updateDropTarget(
      resolveAssetDrop(e, useEditorStore.getState().draggingAssetId),
    )
  }

  const onTimelineDragLeave = (e: React.DragEvent) => {
    // Ignore leaves onto descendants (e.g. moving across a clip) to avoid flicker.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    updateDropTarget(null)
  }

  const onTimelineDrop = (e: React.DragEvent) => {
    updateDropTarget(null)
    const assetId = e.dataTransfer.getData(MEDIA_ASSET_MIME)
    if (!assetId) return
    e.preventDefault()
    const target = resolveAssetDrop(e, assetId)
    onEditStart()
    // Same seam the touch tap-to-add path uses (see useClipInsert).
    if (!target || target.kind === 'main') {
      insertAssetAtTime(assetId, clientXToTime(e.clientX))
    } else if (target.kind === 'lane') {
      insertAssetOnLane(assetId, target.trackId, target.start)
    } else {
      insertAssetOnNewLane(assetId, target.belowTrackId, target.start)
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
        // Scrolls on BOTH axes now that a second lane can exist: rather than
        // growing --timeline-h (which on a landscape phone would leave the
        // preview ~90px tall), extra lanes scroll inside the fixed height.
        // `overscroll-contain` keeps a swipe from chaining out to the document —
        // iOS otherwise reads a horizontal one as a back-navigation.
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain pb-2 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-1.5"
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
          // `min-h-full` stretches the scrub surface to fill the viewport even
          // when the lanes are short, so the playhead line (inset-y-0 of this
          // box) spans the whole visible timeline instead of stopping where the
          // content ends. With many lanes it grows past the viewport and the
          // line scrolls with them — either way it's full-height.
          //
          // `pan-x pan-y` hands touch drags to the parent scroller (so a long
          // timeline is pannable and extra lanes reachable) while still
          // delivering pointerdown/up — which is what makes tap-to-seek work.
          // `pinch-zoom` is kept so the page remains zoomable for accessibility.
          className="relative min-h-full cursor-pointer select-none [touch-action:pan-x_pan-y_pinch-zoom]"
        >
          {/* Sticky on the vertical axis only: the ticks still scroll sideways
              with the content, but the time reference never scrolls away when
              the lanes do. `scrubRef`'s left edge is unaffected, so
              clientXToTime needs no change. */}
          <div className="sticky top-0 z-20 h-6 bg-surface/95 backdrop-blur-sm">
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

            {/* The knob is the grab target: a transparent 44×36 box around a
                9px marker. `touch-none` claims the drag from the scroller, so
                this is how you scrub precisely on touch. It rides the STICKY
                ruler, so scrolling to a lower lane never puts it out of reach. */}
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
              style={{ left: `${playheadX.toFixed(2)}px` }}
              className="absolute top-0 z-30 flex h-9 w-11 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center"
            >
              {/* A rounded-top, pointed-bottom gem. `--surface` fill + `--ink`
                  stroke inverts with the theme (black outline / white fill in
                  light; white outline / dark fill in dark). Centred in the hit
                  box, its point dips just past the ruler's bottom edge so it
                  meets the line seamlessly (the gem, z-30, draws over it). */}
              <svg
                width="15"
                height="19"
                viewBox="0 0 15 19"
                aria-hidden="true"
                className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
              >
                <path
                  d="M3 1 H12 A2 2 0 0 1 14 3 V10 L7.5 18 L1 10 V3 A2 2 0 0 1 3 1 Z"
                  style={{
                    fill: 'var(--surface)',
                    stroke: 'var(--ink)',
                    strokeWidth: 1.5,
                  }}
                />
              </svg>
            </span>
          </div>

          {hasClips ? (
            // An EMPTY overlay track never renders (the store prunes them), so
            // a project with no text costs exactly zero extra vertical space.
            // REVERSED: array order is z-order bottom-up, so the last track —
            // the top compositing layer — renders as the TOP lane and the
            // magnetic main track sits at the bottom, CapCut-style.
            [...visibleTracks].reverse().map((track) => (
              <div
                key={track.id}
                ref={(el) => {
                  if (el) laneElsRef.current.set(track.id, el)
                  else laneElsRef.current.delete(track.id)
                }}
                // `isolate` makes each lane its own stacking context, so the
                // clips' z-20/z-30 decorations stay contained here and the
                // playhead line (z-10, a scrubRef child) paints ABOVE the whole
                // lane while still sitting below the sticky ruler. The lane
                // hosting a dragged clip is lifted (z-40) above its later
                // SIBLINGS, or the ghost would slide UNDER the lanes below it.
                className={`relative isolate mt-2 ${
                  // Text chips are compact; any lane holding media (a
                  // picture-in-picture clip) needs filmstrip height.
                  track.type === 'overlay' &&
                  track.clips.every((c) => c.type === 'text')
                    ? 'h-9'
                    : 'h-14'
                } ${
                  clipDrag != null &&
                  track.clips.some((c) => c.id === clipDrag.clipId)
                    ? 'z-40'
                    : ''
                }`}
              >
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
                    dragOffsetY={
                      clipDrag?.clipId === clip.id ? clipDrag.offsetY : 0
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
                {/* The magnetic insertion caret lives INSIDE its lane (lanes
                    stack now — a full-height line would cross unrelated ones). */}
                {dropTarget?.kind === 'main' &&
                  dropTarget.trackId === track.id && (
                    <div
                      className="pointer-events-none absolute -inset-y-1 z-20 w-[3px] -translate-x-1/2 rounded-full bg-select shadow-[0_0_6px_rgba(0,0,0,0.5)]"
                      style={{ left: `${dropTarget.caretX.toFixed(2)}px` }}
                    />
                  )}
                {/* The free-lane landing window: where the drop will actually
                    put the clip, clamps included — honest feedback when the
                    ghost under the finger sits over an illegal spot. */}
                {dropTarget?.kind === 'lane' &&
                  dropTarget.trackId === track.id && (
                    <div
                      className="pointer-events-none absolute inset-y-0 z-20 rounded-[9px] border-2 border-select/80 bg-select/10"
                      style={{
                        left: `${(TRACK_PAD + dropTarget.start * TIMELINE_PX_PER_SEC).toFixed(2)}px`,
                        width: `${(dropTarget.duration * TIMELINE_PX_PER_SEC).toFixed(2)}px`,
                      }}
                    />
                  )}
                {/* Hover-only "add transition" placeholder at each interior seam
                    of the packed video track. Visual only — not implemented. */}
                {track.type === 'video' &&
                  track.clips.slice(1).map((clip, i) => (
                    <div
                      key={`seam-${clip.id}`}
                      // Hover band centered on the seam. z-20 sits above idle
                      // clips (z-0) but below a selected clip's trim bars and a
                      // dragged clip (both z-30), so it never blocks trimming or
                      // an in-progress drag. Hidden on touch: it is a hover-only,
                      // non-functional affordance, and on a phone it would only
                      // clutter the lane and absorb pointerdowns near the seam.
                      className="group absolute inset-y-0 z-20 flex w-4 -translate-x-1/2 items-center justify-center [@media(pointer:coarse)]:hidden"
                      style={{
                        left: `${boundaryX(track.clips, i + 1).toFixed(2)}px`,
                      }}
                    >
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label="Add transition"
                        // pointer-events-none: purely visual for now (do NOT
                        // implement) — the band catches the hover; the button
                        // never intercepts a click. Revealed on group-hover.
                        className="pointer-events-none flex h-5 w-5 items-center justify-center rounded-[5px] border border-edge bg-surface text-ink opacity-0 shadow-md transition group-hover:opacity-100"
                      >
                        <Blend className="h-3 w-3" />
                      </button>
                    </div>
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

          {/* The playhead LINE spans every lane and scrolls with them, which is
              correct — it marks the same instant on each. The KNOB lives in the
              sticky ruler above (see the ruler block), so it stays grabbable no
              matter how far the lanes are scrolled. */}
          <div
            className="pointer-events-none absolute inset-y-0 z-10"
            style={{ left: `${playheadX.toFixed(2)}px` }}
          >
            {/* An ink core in a `--surface` casing: both tokens invert, so the
                line is black-on-white in light and white-on-dark in dark, and
                the halo keeps it legible over a filmstrip of any brightness in
                either theme. Raw `var(--surface)` — `@theme inline` doesn't emit
                the `--color-*` custom properties at runtime. */}
            <div className="absolute inset-y-0 left-1/2 top-1 w-[2px] -translate-x-1/2 rounded-full bg-ink shadow-[0_0_0_1px_var(--surface),0_0_4px_var(--surface)]" />
          </div>

          {/* The seam indicator: a horizontal bar in the gap where the drop
              will grow a NEW lane. scrubRef-relative, so it scrolls with the
              lanes it sits between. */}
          {dropTarget?.kind === 'seam' && (
            <div
              className="pointer-events-none absolute z-20 h-[3px] -translate-y-1/2 rounded-full bg-select shadow-[0_0_6px_rgba(0,0,0,0.5)]"
              style={{
                top: `${dropTarget.seamY.toFixed(2)}px`,
                left: `${TRACK_PAD.toString()}px`,
                width: `${rulerWidth.toString()}px`,
              }}
            />
          )}
          {/* Empty timeline: no lane exists to host the caret, so a bin drag
              shows the old full-height one. */}
          {!hasClips && dropTarget?.kind === 'main' && (
            <div
              className="pointer-events-none absolute bottom-2 top-7 z-20 w-[3px] -translate-x-1/2 rounded-full bg-select shadow-[0_0_6px_rgba(0,0,0,0.5)]"
              style={{ left: `${dropTarget.caretX.toFixed(2)}px` }}
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
          {/* Deliberately NOT in the shared `tools` array: at lg+ the inspector
              column is already on screen, so this button would be a no-op there. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setPanel('inspector')
            }}
            aria-label="Edit properties"
            className="h-9 w-9 rounded-full"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </div>
      )}
    </footer>
  )
}
