import { useEffect, useRef, useState } from 'react'
import { RotateCw, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEditorStore } from '@/store/editorStore'
import { resolveScene } from '@/lib/model/scene'
import { assetOf, clipAspect, clipById } from '@/lib/model/selectors'
import { drawScene } from '@/lib/render/compositor'
import {
  applyCrop,
  applyMove,
  applyRotation,
  applyScale,
  cropInsets,
  croppedRect,
  mediaRect,
} from '@/lib/transform'
import type { CropInsets } from '@/lib/transform'
import type { DrawItem, RenderSource } from '@/lib/render/compositor'
import type { MediaPool } from '@/lib/render/mediaPool'
import type { Clip, MediaAsset, Transform } from '@/lib/model/types'

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
const HANDLES: Array<{
  x: number
  y: number
  cursor: string
  edge?: keyof CropInsets
}> = [
  { x: 0, y: 0, cursor: 'nwse-resize' },
  { x: 0.5, y: 0, cursor: 'ns-resize', edge: 'top' },
  { x: 1, y: 0, cursor: 'nesw-resize' },
  { x: 1, y: 0.5, cursor: 'ew-resize', edge: 'right' },
  { x: 1, y: 1, cursor: 'nwse-resize' },
  { x: 0.5, y: 1, cursor: 'ns-resize', edge: 'bottom' },
  { x: 0, y: 1, cursor: 'nesw-resize' },
  { x: 0, y: 0.5, cursor: 'ew-resize', edge: 'left' },
]

/** In-flight pointer gesture; `clipId` names the clip being transformed and
 *  `start` is its transform at gesture start (so moves never drift). */
type Gesture =
  | {
      kind: 'move'
      clipId: string
      startX: number
      startY: number
      start: Transform
    }
  | {
      kind: 'scale'
      clipId: string
      centerX: number
      centerY: number
      startDist: number
      start: Transform
    }
  | {
      kind: 'rotate'
      clipId: string
      centerX: number
      centerY: number
      startAngle: number
      start: Transform
    }
  | {
      kind: 'crop'
      clipId: string
      edge: keyof CropInsets
      startX: number
      startY: number
      /** Full media rect dimensions (px) at gesture start, to scale the drag. */
      mediaW: number
      mediaH: number
      /** Media rotation (rad) — the drag is projected onto its local axes. */
      rotationRad: number
      start: Transform
    }

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

  const hasClips = project.tracks.some((t) => t.clips.length > 0)
  const selectedClip = clipById(project, selectedClipId)
  const selectedAspect = clipAspect(project, selectedClip)

  // Distinct sources to keep mounted: a <video> per video clip, a shared <img>
  // per referenced image asset.
  const videoClips = project.tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.type === 'video' && c.assetId != null)
  const imageAssets = (() => {
    const seen = new Set<string>()
    const out: { id: string; url: string }[] = []
    for (const clip of project.tracks.flatMap((t) => t.clips)) {
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

    const sourceFor = (clip: Clip): RenderSource | null => {
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
        source: sourceFor(item.clip),
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
  // (cropped) box, so the handles sit on the trimmed edges.
  const rect =
    selectedClip && selectedAspect != null && frameSize.w > 0
      ? croppedRect(
          mediaRect(
            selectedClip.transform,
            selectedAspect,
            frameSize.w,
            frameSize.h,
          ),
        )
      : null

  const centerClient = (transform: Transform, aspect: number) => {
    const el = frameRef.current
    if (!el) return null
    const fr = el.getBoundingClientRect()
    const r = mediaRect(transform, aspect, fr.width, fr.height)
    return { x: fr.left + r.cx, y: fr.top + r.cy }
  }

  const hitTestClip = (
    transform: Transform,
    aspect: number,
    clientX: number,
    clientY: number,
  ): boolean => {
    const el = frameRef.current
    if (!el) return false
    const fr = el.getBoundingClientRect()
    // Hit-test the visible (cropped) box, so trimmed-away regions aren't grabbable.
    const r = croppedRect(mediaRect(transform, aspect, fr.width, fr.height))
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

  const beginScale = (e: React.PointerEvent, cursor: string) => {
    e.stopPropagation()
    const el = frameRef.current
    if (!el || !selectedClip || selectedAspect == null) return
    const center = centerClient(selectedClip.transform, selectedAspect)
    if (!center) return
    onEditStart()
    gestureRef.current = {
      kind: 'scale',
      clipId: selectedClip.id,
      centerX: center.x,
      centerY: center.y,
      startDist: Math.hypot(e.clientX - center.x, e.clientY - center.y),
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
    const el = frameRef.current
    if (!el || !selectedClip || selectedAspect == null) return
    const fr = el.getBoundingClientRect()
    const r = mediaRect(
      selectedClip.transform,
      selectedAspect,
      fr.width,
      fr.height,
    )
    if (r.w <= 0 || r.h <= 0) return
    onEditStart()
    gestureRef.current = {
      kind: 'crop',
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
    const el = frameRef.current
    if (!el || !selectedClip || selectedAspect == null) return
    const center = centerClient(selectedClip.transform, selectedAspect)
    if (!center) return
    onEditStart()
    gestureRef.current = {
      kind: 'rotate',
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
    const el = frameRef.current
    if (!el) return
    // Hit-test the clips live at the playhead, topmost first.
    const st = useEditorStore.getState()
    const live = resolveScene(st.project, st.currentTime)
    for (let i = live.length - 1; i >= 0; i--) {
      const clip = live[i].clip
      const aspect = clipAspect(st.project, clip)
      if (aspect == null) continue
      if (hitTestClip(clip.transform, aspect, e.clientX, e.clientY)) {
        selectClip(clip.id)
        onEditStart()
        gestureRef.current = {
          kind: 'move',
          clipId: clip.id,
          startX: e.clientX,
          startY: e.clientY,
          start: clip.transform,
        }
        startGesture(el, e, 'grabbing')
        return
      }
    }
    selectClip(null)
  }

  const onFramePointerMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    const el = frameRef.current
    if (!g || !el) return
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
      if (g.startDist > 0) {
        const dist = Math.hypot(e.clientX - g.centerX, e.clientY - g.centerY)
        setClipTransform(g.clipId, applyScale(g.start, dist / g.startDist))
      }
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
    gestureRef.current = null
    const el = frameRef.current
    if (!el) return
    el.style.cursor = '' // hand the cursor back to the handles/canvas
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  }

  const showChrome = selectedClip != null && !playing

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
      className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-stage bg-[radial-gradient(70rem_45rem_at_50%_-15%,rgba(168,137,255,0.05),transparent)] p-5 [container-type:size]"
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
            {HANDLES.map((h) => {
              // Corners scale → round dot; trim edges → a small bar along the edge.
              const shape = !h.edge
                ? 'h-3.5 w-3.5 rounded-full'
                : h.edge === 'top' || h.edge === 'bottom'
                  ? 'h-1.5 w-3 rounded-[2px]'
                  : 'h-3 w-1.5 rounded-[2px]'
              return (
                <span
                  key={`${h.x.toString()}-${h.y.toString()}`}
                  onPointerDown={
                    h.edge
                      ? (e) =>
                          beginCrop(e, h.edge as keyof CropInsets, h.cursor)
                      : (e) => beginScale(e, h.cursor)
                  }
                  style={{
                    left: `${(h.x * 100).toString()}%`,
                    top: `${(h.y * 100).toString()}%`,
                    cursor: h.cursor,
                  }}
                  className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 border border-black/10 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.5)] ${shape}`}
                />
              )
            })}
            <button
              type="button"
              onPointerDown={beginRotate}
              aria-label="Rotate"
              style={{ left: '50%', top: 'calc(100% + 22px)' }}
              className="pointer-events-auto absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full bg-white text-black/70 shadow-[0_1px_4px_rgba(0,0,0,0.5)] active:cursor-grabbing"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          </div>
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
