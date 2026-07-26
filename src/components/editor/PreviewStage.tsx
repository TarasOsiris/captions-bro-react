import { useEffect, useRef, useState } from 'react'
import { RotateCw, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEditorStore } from '@/store/editorStore'
import { resolveScene } from '@/lib/model/scene'
import { allClips, assetOf, clipById } from '@/lib/model/selectors'
import { isPrimaryPointer, releaseCapture } from '@/lib/pointer'
import { drawScene } from '@/lib/render/compositor'
import { clipNaturalSize, textSourceForClip } from '@/lib/render/textSource'
import { CanvasTextEditor } from '@/components/editor/CanvasTextEditor'
import { withTextDefaults } from '@/lib/model/text'
import {
  anchorRectAt,
  applyCrop,
  applyMove,
  applyRotation,
  applyScale,
  cropInsets,
  croppedRect,
  placeRect,
  rectPoint,
} from '@/lib/transform'
import type { CropInsets } from '@/lib/transform'
import type { DrawItem, RenderSource } from '@/lib/render/compositor'
import type { MediaPool } from '@/lib/render/mediaPool'
import type { Clip, MediaAsset, TextStyle, Transform } from '@/lib/model/types'
import { clamp as clampNumber } from '@/lib/math'

/** Font-size bounds as a fraction of canvas height (≈22px…432px at 1080p). */
const MIN_FONT_SIZE = 0.02
const MAX_FONT_SIZE = 0.4
/** Wrap-width bounds as a fraction of canvas width. */
const MIN_BOX_WIDTH = 0.05
const MAX_BOX_WIDTH = 1

interface PreviewStageProps {
  poolRef: React.RefObject<MediaPool>
  dropDisabled: boolean
  /** Fired once at the start of a move/resize/rotate gesture (for undo snapshots). */
  onEditStart: () => void
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
  /** 'scale' = uniform zoom (media) · 'fontScale' = type size (text) ·
   *  'crop' = trim that edge (media) · 'wrap' = wrap width (text). */
  role: 'scale' | 'fontScale' | 'crop' | 'wrap'
  edge?: keyof CropInsets
  side?: 'left' | 'right'
}

const MEDIA_HANDLES: HandleDef[] = [
  // Edges FIRST, corners last: their expanded hit areas overlap once the media
  // box is narrow, and paint order decides the winner. Scale (corners) is the
  // more commonly wanted gesture, so it must be on top.
  { x: 0.5, y: 0, cursor: 'ns-resize', role: 'crop', edge: 'top' },
  { x: 1, y: 0.5, cursor: 'ew-resize', role: 'crop', edge: 'right' },
  { x: 0.5, y: 1, cursor: 'ns-resize', role: 'crop', edge: 'bottom' },
  { x: 0, y: 0.5, cursor: 'ew-resize', role: 'crop', edge: 'left' },
  { x: 0, y: 0, cursor: 'nwse-resize', role: 'scale' },
  { x: 1, y: 0, cursor: 'nesw-resize', role: 'scale' },
  { x: 1, y: 1, cursor: 'nwse-resize', role: 'scale' },
  { x: 0, y: 1, cursor: 'nesw-resize', role: 'scale' },
]

/**
 * Text has no croppable source and no honest vertical resize — its box height is
 * content-driven — so the top/bottom midpoints are dropped entirely. The side
 * midpoints set the WRAP WIDTH instead, and the corners scale the type rather
 * than `transform.scale`, so the inspector's Size field stays the single
 * authority for how big the text is.
 */
const TEXT_HANDLES: HandleDef[] = [
  { x: 0, y: 0.5, cursor: 'ew-resize', role: 'wrap', side: 'left' },
  { x: 1, y: 0.5, cursor: 'ew-resize', role: 'wrap', side: 'right' },
  { x: 0, y: 0, cursor: 'nwse-resize', role: 'fontScale' },
  { x: 1, y: 0, cursor: 'nesw-resize', role: 'fontScale' },
  { x: 1, y: 1, cursor: 'nwse-resize', role: 'fontScale' },
  { x: 0, y: 1, cursor: 'nesw-resize', role: 'fontScale' },
]

/**
 * What a corner-drag resize (media 'scale' and text 'fontScale' alike) needs to
 * hold the corner OPPOSITE the grabbed one still, the way every other editor
 * resizes. The center is not a fixed point of the gesture, so it can't be the
 * reference: both the scale factor and the re-placement are measured against the
 * anchor instead.
 */
interface CornerAnchor {
  /** The opposite corner in FRAME-local px — the point that must not move.
   *  Frame-local, not client, so a scroll mid-gesture can't shift it. */
  anchorX: number
  anchorY: number
  /** Its fractional position on the box, to re-pin it after each resize. */
  anchorFx: number
  anchorFy: number
  /** Pointer→anchor distance at gesture start (the box diagonal). */
  startDist: number
}

/** The resize factor a corner drag is currently asking for: how much farther the
 *  pointer is from the pinned corner than it was when the drag began. */
function anchorDrag(
  g: CornerAnchor,
  e: React.PointerEvent,
  fr: DOMRect,
): number {
  return (
    Math.hypot(
      e.clientX - fr.left - g.anchorX,
      e.clientY - fr.top - g.anchorY,
    ) / g.startDist
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
    })
  | (GestureBase & CornerAnchor & { kind: 'scale' })
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
      /** Media rotation (rad) — the drag is projected onto its local axes. */
      rotationRad: number
    })
  // Text-only. Geometrically identical to 'scale', but commits `fontSize`.
  | (GestureBase & CornerAnchor & { kind: 'fontScale'; startFontSize: number })
  // Text-only. Projects the drag onto the block's local x axis, like 'crop'.
  | (GestureBase & {
      kind: 'wrap'
      side: 'left' | 'right'
      startX: number
      startY: number
      rotationRad: number
      frameW: number
      startBoxWidth: number
    })

export function PreviewStage({
  poolRef,
  dropDisabled,
  onEditStart,
  onDropFile,
  onPickFile,
}: PreviewStageProps) {
  const project = useEditorStore((s) => s.project)
  const selectedClipId = useEditorStore((s) => s.selectedClipId)
  const playing = useEditorStore((s) => s.playing)
  const selectClip = useEditorStore((s) => s.selectClip)
  const setClipTransform = useEditorStore((s) => s.setClipTransform)

  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)

  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 })
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

  // Distinct sources to keep mounted: a <video> per video clip, a shared <img>
  // per referenced image asset.
  const videoClips = allClips(project).filter(
    (c) => c.type === 'video' && c.assetId != null,
  )
  const imageAssets = (() => {
    const seen = new Set<string>()
    const out: { id: string; url: string }[] = []
    for (const clip of allClips(project)) {
      if (clip.type !== 'image' || clip.assetId == null) continue
      if (seen.has(clip.assetId)) continue
      const asset = assetOf(project, clip)
      if (asset) {
        seen.add(asset.id)
        out.push({ id: asset.id, url: asset.url })
      }
    }
    return out
  })()

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setFrameSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [])

  // The preview render loop — the SAME drawScene the export uses, over the pool.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'

    const sourceFor = (
      clip: Clip,
      cw: number,
      ch: number,
    ): RenderSource | null => {
      // Text is procedural — no pool entry, never "not ready", and produced by
      // the SAME factory both export paths use, so it cannot drift.
      if (clip.type === 'text') return textSourceForClip(clip, cw, ch)
      if (clip.type === 'video') {
        const v = poolRef.current.videos.get(clip.id)
        if (!v || v.readyState < 2 || v.videoWidth === 0) return null
        return {
          aspect: v.videoWidth / v.videoHeight,
          paint: (c, dx, dy, dw, dh) => {
            c.drawImage(v, dx, dy, dw, dh)
          },
        }
      }
      if (clip.type === 'image' && clip.assetId != null) {
        const img = poolRef.current.images.get(clip.assetId)
        if (!img || !img.complete || img.naturalWidth === 0) return null
        return {
          aspect: img.naturalWidth / img.naturalHeight,
          paint: (c, dx, dy, dw, dh) => {
            c.drawImage(img, dx, dy, dw, dh)
          },
        }
      }
      return null
    }

    let raf = 0
    const render = () => {
      const { project: proj, currentTime } = useEditorStore.getState()
      // Size the backing store to the DISPLAYED pixels (× DPR), not the export
      // resolution — so the preview is crisp at native density on any screen
      // instead of being up/down-scaled from a fixed 1920×1080. Geometry is
      // resolution-independent (mediaRect works off fractions), so the image is
      // identical; only the pixel density differs from the export path.
      const dpr = window.devicePixelRatio || 1
      const cw = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const ch = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== cw) canvas.width = cw
      if (canvas.height !== ch) canvas.height = ch
      const renderCanvas = {
        width: cw,
        height: ch,
        background: proj.canvas.background,
      }
      const items: DrawItem[] = resolveScene(proj, currentTime).map((item) => ({
        transform: item.clip.transform,
        source: sourceFor(item.clip, cw, ch),
      }))
      drawScene(ctx, renderCanvas, items)
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [poolRef])

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

  // Video metadata → learn asset dimensions/duration; set clip duration once.
  const onVideoMeta = (
    clip: Clip,
    e: React.SyntheticEvent<HTMLVideoElement>,
  ) => {
    if (clip.assetId == null) return
    const v = e.currentTarget
    const st = useEditorStore.getState()
    const asset = assetOf(st.project, clip)
    if (!asset) return
    const patch: Partial<MediaAsset> = {}
    if (v.videoWidth > 0 && v.videoHeight > 0) {
      patch.naturalWidth = v.videoWidth
      patch.naturalHeight = v.videoHeight
    }
    const learnDuration =
      asset.durationSec == null && Number.isFinite(v.duration)
    if (Number.isFinite(v.duration)) patch.durationSec = v.duration
    st.updateAsset(asset.id, patch)
    if (learnDuration) st.updateClip(clip.id, { duration: v.duration })
  }

  const onImageMeta = (
    assetId: string,
    e: React.SyntheticEvent<HTMLImageElement>,
  ) => {
    const img = e.currentTarget
    if (img.naturalWidth <= 0 || img.naturalHeight <= 0) return
    useEditorStore.getState().updateAsset(assetId, {
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    })
  }

  // Selection-chrome geometry for the selected clip (paused only) — the VISIBLE
  // (cropped) box, so the handles sit on the trimmed edges. Text never sets
  // crop, so `croppedRect` is the identity for it.
  const rect =
    selectedClip && selectedSize && frameSize.w > 0
      ? croppedRect(
          placeRect(
            selectedClip.transform,
            selectedSize.w,
            selectedSize.h,
            frameSize.w,
            frameSize.h,
          ),
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
    const r = croppedRect(
      placeRect(transform, size.w, size.h, fr.width, fr.height),
    )
    const dx = clientX - fr.left - r.cx
    const dy = clientY - fr.top - r.cy
    const rad = (-r.rotationDeg * Math.PI) / 180
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad)
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad)
    return Math.abs(rx) <= r.w / 2 && Math.abs(ry) <= r.h / 2
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

  /** The corner opposite `h`, measured off the live frame: where it sits now
   *  (frame-local px), which fraction of the box that is, and how far the
   *  pointer starts from it. Shared by both corner gestures. */
  const cornerAnchorFor = (
    h: HandleDef,
    e: React.PointerEvent,
  ): CornerAnchor | null => {
    const el = frameRef.current
    if (!el || !selectedClip) return null
    const fr = el.getBoundingClientRect()
    const size = naturalSizeFor(selectedClip, fr.width, fr.height)
    if (!size) return null
    const fx = 1 - h.x
    const fy = 1 - h.y
    const a = rectPoint(
      croppedRect(
        placeRect(selectedClip.transform, size.w, size.h, fr.width, fr.height),
      ),
      fx,
      fy,
    )
    const startDist = Math.hypot(
      e.clientX - fr.left - a.x,
      e.clientY - fr.top - a.y,
    )
    if (startDist <= 0) return null
    return { anchorX: a.x, anchorY: a.y, anchorFx: fx, anchorFy: fy, startDist }
  }

  const beginScale = (e: React.PointerEvent, h: HandleDef) => {
    e.stopPropagation()
    if (!canBeginGesture(e)) return
    const el = frameRef.current
    if (!el || !selectedClip) return
    const anchor = cornerAnchorFor(h, e)
    if (!anchor) return
    onEditStart()
    gestureRef.current = {
      kind: 'scale',
      pointerId: e.pointerId,
      clipId: selectedClip.id,
      ...anchor,
      start: selectedClip.transform,
    }
    startGesture(el, e, h.cursor)
  }

  /** Corner drag on a TEXT clip. Same anchored geometry as `beginScale`, but it
   *  commits `fontSize` — so `transform.scale` stays 1 and the inspector's Size
   *  field remains the one number that says how big the text is. */
  const beginFontScale = (e: React.PointerEvent, h: HandleDef) => {
    e.stopPropagation()
    if (!canBeginGesture(e)) return
    const el = frameRef.current
    if (!el || !selectedClip) return
    const anchor = cornerAnchorFor(h, e)
    if (!anchor) return
    onEditStart()
    gestureRef.current = {
      kind: 'fontScale',
      pointerId: e.pointerId,
      clipId: selectedClip.id,
      ...anchor,
      startFontSize: withTextDefaults(selectedClip.textStyle).fontSize,
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
    onEditStart()
    gestureRef.current = {
      kind: 'wrap',
      pointerId: e.pointerId,
      clipId: selectedClip.id,
      side,
      startX: e.clientX,
      startY: e.clientY,
      rotationRad: (selectedClip.transform.rotationDeg * Math.PI) / 180,
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
    onEditStart()
    gestureRef.current = {
      kind: 'crop',
      pointerId: e.pointerId,
      clipId: selectedClip.id,
      edge,
      startX: e.clientX,
      startY: e.clientY,
      mediaW: r.w,
      mediaH: r.h,
      rotationRad: (r.rotationDeg * Math.PI) / 180,
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
    onEditStart()
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
        onEditStart()
        gestureRef.current = {
          kind: 'move',
          pointerId: e.pointerId,
          clipId: clip.id,
          startX: e.clientX,
          startY: e.clientY,
          start: clip.transform,
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
      setClipTransform(
        g.clipId,
        applyMove(
          g.start,
          (e.clientX - g.startX) / fr.width,
          (e.clientY - g.startY) / fr.height,
        ),
      )
    } else if (g.kind === 'scale') {
      const fr = el.getBoundingClientRect()
      const clip = clipById(useEditorStore.getState().project, g.clipId)
      const size = clip && naturalSizeFor(clip, fr.width, fr.height)
      if (!size) return
      const scaled = applyScale(g.start, anchorDrag(g, e, fr))
      // Resize about the center, then slide the result back so the opposite
      // corner returns to where it was. `applyScale` may have clamped, and
      // re-pinning after the fact rather than predicting the factor is what
      // keeps the anchor exact when it does.
      setClipTransform(
        g.clipId,
        anchorRectAt(
          scaled,
          size.w,
          size.h,
          fr.width,
          fr.height,
          g.anchorFx,
          g.anchorFy,
          { x: g.anchorX, y: g.anchorY },
        ),
      )
    } else if (g.kind === 'fontScale') {
      const fr = el.getBoundingClientRect()
      const clip = clipById(useEditorStore.getState().project, g.clipId)
      if (!clip) return
      // Every text metric is em-relative, so scaling the font size scales the
      // whole block — the same visual result `transform.scale` would give, but
      // expressed in the one number the inspector also edits.
      const textStyle = {
        ...withTextDefaults(clip.textStyle),
        fontSize: clampNumber(
          g.startFontSize * anchorDrag(g, e, fr),
          MIN_FONT_SIZE,
          MAX_FONT_SIZE,
        ),
      }
      // Lay the block out at the NEW size before re-pinning: a wider font wraps
      // differently, so the box height is not a multiple of the old one.
      const size = naturalSizeFor({ ...clip, textStyle }, fr.width, fr.height)
      if (!size) return
      // Style and placement move as ONE store write — two would let the
      // compositor's rAF land between them and draw a frame at the new size in
      // the old position, which reads as a jitter along the drag.
      useEditorStore.getState().updateClip(g.clipId, {
        textStyle,
        transform: anchorRectAt(
          g.start,
          size.w,
          size.h,
          fr.width,
          fr.height,
          g.anchorFx,
          g.anchorFy,
          { x: g.anchorX, y: g.anchorY },
        ),
      })
    } else if (g.kind === 'wrap') {
      // Project the drag onto the block's local x axis, as `crop` does.
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      const lx = dx * Math.cos(g.rotationRad) + dy * Math.sin(g.rotationRad)
      // ×2 because the transform holds the CENTER fixed: dragging one edge out
      // by `lx` widens the box by `lx` on both sides.
      const delta = ((g.side === 'right' ? 1 : -1) * (2 * lx)) / g.frameW
      patchTextStyle(g.clipId, {
        boxWidth: clampNumber(
          g.startBoxWidth + delta,
          MIN_BOX_WIDTH,
          MAX_BOX_WIDTH,
        ),
      })
    } else if (g.kind === 'crop') {
      // Project the pointer drag onto the media's own (rotated) axes, then turn
      // the on-edge component into an inset fraction of the full media dimension.
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      const cos = Math.cos(g.rotationRad)
      const sin = Math.sin(g.rotationRad)
      const lx = dx * cos + dy * sin
      const ly = -dx * sin + dy * cos
      const c = cropInsets(g.start)
      let value: number
      if (g.edge === 'left') value = c.left + lx / g.mediaW
      else if (g.edge === 'right') value = c.right - lx / g.mediaW
      else if (g.edge === 'top') value = c.top + ly / g.mediaH
      else value = c.bottom - ly / g.mediaH
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
    const el = frameRef.current
    if (!el) return
    el.style.cursor = '' // hand the cursor back to the handles/canvas
    releaseCapture(el, e.pointerId)
  }

  // Handles are hidden while editing text, so they can't sit under the caret.
  const showChrome =
    selectedClip != null && !playing && editingClipId !== selectedClip.id

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
        // Always the largest 16:9 box that fits the stage (contain), sized from
        // the container's own dimensions so BOTH axes stay locked to 16:9. A
        // single-axis fit (h-full + max-w-full) lets max-width clamp the width
        // while height stays full, silently squishing the frame — and with it
        // everything drawn onto the canvas. Never regress this to a one-axis fit.
        className="relative h-[min(100cqh,56.25cqw)] w-[min(100cqw,177.778cqh)] touch-none"
      >
        <div className="absolute inset-0 overflow-hidden rounded-[3px] bg-black shadow-[0_0_0_1px_rgba(255,255,255,1),0_40px_120px_-30px_rgba(0,0,0,0.9)]">
          {/* Hidden decode/audio sources (behind the opaque canvas). Videos stay
              full-size + opacity-0 so browsers keep decoding their frames. */}
          {videoClips.map((clip) => {
            const asset = assetOf(project, clip)
            if (!asset) return null
            return (
              <video
                key={clip.id}
                ref={(el) => {
                  if (el) poolRef.current.videos.set(clip.id, el)
                  else poolRef.current.videos.delete(clip.id)
                }}
                src={asset.url}
                playsInline
                // Without this iOS may fetch metadata only; readyState stays < 2,
                // sourceFor() returns null and the canvas draws nothing at all.
                preload="auto"
                onLoadedMetadata={(e) => {
                  onVideoMeta(clip, e)
                }}
                className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
              />
            )
          })}
          {imageAssets.map((a) => (
            <img
              key={a.id}
              ref={(el) => {
                if (el) poolRef.current.images.set(a.id, el)
                else poolRef.current.images.delete(a.id)
              }}
              src={a.url}
              alt=""
              draggable={false}
              onLoad={(e) => {
                onImageMeta(a.id, e)
              }}
              className="hidden"
            />
          ))}

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
              const isCorner = h.role === 'scale' || h.role === 'fontScale'
              const shape = isCorner
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
                    else if (h.role === 'fontScale') beginFontScale(e, h)
                    else beginScale(e, h)
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
        {editingClipId && rect && !playing && (
          <CanvasTextEditor
            clipId={editingClipId}
            rect={rect}
            frameH={frameSize.h}
            onEditStart={onEditStart}
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
