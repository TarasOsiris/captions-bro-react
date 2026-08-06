import { useEffect, useRef, useState } from 'react'
import { RotateCw, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEditorStore } from '@/store/editorStore'
import { clipVisibleAt, resolveScene } from '@/lib/model/scene'
import { clipById, projectDuration } from '@/lib/model/selectors'
import { isPrimaryPointer, releaseCapture } from '@/lib/pointer'
import { clipNaturalSize } from '@/lib/render/textSource'
import { CanvasTextEditor } from '@/components/editor/CanvasTextEditor'
import { MediaSources } from '@/components/editor/MediaSources'
import { useElementSize } from '@/hooks/useElementSize'
import { usePreviewCompositor } from '@/hooks/usePreviewCompositor'
import { withTextDefaults } from '@/lib/model/text'
import {
  CANVAS_ASPECT,
  anchorRectAt,
  applyCrop,
  applyMove,
  applyRotation,
  applyScale,
  cropValueForDrag,
  hitTestRect,
  NO_GUIDES,
  SNAP_PX,
  placeRect,
  rectPoint,
  snapMove,
  visibleRect,
  wrapWidthForDrag,
} from '@/lib/transform'
import type { CropInsets, RectAnchor, SnapGuides } from '@/lib/transform'
import type { MediaPool } from '@/lib/render/mediaPool'
import type { Clip, TextStyle, Transform } from '@/lib/model/types'
import { clamp as clampNumber } from '@/lib/math'

/** Font-size bounds as a fraction of canvas height (≈22px…432px at 1080p). */
const MIN_FONT_SIZE = 0.02
const MAX_FONT_SIZE = 0.4
/** Wrap-width bounds as a fraction of canvas width. */
const MIN_BOX_WIDTH = 0.05
const MAX_BOX_WIDTH = 1

/** One canvas alignment guide — the shared look stated once, only the axis
 *  geometry differing. */
function GuideLine({ axis, frac }: { axis: 'x' | 'y'; frac: number }) {
  const pct = `${(frac * 100).toFixed(4)}%`
  return (
    <div
      className={`pointer-events-none absolute z-20 rounded-full bg-select shadow-[0_0_6px_rgba(0,0,0,0.5)] ${
        axis === 'x'
          ? 'inset-y-0 w-[2px] -translate-x-1/2'
          : 'inset-x-0 h-[2px] -translate-y-1/2'
      }`}
      style={axis === 'x' ? { left: pct } : { top: pct }}
    />
  )
}

interface PreviewStageProps {
  poolRef: React.RefObject<MediaPool>
  dropDisabled: boolean
  onDropFile: (file: File) => void
  onPickFile: () => void
}

/**
 * Handle positions as fractions of the media box. The 4 corners scale (uniform
 * zoom); the 4 edge midpoints TRIM that edge (crop, not scale) — `edge` names the
 * inset each one drives.
 */
interface HandleDef {
  x: number
  y: number
  cursor: string
  /** 'corner' = resize (media zooms, text grows its type — see the `corner`
   *  gesture) · 'crop' = trim that edge (media) · 'wrap' = wrap width (text). */
  role: 'corner' | 'crop' | 'wrap'
  edge?: keyof CropInsets
  side?: 'left' | 'right'
}

const CORNER_HANDLES: HandleDef[] = [
  { x: 0, y: 0, cursor: 'nwse-resize', role: 'corner' },
  { x: 1, y: 0, cursor: 'nesw-resize', role: 'corner' },
  { x: 1, y: 1, cursor: 'nwse-resize', role: 'corner' },
  { x: 0, y: 1, cursor: 'nesw-resize', role: 'corner' },
]

const MEDIA_HANDLES: HandleDef[] = [
  // Edges FIRST, corners last: their expanded hit areas overlap once the media
  // box is narrow, and paint order decides the winner. Resize (corners) is the
  // more commonly wanted gesture, so it must be on top.
  { x: 0.5, y: 0, cursor: 'ns-resize', role: 'crop', edge: 'top' },
  { x: 1, y: 0.5, cursor: 'ew-resize', role: 'crop', edge: 'right' },
  { x: 0.5, y: 1, cursor: 'ns-resize', role: 'crop', edge: 'bottom' },
  { x: 0, y: 0.5, cursor: 'ew-resize', role: 'crop', edge: 'left' },
  ...CORNER_HANDLES,
]

/**
 * Text has no croppable source and no honest vertical resize — its box height is
 * content-driven — so the top/bottom midpoints are dropped entirely. The side
 * midpoints set the WRAP WIDTH instead; the corners are the same handles as
 * media's, and the `corner` gesture is what routes their drag into `fontSize`
 * rather than `transform.scale`.
 */
const TEXT_HANDLES: HandleDef[] = [
  { x: 0, y: 0.5, cursor: 'ew-resize', role: 'wrap', side: 'left' },
  { x: 1, y: 0.5, cursor: 'ew-resize', role: 'wrap', side: 'right' },
  ...CORNER_HANDLES,
]

/** Pointer→anchor distance, converting the pointer into the frame-local space
 *  the anchor is stored in. The ratio of two of these IS the resize factor. */
function anchorDist(
  e: React.PointerEvent,
  fr: DOMRect,
  anchor: { x: number; y: number },
): number {
  return Math.hypot(
    e.clientX - fr.left - anchor.x,
    e.clientY - fr.top - anchor.y,
  )
}

/** Fields every gesture carries. `pointerId` makes the gesture exclusive to the
 *  pointer that started it, so a second finger can neither drive nor end it. */
interface GestureBase {
  pointerId: number
  /** The clip being transformed. */
  clipId: string
  /** Its transform at gesture start, so repeated moves never drift. */
  start: Transform
}

/** In-flight pointer gesture. */
type Gesture =
  | (GestureBase & {
      kind: 'move'
      startX: number
      startY: number
      /** Natural size in frame px, measured once at gesture start — a move
       *  writes only the transform, which the natural size does not depend on. */
      size: { w: number; h: number }
    })
  /**
   * A corner drag: resize while holding the corner OPPOSITE the grabbed one
   * still, the way every other editor does. The center is not a fixed point of
   * this gesture, so it can't be the reference — both the factor and the
   * re-placement are measured against `anchor` instead.
   *
   * ONE gesture for media and text. What differs is only which field absorbs the
   * factor: `transform.scale`, or `fontSize` when `startFontSize` is set (text
   * keeps `scale` at 1 so the inspector's Size field stays the one authority).
   */
  | (GestureBase & {
      kind: 'corner'
      /** The pinned corner, in FRAME-local px — not client, so a scroll
       *  mid-gesture can't shift it — plus where it sits on the box. */
      anchor: RectAnchor
      /** Pointer→anchor distance at gesture start (the box diagonal). */
      startDist: number
      /** Text only; null routes the drag into `transform.scale` instead. */
      startFontSize: number | null
    })
  | (GestureBase & {
      kind: 'rotate'
      centerX: number
      centerY: number
      startAngle: number
    })
  | (GestureBase & {
      kind: 'crop'
      edge: keyof CropInsets
      startX: number
      startY: number
      /** Full media rect dimensions (px) at gesture start, to scale the drag. */
      mediaW: number
      mediaH: number
      /** Media rotation (deg) — the drag is projected onto its local axes. */
      rotationDeg: number
    })
  // Text-only. Projects the drag onto the block's local x axis, like 'crop'.
  | (GestureBase & {
      kind: 'wrap'
      side: 'left' | 'right'
      startX: number
      startY: number
      rotationDeg: number
      frameW: number
      startBoxWidth: number
    })

export function PreviewStage({
  poolRef,
  dropDisabled,
  onDropFile,
  onPickFile,
}: PreviewStageProps) {
  const project = useEditorStore((s) => s.project)
  const selectedClipId = useEditorStore((s) => s.selectedClipId)
  const playing = useEditorStore((s) => s.playing)
  const selectClip = useEditorStore((s) => s.selectClip)
  const setClipTransform = useEditorStore((s) => s.setClipTransform)
  // Whether the selected clip is composited at the playhead — the compositor's
  // own liveness rule, so the chrome can never sit over a frame the clip isn't
  // drawn on (seek away via the knob or arrow keys and the box must go). A
  // boolean selector, so seeks only re-render when liveness actually flips.
  const selectedLive = useEditorStore((s) => {
    const clip = clipById(s.project, s.selectedClipId)
    if (!clip) return false
    return clipVisibleAt(clip, s.currentTime, projectDuration(s.project))
  })

  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)
  // Chrome, and React-local: routing the guides through the store would bump
  // the document revision and pollute undo on every move.
  const [guides, setGuides] = useState<SnapGuides>(NO_GUIDES)
  // Equality-guarded, so a move that doesn't change the engaged set costs no
  // extra render on top of the one the transform write already forces.
  const updateGuides = (next: SnapGuides) => {
    setGuides((prev) => (prev.x === next.x && prev.y === next.y ? prev : next))
  }

  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  // Feeds the DOM chrome only; the gestures below read the frame's live rect,
  // which can't be one render stale mid-drag.
  const frameSize = useElementSize(frameRef)
  const [editingClipId, setEditingClipId] = useState<string | null>(null)
  // Double-tap detection, done by hand rather than via `e.detail`, which is
  // unreliable on touch. Works identically for mouse and finger.
  const lastTapRef = useRef<{
    clipId: string
    t: number
    x: number
    y: number
  } | null>(null)

  const hasClips = project.tracks.some((t) => t.clips.length > 0)
  const selectedClip = clipById(project, selectedClipId)
  // The natural size (contain-fit box for media, laid-out block for text) in the
  // FRAME's CSS pixels — the same fractions the canvas resolves against, so the
  // DOM chrome lands exactly on the drawn pixels.
  const selectedSize = clipNaturalSize(
    project,
    selectedClip,
    frameSize.w,
    frameSize.h,
  )
  const isText = selectedClip?.type === 'text'

  // Seeking away from the clip being edited ends the editing session (the
  // textarea would otherwise float over a frame its clip isn't drawn on —
  // blur alone doesn't cover seeks whose pointerdown prevents default).
  useEffect(() => {
    if (editingClipId != null && !selectedLive) setEditingClipId(null)
  }, [editingClipId, selectedLive])

  // The preview render loop — the SAME drawScene the export uses, over the
  // pool. Mounts once and reads the document via getState(), so it neither
  // depends on nor triggers a React render.
  usePreviewCompositor(canvasRef, poolRef)

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    if (dropDisabled) return
    dragDepth.current += 1
    setDragOver(true)
  }
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragOver(false)
    if (dropDisabled) return
    const files = e.dataTransfer.files
    if (files.length > 0) onDropFile(files[0])
  }

  // Selection-chrome geometry for the selected clip (paused only) — the VISIBLE
  // box, so the handles sit on the trimmed edges. Text never sets crop, so the
  // crop step is the identity for it.
  const rect =
    selectedClip && selectedSize && frameSize.w > 0
      ? visibleRect(
          selectedClip.transform,
          selectedSize.w,
          selectedSize.h,
          frameSize.w,
          frameSize.h,
        )
      : null

  /** A clip's natural size measured against the LIVE frame rect — gestures read
   *  the frame directly rather than the debounced `frameSize` state. */
  const naturalSizeFor = (clip: Clip, frameW: number, frameH: number) =>
    clipNaturalSize(useEditorStore.getState().project, clip, frameW, frameH)

  const centerClient = (
    transform: Transform,
    size: { w: number; h: number },
  ) => {
    const el = frameRef.current
    if (!el) return null
    const fr = el.getBoundingClientRect()
    const r = placeRect(transform, size.w, size.h, fr.width, fr.height)
    return { x: fr.left + r.cx, y: fr.top + r.cy }
  }

  const hitTestClip = (
    transform: Transform,
    size: { w: number; h: number },
    clientX: number,
    clientY: number,
  ): boolean => {
    const el = frameRef.current
    if (!el) return false
    const fr = el.getBoundingClientRect()
    // Hit-test the visible (cropped) box, so trimmed-away regions aren't grabbable.
    const r = visibleRect(transform, size.w, size.h, fr.width, fr.height)
    return hitTestRect(r, clientX - fr.left - r.cx, clientY - fr.top - r.cy)
  }

  // A captured pointer is treated as being over the capture target (the frame),
  // so its own cursor wins during a gesture — pin it here, clear it on end, and
  // the resize/grab cursor no longer flickers to the arrow over the canvas.
  const startGesture = (
    el: HTMLDivElement,
    e: React.PointerEvent,
    cursor: string,
  ) => {
    el.style.cursor = cursor
    el.setPointerCapture(e.pointerId)
  }

  /** Gestures are exclusive. A second pointer landing mid-gesture must be
   *  ignored outright — otherwise it overwrites `gestureRef` and pushes a
   *  second undo snapshot for what the user experiences as one edit. */
  const canBeginGesture = (e: React.PointerEvent) =>
    isPrimaryPointer(e) && gestureRef.current == null

  /** Live text-style write during a canvas gesture. The undo snapshot was
   *  already taken at gesture start, so this must never take another. */
  const patchTextStyle = (clipId: string, patch: Partial<TextStyle>) => {
    const st = useEditorStore.getState()
    const clip = clipById(st.project, clipId)
    if (!clip) return
    st.updateClip(clipId, {
      textStyle: { ...withTextDefaults(clip.textStyle), ...patch },
    })
  }

  /** Corner drag. The anchor is the corner OPPOSITE `h`, measured off the live
   *  frame: where it sits now (frame-local px) and which fraction of the box
   *  that is, so the move handler can put it back after every resize. */
  const beginCorner = (e: React.PointerEvent, h: HandleDef) => {
    e.stopPropagation()
    if (!canBeginGesture(e)) return
    const el = frameRef.current
    if (!el || !selectedClip) return
    const fr = el.getBoundingClientRect()
    const size = naturalSizeFor(selectedClip, fr.width, fr.height)
    if (!size) return
    const fx = 1 - h.x
    const fy = 1 - h.y
    const p = rectPoint(
      visibleRect(selectedClip.transform, size.w, size.h, fr.width, fr.height),
      fx,
      fy,
    )
    const anchor = { fx, fy, ...p }
    const startDist = anchorDist(e, fr, anchor)
    if (startDist <= 0) return
    useEditorStore.getState().beginEdit()
    gestureRef.current = {
      kind: 'corner',
      pointerId: e.pointerId,
      clipId: selectedClip.id,
      anchor,
      startDist,
      startFontSize:
        selectedClip.type === 'text'
          ? withTextDefaults(selectedClip.textStyle).fontSize
          : null,
      start: selectedClip.transform,
    }
    startGesture(el, e, h.cursor)
  }

  /** Side-midpoint drag on a TEXT clip: sets the wrap width. */
  const beginWrap = (
    e: React.PointerEvent,
    side: 'left' | 'right',
    cursor: string,
  ) => {
    e.stopPropagation()
    if (!canBeginGesture(e)) return
    const el = frameRef.current
    if (!el || !selectedClip || !selectedSize) return
    const fr = el.getBoundingClientRect()
    if (fr.width <= 0) return
    useEditorStore.getState().beginEdit()
    gestureRef.current = {
      kind: 'wrap',
      pointerId: e.pointerId,
      clipId: selectedClip.id,
      side,
      startX: e.clientX,
      startY: e.clientY,
      rotationDeg: selectedClip.transform.rotationDeg,
      frameW: fr.width,
      startBoxWidth: withTextDefaults(selectedClip.textStyle).boxWidth,
      start: selectedClip.transform,
    }
    startGesture(el, e, cursor)
  }

  const beginCrop = (
    e: React.PointerEvent,
    edge: keyof CropInsets,
    cursor: string,
  ) => {
    e.stopPropagation()
    if (!canBeginGesture(e)) return
    const el = frameRef.current
    if (!el || !selectedClip || !selectedSize) return
    const fr = el.getBoundingClientRect()
    const r = placeRect(
      selectedClip.transform,
      selectedSize.w,
      selectedSize.h,
      fr.width,
      fr.height,
    )
    if (r.w <= 0 || r.h <= 0) return
    useEditorStore.getState().beginEdit()
    gestureRef.current = {
      kind: 'crop',
      pointerId: e.pointerId,
      clipId: selectedClip.id,
      edge,
      startX: e.clientX,
      startY: e.clientY,
      mediaW: r.w,
      mediaH: r.h,
      rotationDeg: r.rotationDeg,
      start: selectedClip.transform,
    }
    startGesture(el, e, cursor)
  }

  const beginRotate = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (!canBeginGesture(e)) return
    const el = frameRef.current
    if (!el || !selectedClip || !selectedSize) return
    const center = centerClient(selectedClip.transform, selectedSize)
    if (!center) return
    useEditorStore.getState().beginEdit()
    gestureRef.current = {
      kind: 'rotate',
      pointerId: e.pointerId,
      clipId: selectedClip.id,
      centerX: center.x,
      centerY: center.y,
      startAngle: Math.atan2(e.clientY - center.y, e.clientX - center.x),
      start: selectedClip.transform,
    }
    startGesture(el, e, 'grabbing')
  }

  const onFramePointerDown = (e: React.PointerEvent) => {
    if (!hasClips) return
    e.stopPropagation()
    if (!canBeginGesture(e)) return
    const el = frameRef.current
    if (!el) return
    // Hit-test the clips live at the playhead, topmost first. Because the
    // overlay track is appended last, text is tested before the video under it.
    const st = useEditorStore.getState()
    const fr = el.getBoundingClientRect()
    const live = resolveScene(st.project, st.currentTime)
    for (let i = live.length - 1; i >= 0; i--) {
      const clip = live[i].clip
      const size = naturalSizeFor(clip, fr.width, fr.height)
      if (!size) continue
      if (hitTestClip(clip.transform, size, e.clientX, e.clientY)) {
        // A second press on the same text clip, close in time and space, opens
        // the inline editor instead of starting a drag — so no gesture begins
        // and no undo snapshot is taken for what is really just a focus.
        const last = lastTapRef.current
        const now = e.timeStamp
        if (
          clip.type === 'text' &&
          last &&
          last.clipId === clip.id &&
          now - last.t < 300 &&
          Math.hypot(e.clientX - last.x, e.clientY - last.y) < 12
        ) {
          // Stop the browser's default focus handling for THIS press. The
          // editor is mounted and focused from inside this handler, and without
          // preventDefault the press's own default action then moves focus back
          // to the frame — blurring the textarea, which closes it again the
          // instant it opens.
          e.preventDefault()
          lastTapRef.current = null
          selectClip(clip.id)
          setEditingClipId(clip.id)
          return
        }
        lastTapRef.current = {
          clipId: clip.id,
          t: now,
          x: e.clientX,
          y: e.clientY,
        }

        selectClip(clip.id)
        useEditorStore.getState().beginEdit()
        gestureRef.current = {
          kind: 'move',
          pointerId: e.pointerId,
          clipId: clip.id,
          startX: e.clientX,
          startY: e.clientY,
          start: clip.transform,
          size,
        }
        startGesture(el, e, 'grabbing')
        return
      }
    }
    lastTapRef.current = null
    setEditingClipId(null)
    selectClip(null)
  }

  const onFramePointerMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    const el = frameRef.current
    if (!g || !el || g.pointerId !== e.pointerId) return
    if (g.kind === 'move') {
      const fr = el.getBoundingClientRect()
      const moved = applyMove(
        g.start,
        (e.clientX - g.startX) / fr.width,
        (e.clientY - g.startY) / fr.height,
      )
      // Recomputed from `g.start` every move, so dragging on past a snap line
      // releases it — no modifier-key escape hatch needed.
      const snap = snapMove(
        moved,
        g.size.w,
        g.size.h,
        fr.width,
        fr.height,
        SNAP_PX,
      )
      setClipTransform(g.clipId, snap.transform)
      updateGuides(snap.guides)
    } else if (g.kind === 'corner') {
      const fr = el.getBoundingClientRect()
      const clip = clipById(useEditorStore.getState().project, g.clipId)
      if (!clip) return
      const factor = anchorDist(e, fr, g.anchor) / g.startDist
      // Media zooms; text grows its type instead. Every text metric is
      // em-relative, so scaling the font scales the whole block identically —
      // but expressed in the one number the inspector also edits.
      const resized: Partial<Clip> =
        g.startFontSize == null
          ? { transform: applyScale(g.start, factor) }
          : {
              textStyle: {
                ...withTextDefaults(clip.textStyle),
                fontSize: clampNumber(
                  g.startFontSize * factor,
                  MIN_FONT_SIZE,
                  MAX_FONT_SIZE,
                ),
              },
            }
      // Measure the RESIZED clip before re-pinning. Text re-wraps at a new font
      // size, so its box height is not a multiple of the old one — and neither
      // clamp (scale or font size) may have granted the whole factor.
      const size = naturalSizeFor({ ...clip, ...resized }, fr.width, fr.height)
      if (!size) return
      // Resize and re-placement land as ONE store write — two would let the
      // compositor's rAF fall between them and draw a frame at the new size in
      // the old position, which reads as a jitter along the drag.
      useEditorStore.getState().updateClip(g.clipId, {
        ...resized,
        transform: anchorRectAt(
          resized.transform ?? g.start,
          size.w,
          size.h,
          fr.width,
          fr.height,
          g.anchor,
        ),
      })
    } else if (g.kind === 'wrap') {
      patchTextStyle(g.clipId, {
        boxWidth: wrapWidthForDrag(
          g.startBoxWidth,
          g.side,
          e.clientX - g.startX,
          e.clientY - g.startY,
          g.rotationDeg,
          g.frameW,
          { min: MIN_BOX_WIDTH, max: MAX_BOX_WIDTH },
        ),
      })
    } else if (g.kind === 'crop') {
      const value = cropValueForDrag(
        g.start,
        g.edge,
        e.clientX - g.startX,
        e.clientY - g.startY,
        g.rotationDeg,
        g.mediaW,
        g.mediaH,
      )
      setClipTransform(g.clipId, applyCrop(g.start, g.edge, value))
    } else {
      const angle = Math.atan2(e.clientY - g.centerY, e.clientX - g.centerX)
      const deltaDeg = ((angle - g.startAngle) * 180) / Math.PI
      setClipTransform(
        g.clipId,
        applyRotation(g.start, g.start.rotationDeg + deltaDeg),
      )
    }
  }

  const endGesture = (e: React.PointerEvent) => {
    // Only the pointer that started the gesture may end it — otherwise a second
    // finger lifting anywhere on the frame kills an in-flight drag.
    const g = gestureRef.current
    if (!g || g.pointerId !== e.pointerId) return
    gestureRef.current = null
    updateGuides(NO_GUIDES) // covers pointerup AND pointercancel
    const el = frameRef.current
    if (!el) return
    el.style.cursor = '' // hand the cursor back to the handles/canvas
    releaseCapture(el, e.pointerId)
  }

  // Handles are hidden while editing text, so they can't sit under the caret —
  // and while the clip isn't live at the playhead, so they can't sit over a
  // frame it isn't drawn on.
  const showChrome =
    selectedClip != null &&
    selectedLive &&
    !playing &&
    editingClipId !== selectedClip.id

  return (
    <section
      onDragEnter={onDragEnter}
      onDragOver={(e) => {
        e.preventDefault()
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPointerDown={() => {
        selectClip(null)
      }}
      className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-stage bg-[radial-gradient(70rem_45rem_at_50%_-15%,rgba(168,137,255,0.05),transparent)] p-2 [container-type:size] sm:p-3 lg:p-5"
    >
      <div
        ref={frameRef}
        onPointerDown={onFramePointerDown}
        onPointerMove={onFramePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        // Always the largest CANVAS_ASPECT box that fits the stage (contain),
        // sized from the container's own dimensions so BOTH axes stay locked to
        // the ratio. A single-axis fit (h-full + max-w-full) lets max-width
        // clamp the width while height stays full, silently squishing the frame
        // — and with it everything drawn onto the canvas. Never regress this to
        // a one-axis fit.
        //
        // An inline style, not a class: Tailwind can't interpolate a TS
        // constant into an arbitrary value, and a hardcoded 56.25/177.778 pair
        // is exactly the kind of duplicated magic number that drifts from the
        // constant it mirrors (see the `19rem` note in CLAUDE.md).
        style={{
          height: `min(100cqh, ${(100 / CANVAS_ASPECT).toString()}cqw)`,
          width: `min(100cqw, ${(100 * CANVAS_ASPECT).toString()}cqh)`,
        }}
        className="relative touch-none"
      >
        <div className="absolute inset-0 overflow-hidden rounded-[3px] bg-black shadow-[0_0_0_1px_rgba(255,255,255,1),0_40px_120px_-30px_rgba(0,0,0,0.9)]">
          {/* Hidden decode/audio sources, behind the opaque canvas. Memoized
              (see MediaSources) so a transform gesture — which re-renders this
              component at pointer rate — can't churn the media elements. */}
          <MediaSources project={project} poolRef={poolRef} />

          {/* The composited output — the same drawScene as the export. */}
          <canvas
            ref={canvasRef}
            className={`absolute inset-0 h-full w-full ${
              hasClips ? 'cursor-pointer' : ''
            }`}
          />

          {!hasClips && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <Upload className="h-7 w-7 text-muted/40" />
              <div>
                <p className="text-sm text-muted/70">Drop a video or image</p>
                <Button onClick={onPickFile} className="mt-2">
                  Import media
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Canvas alignment guides, shown only while a move gesture has one
            engaged. %-positioned, so the one-render-stale frameSize can't
            misplace them; independent of showChrome, since they exist only
            mid-gesture. Chrome, never composited — so never exported. */}
        {guides.x != null && <GuideLine axis="x" frac={guides.x} />}
        {guides.y != null && <GuideLine axis="y" frac={guides.y} />}

        {/* Selection chrome for the selected clip (paused only), positioned by the
            same mediaRect the compositor draws with — never composited/exported. */}
        {showChrome && rect && (
          <div
            className="pointer-events-none absolute z-20"
            style={{
              left: `${(rect.cx - rect.w / 2).toFixed(2)}px`,
              top: `${(rect.cy - rect.h / 2).toFixed(2)}px`,
              width: `${rect.w.toFixed(2)}px`,
              height: `${rect.h.toFixed(2)}px`,
              transform: `rotate(${rect.rotationDeg.toString()}deg)`,
              transformOrigin: 'center',
            }}
          >
            <div className="absolute inset-0 border-2 border-select" />
            {(isText ? TEXT_HANDLES : MEDIA_HANDLES).map((h) => {
              // Corner roles (scale/fontScale) → round dot; edge roles
              // (crop/wrap) → a small bar lying along that edge.
              const shape =
                h.role === 'corner'
                  ? 'h-3.5 w-3.5 rounded-full'
                  : h.edge === 'top' || h.edge === 'bottom'
                    ? 'h-1.5 w-3 rounded-[2px]'
                    : 'h-3 w-1.5 rounded-[2px]'
              return (
                <span
                  key={`${h.role}-${h.x.toString()}-${h.y.toString()}`}
                  onPointerDown={(e) => {
                    if (h.role === 'crop' && h.edge)
                      beginCrop(e, h.edge, h.cursor)
                    else if (h.role === 'wrap' && h.side)
                      beginWrap(e, h.side, h.cursor)
                    else beginCorner(e, h)
                  }}
                  style={{
                    left: `${(h.x * 100).toString()}%`,
                    top: `${(h.y * 100).toString()}%`,
                    cursor: h.cursor,
                  }}
                  // The handle stays visually tiny — it marks an exact geometric
                  // edge, so growing it would move where the user reads that
                  // edge to be. A transparent ::after lifts the hit area to
                  // ~38×38 (corners) / ~30×36 (crop bars) instead.
                  className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 border border-black/10 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.5)] after:absolute after:-inset-3 after:content-[''] ${shape}`}
                />
              )
            })}
            <button
              type="button"
              onPointerDown={beginRotate}
              aria-label="Rotate"
              // Normally 22px BELOW the media box, but flip inside when there
              // isn't room — the stage is `overflow-hidden`, so otherwise the
              // button is clipped away entirely whenever the media fills the
              // frame height (common on a phone in landscape, and on any short
              // desktop window).
              style={{
                left: '50%',
                top:
                  rect.cy + rect.h / 2 + 44 <= frameSize.h
                    ? 'calc(100% + 22px)'
                    : 'calc(100% - 22px)',
              }}
              className="pointer-events-auto absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full bg-white text-black/70 shadow-[0_1px_4px_rgba(0,0,0,0.5)] after:absolute after:-inset-2 after:content-[''] active:cursor-grabbing"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Inline text editing. Positioned by the SAME rect as the chrome, with
            transparent glyphs over the canvas-drawn text — so the thing being
            edited is the thing that exports. */}
        {editingClipId && rect && !playing && selectedLive && (
          <CanvasTextEditor
            clipId={editingClipId}
            rect={rect}
            frameH={frameSize.h}
            onClose={() => {
              setEditingClipId(null)
            }}
          />
        )}
      </div>

      {dragOver && (
        <div className="pointer-events-none absolute inset-4 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent/10">
          <span className="rounded-md bg-bg/85 px-3 py-1.5 text-sm text-ink">
            {hasClips ? 'Drop to add' : 'Drop to import'}
          </span>
        </div>
      )}
    </section>
  )
}
