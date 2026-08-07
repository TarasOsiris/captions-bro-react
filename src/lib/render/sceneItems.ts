// Scene → DrawItem[]: THE clip-type branch, shared by the preview's rAF loop
// and exportTimeline's frame loop. Previously each path had its own copy, so a
// new clip type had to be handled in three places — and the codebase already
// carries the scar of that (text clips were silently dropped from the export by
// an asset guard while still showing in the preview; see the ordering below).
//
// What is NOT unified, deliberately: how each path gets a clip's PIXELS (a
// pool <video>, a mediabunny VideoSample, an ImageBitmap). That's inherent, so
// it arrives as `resolveMedia`. The fast path's overlay assembly is
// `liveTextItems` below — it shares the text arm but not the scene walk,
// because it draws its media frame unconditionally (see that comment).

import { textSourceForClip } from './textSource'
import { clipIsLiveAt } from '@/lib/model/selectors'
import { clipOpacity } from '@/lib/model/visual'
import type { DrawItem, RenderSource } from './compositor'
import type { SceneItem } from '@/lib/model/scene'
import type { Clip } from '@/lib/model/types'

/** How a path turns one live scene item into pixels. Null = not ready / not
 *  this path's business; the item is skipped for that frame. */
export type ResolveMediaSource = (item: SceneItem) => RenderSource | null

/** Injectable only so the node test env (no DOM, so no canvas measurer) can
 *  drive the branch; production callers never pass it. */
type ResolveText = typeof textSourceForClip

/**
 * The per-clip VISUAL properties every render path must carry onto a media
 * layer. Widening this type is a compile error at `mediaDrawItem`'s body, which
 * is the point: `videoPath`'s fast path builds its DrawItem by hand, outside
 * the scene walk, and could otherwise silently omit a new property — the
 * preview would show it and the export would not.
 *
 * A `Clip` structurally satisfies it, so call sites just pass the clip.
 */
export type MediaLayer = Pick<Clip, 'transform' | 'opacity'>

/** The per-clip visual properties a TEXT layer carries. Deliberately NOT
 *  `opacity`: `paintText` composites in several passes (background box → shadow
 *  → stroke → fill), so a layer-wide `globalAlpha` would let the outline show
 *  through the glyph fill. Text fades through `TextStyle.opacity` instead. */
export type TextLayer = Pick<Clip, 'transform'>

/** The ONE constructor for a media DrawItem. Every path goes through it —
 *  `sceneDrawItems` for the preview and the timeline compositor, and
 *  `videoPath`'s synchronous `process` hook for the fast path. */
export function mediaDrawItem(
  layer: MediaLayer,
  source: RenderSource | null,
): DrawItem {
  return {
    transform: layer.transform,
    source,
    opacity: clipOpacity(layer),
  }
}

/** The ONE constructor for a text DrawItem — the sibling of `mediaDrawItem`,
 *  and here for the same reason: the text arm is built in TWO places (the scene
 *  walk, serving the preview and the timeline compositor, and `liveTextItems`,
 *  serving the export fast path), so a property added to one and not the other
 *  is silently a preview-vs-export drift. */
export function textDrawItem(layer: TextLayer, source: RenderSource): DrawItem {
  return { transform: layer.transform, source }
}

/**
 * Draw items for a resolved scene, in the scene's own draw order.
 *
 * Text resolves FIRST, before anything asset-shaped: a text clip is generated
 * rather than decoded, so it has no asset and an asset guard would drop it.
 * Audio clips never draw.
 */
export function sceneDrawItems(
  scene: ReadonlyArray<SceneItem>,
  canvasW: number,
  canvasH: number,
  resolveMedia: ResolveMediaSource,
  resolveText: ResolveText = textSourceForClip,
): DrawItem[] {
  const items: DrawItem[] = []
  for (const item of scene) {
    const clip = item.clip
    if (clip.type === 'text') {
      const source = resolveText(clip, canvasW, canvasH)
      if (source) items.push(textDrawItem(clip, source))
      continue
    }
    if (clip.type === 'audio') continue
    const source = resolveMedia(item)
    if (source) items.push(mediaDrawItem(clip, source))
  }
  return items
}

/**
 * Text overlays live at project time `t`, for the single-source fast path.
 *
 * Deliberately NOT `resolveScene`: that path holds no `Project` (it re-encodes
 * one file), and its media frame is drawn unconditionally by the caller because
 * a sample timestamp can run a rounding step past the clip's stored duration —
 * a liveness check there would black out the tail. Liveness for the TEXT is the
 * raw half-open window; the preview's end-of-timeline hold is unobservable in
 * an export, since the encoder never samples exactly `t === projectDuration`.
 */
export function liveTextItems(
  overlays: ReadonlyArray<Clip>,
  t: number,
  canvasW: number,
  canvasH: number,
  resolveText: ResolveText = textSourceForClip,
): DrawItem[] {
  const items: DrawItem[] = []
  for (const clip of overlays) {
    if (!clipIsLiveAt(clip, t)) continue
    const source = resolveText(clip, canvasW, canvasH)
    if (source) items.push(textDrawItem(clip, source))
  }
  return items
}

/** A RenderSource over a mediabunny VideoSample (structural — no import). */
export function videoSampleSource(sample: {
  displayWidth: number
  displayHeight: number
  draw: (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => void
}): RenderSource {
  return {
    aspect: sample.displayWidth / sample.displayHeight,
    paint: (ctx, dx, dy, dw, dh) => {
      sample.draw(ctx, dx, dy, dw, dh)
    },
  }
}

/** A RenderSource over an ImageBitmap (or any drawable with intrinsic size). */
export function bitmapSource(bmp: {
  width: number
  height: number
}): RenderSource {
  return {
    aspect: bmp.width / bmp.height,
    paint: (ctx, dx, dy, dw, dh) => {
      ctx.drawImage(bmp as CanvasImageSource, dx, dy, dw, dh)
    },
  }
}
