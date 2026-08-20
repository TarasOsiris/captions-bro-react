// The live render preview: a throttled mirror of the canvas the running export
// composites each frame onto (see `onSurface` in lib/export). Without it the
// export screen shows a black rectangle for the whole encode.
//
// It PULLS on a rAF instead of the export PUSHING one frame per composite. The
// encode is the thing under time pressure, and a push would tie the preview's
// cost to the encoder's frame rate — a 30fps timeline export would repaint 30
// times a second, and the fast path would repaint at whatever rate mediabunny
// happens to drain samples. Pulling costs one scaled drawImage per interval,
// whatever the encoder is doing, and skips frames instead of queueing them.

import { useEffect, useRef } from 'react'

/** ~12fps. Reads as motion; negligible next to the encode it must not slow. */
const MIRROR_MS = 80
/** The mirror is a downscale of a 1080p-class surface; 2× is already sharp. */
const MAX_DPR = 2

interface ExportPreviewProps {
  /** The export's compositing canvas, or null until the chosen path has
   *  allocated it — which is a dynamic import and a font load away, so this
   *  returns null for the first stretch of every export. */
  getSurface: () => HTMLCanvasElement | null
  /** CSS size of the preview box, already fitted to the project aspect by
   *  ExportScreen — so the mirror is a straight scale, never a squish. */
  width: number
  height: number
}

export function ExportPreview({
  getSurface,
  width,
  height,
}: ExportPreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const dst = ref.current
    if (!dst || width <= 0 || height <= 0) return
    const ctx = dst.getContext('2d')
    if (!ctx) return

    // Sizing the backing store also clears it, so it happens here (on mount and
    // on resize) and never in the tick.
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    dst.width = Math.max(1, Math.round(width * dpr))
    dst.height = Math.max(1, Math.round(height * dpr))

    let raf = 0
    let last = -Infinity
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < MIRROR_MS) return
      const src = getSurface()
      if (!src || src.width === 0) return
      last = now
      // No clear first: `drawScene` fills the whole frame with the canvas
      // background, so every mirrored frame is opaque and covers the last one.
      // Before the first composite the surface is fully transparent, and
      // source-over leaves the destination untouched — so an early tick is a
      // no-op rather than a black flash over the gradient underneath.
      ctx.drawImage(src, 0, 0, dst.width, dst.height)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [getSurface, width, height])

  return (
    // Decorative to a screen reader: the progress it illustrates is already
    // announced as text by the percentage above it.
    <canvas ref={ref} aria-hidden className="absolute inset-0 h-full w-full" />
  )
}
