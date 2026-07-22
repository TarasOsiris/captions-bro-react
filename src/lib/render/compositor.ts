// THE renderer. `drawScene` is the single place editor pixels are produced — the
// preview (a <canvas> on a rAF loop) and the export (mediabunny per-frame) both
// call it, so what you see is what exports. WYSIWYG is structural, not a
// hand-maintained invariant. Pure w.r.t. its inputs; touches only the canvas
// context it's handed (SSR-safe — no DOM/WebCodecs at module scope).
//
// A DrawItem decouples the compositor from how a source was decoded: each item
// supplies its aspect ratio and a `paint` closure that draws the source into a
// destination rect. That closure is `ctx.drawImage(videoEl, …)` in the preview,
// `sample.draw(ctx, …)` in video export, `ctx.drawImage(bitmap, …)` in image
// export — the geometry (via `mediaRect`) is identical in every case.

import { mediaRect } from '@/lib/transform'
import type { CanvasSettings, Transform } from '@/lib/model/types'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface RenderSource {
  /** Source aspect ratio (width / height). */
  aspect: number
  /** Paint the source filling the given destination rect (canvas already
   *  translated to the media center and rotated). */
  paint: (ctx: Ctx, dx: number, dy: number, dw: number, dh: number) => void
}

export interface DrawItem {
  transform: Transform
  /** The decoded source; null while loading → the item is skipped this frame. */
  source: RenderSource | null
}

/** Composite `items` onto a `canvas`-sized context: background, then each item at
 *  its transformed rect (scale about center → rotate about center → translate). */
export function drawScene(
  ctx: Ctx,
  canvas: CanvasSettings,
  items: DrawItem[],
): void {
  ctx.save()
  ctx.fillStyle = canvas.background
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (const item of items) {
    if (!item.source) continue
    const rect = mediaRect(
      item.transform,
      item.source.aspect,
      canvas.width,
      canvas.height,
    )
    ctx.save()
    ctx.translate(rect.cx, rect.cy)
    if (rect.rotationDeg) ctx.rotate((rect.rotationDeg * Math.PI) / 180)
    item.source.paint(ctx, -rect.w / 2, -rect.h / 2, rect.w, rect.h)
    ctx.restore()
  }
  ctx.restore()
}
