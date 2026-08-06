// The single source of truth for how the media is placed on the 16:9 project
// canvas. The preview (CSS transform in `PreviewStage`) and the export
// compositor (canvas 2D in `export.ts`) BOTH derive placement from here, so what
// you see in the preview is exactly what exports. Any change to this math must be
// reflected on both consumers — see the invariant note in CLAUDE.md.

import { clamp } from './math'

/**
 * Edge crop: the fraction of the fitted media hidden from each side (0 = keep,
 * 0.5 = trim half away). Insets, not a sub-rect, so they survive scale/rotate
 * unchanged. The trimmed content is clipped away — the media is NOT resized, so a
 * crop reveals less of the source rather than stretching it (see `drawScene`).
 */
export interface CropInsets {
  top: number
  right: number
  bottom: number
  left: number
}

/** A media placement, in normalized (resolution-independent) 16:9-canvas terms. */
export interface Transform {
  /** Multiple of the object-contain "fit" size. 1 = fitted, >1 = zoomed in. */
  scale: number
  /** Horizontal offset of the media center, as a fraction of canvas width. */
  tx: number
  /** Vertical offset of the media center, as a fraction of canvas height. */
  ty: number
  /** Clockwise rotation of the media, in degrees. */
  rotationDeg: number
  /** Edge crop insets; absent = uncropped (old documents load without it). */
  crop?: CropInsets
}

/** No crop on any edge. */
export const NO_CROP: CropInsets = { top: 0, right: 0, bottom: 0, left: 0 }

/** The untouched placement: media contain-fitted and centered, no rotation. */
export const IDENTITY: Transform = { scale: 1, tx: 0, ty: 0, rotationDeg: 0 }

/** Crop insets for a transform, defaulting to none when absent. */
export function cropInsets(t: Transform): CropInsets {
  return t.crop ?? NO_CROP
}

/** The output aspect ratio of the project canvas (and the preview frame). */
export const CANVAS_ASPECT = 16 / 9

const MIN_SCALE = 0.1
const MAX_SCALE = 10
/** Rotation lands on a right angle when within this many degrees of one. */
const SNAP_DEG = 4
/** A trim always leaves at least this fraction of a dimension visible. */
const MIN_VISIBLE = 0.05

/** The placed media rectangle. */
export interface MediaRect {
  /** Center, in canvas pixels. */
  cx: number
  cy: number
  /** Size, in canvas pixels (already includes `scale`). */
  w: number
  h: number
  rotationDeg: number
  /** Edge crop insets to apply within the rect (see `croppedRect`). */
  crop: CropInsets
}

/**
 * The object-contain fit of `mediaAspect` into a `canvasW×canvasH` box: the
 * largest centered rectangle of that aspect that fits, matching CSS
 * `object-contain`.
 *
 * Exported because a source that reports a NATURAL size instead of an aspect
 * (a laid-out text block) skips this step and goes straight to `placeRect` —
 * contain-fitting a text box would blow it up to fill the canvas.
 */
export function containFit(
  mediaAspect: number,
  canvasW: number,
  canvasH: number,
): { w: number; h: number } {
  const canvasAspect = canvasW / canvasH
  if (mediaAspect >= canvasAspect) {
    // Media is wider than the canvas → fill width, letterbox top/bottom.
    return { w: canvasW, h: canvasW / mediaAspect }
  }
  // Media is taller → fill height, pillarbox left/right.
  return { w: canvasH * mediaAspect, h: canvasH }
}

/**
 * THE placement primitive: where a source of natural size `naturalW×naturalH`
 * (canvas pixels, at `scale === 1`) lands on a canvas of the given pixel size.
 *
 * Canonical order (every consumer must match): scale about center → rotate about
 * center → translate.
 *
 * Two kinds of source feed this. Media has an intrinsic ASPECT and is
 * contain-fitted first (see `mediaRect`); a text block measures its own natural
 * SIZE and is placed directly. Both then share this one function, so preview and
 * export can't disagree about placement for either.
 */
export function placeRect(
  transform: Transform,
  naturalW: number,
  naturalH: number,
  canvasW: number,
  canvasH: number,
): MediaRect {
  return {
    cx: canvasW / 2 + transform.tx * canvasW,
    cy: canvasH / 2 + transform.ty * canvasH,
    w: naturalW * transform.scale,
    h: naturalH * transform.scale,
    rotationDeg: transform.rotationDeg,
    crop: cropInsets(transform),
  }
}

/**
 * Where the media lands on a 16:9 canvas of the given pixel size, given the
 * transform. Consumed identically by preview and export. Contain-fit, then
 * `placeRect`.
 */
export function mediaRect(
  transform: Transform,
  mediaAspect: number,
  canvasW: number,
  canvasH: number,
): MediaRect {
  const fit = containFit(mediaAspect, canvasW, canvasH)
  return placeRect(transform, fit.w, fit.h, canvasW, canvasH)
}

/**
 * The visible sub-rectangle of a placed media rect after its crop is applied: a
 * smaller axis-aligned box (in the media's own rotated frame) whose center shifts
 * toward the kept side. The trimmed content stays anchored — trimming the left
 * edge shrinks the box from the left, it doesn't move or scale the media. Used to
 * place the selection chrome and to hit-test only the visible area.
 */
export function croppedRect(r: MediaRect): MediaRect {
  const c = r.crop
  // Most rects are uncropped (text never crops at all) and this runs per frame
  // for the selection chrome and per pointermove for the hit test.
  if (!c.left && !c.right && !c.top && !c.bottom) return { ...r, crop: NO_CROP }
  // Center offset in the media's LOCAL (unrotated) frame, then rotated into canvas space.
  const p = fromCenter(
    r,
    (r.w * (c.left - c.right)) / 2,
    (r.h * (c.top - c.bottom)) / 2,
  )
  return {
    cx: p.x,
    cy: p.y,
    w: r.w * (1 - c.left - c.right),
    h: r.h * (1 - c.top - c.bottom),
    rotationDeg: r.rotationDeg,
    crop: NO_CROP,
  }
}

/** The VISIBLE box of a placed source: `placeRect`, then its crop applied. What
 *  the selection chrome, the hit test and a corner anchor all want — as opposed
 *  to the FULL rect a crop drag measures its insets against. */
export function visibleRect(
  transform: Transform,
  naturalW: number,
  naturalH: number,
  canvasW: number,
  canvasH: number,
): MediaRect {
  return croppedRect(placeRect(transform, naturalW, naturalH, canvasW, canvasH))
}

/** A local (unrotated) offset from a rect's center, rotated into canvas space.
 *  The module's ONE rotation matrix — `toLocalDelta` inverts it, nothing else
 *  should restate it. */
function fromCenter(
  r: MediaRect,
  lx: number,
  ly: number,
): { x: number; y: number } {
  const rad = (r.rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: r.cx + lx * cos - ly * sin, y: r.cy + lx * sin + ly * cos }
}

/**
 * A canvas-space delta expressed in a rect's OWN (rotated) axes — the inverse
 * of `fromCenter`'s rotation, and the only place that inversion is written.
 * Every gesture that acts along the media's own axes (edge crop, text wrap
 * width, the hit test) projects through here first.
 */
export function toLocalDelta(
  dx: number,
  dy: number,
  rotationDeg: number,
): { lx: number; ly: number } {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { lx: dx * cos + dy * sin, ly: -dx * sin + dy * cos }
}

/** Is a canvas-space point inside a placed rect? `dx`/`dy` are measured from
 *  the rect's CENTER (the caller subtracts `cx`/`cy`), so this stays pure of
 *  any frame/client coordinate system. Hit-test the VISIBLE box, so trimmed
 *  regions aren't grabbable — pass a `croppedRect`/`visibleRect` result. */
export function hitTestRect(r: MediaRect, dx: number, dy: number): boolean {
  const { lx, ly } = toLocalDelta(dx, dy, r.rotationDeg)
  return Math.abs(lx) <= r.w / 2 && Math.abs(ly) <= r.h / 2
}

/**
 * The wrap width a text side-handle drag lands on. ×2 because the transform
 * holds the block's CENTER fixed: dragging one edge out by `lx` widens the box
 * by `lx` on BOTH sides.
 */
export function wrapWidthForDrag(
  startBoxWidth: number,
  side: 'left' | 'right',
  dx: number,
  dy: number,
  rotationDeg: number,
  frameW: number,
  bounds: { min: number; max: number },
): number {
  const { lx } = toLocalDelta(dx, dy, rotationDeg)
  const delta = ((side === 'right' ? 1 : -1) * (2 * lx)) / frameW
  return clamp(startBoxWidth + delta, bounds.min, bounds.max)
}

/**
 * The inset value an edge-crop drag lands on: the drag projected onto the
 * media's own axes, then the on-edge component turned into a fraction of the
 * full media dimension. Feed the result to `applyCrop`, which does the
 * clamping.
 */
export function cropValueForDrag(
  start: Transform,
  edge: keyof CropInsets,
  dx: number,
  dy: number,
  rotationDeg: number,
  mediaW: number,
  mediaH: number,
): number {
  const { lx, ly } = toLocalDelta(dx, dy, rotationDeg)
  const c = cropInsets(start)
  switch (edge) {
    case 'left':
      return c.left + lx / mediaW
    case 'right':
      return c.right - lx / mediaW
    case 'top':
      return c.top + ly / mediaH
    case 'bottom':
      return c.bottom - ly / mediaH
  }
}

/**
 * The point at fractional position `(fx, fy)` of a placed rect — (0,0) its
 * top-left corner, (1,1) its bottom-right — in canvas pixels, with the rect's
 * own rotation applied. Corner handles read their geometric position from here.
 */
export function rectPoint(
  r: MediaRect,
  fx: number,
  fy: number,
): { x: number; y: number } {
  return fromCenter(r, (fx - 0.5) * r.w, (fy - 0.5) * r.h)
}

/**
 * A point of a rect named twice over: where it sits ON the box (`fx`/`fy`
 * fractions) and where that has to LAND in canvas pixels. One object rather than
 * four adjacent numbers, which would transpose silently.
 */
export interface RectAnchor {
  fx: number
  fy: number
  x: number
  y: number
}

/**
 * Translate `t` so that the anchor's `(fx, fy)` point of its VISIBLE box lands
 * exactly on the anchor's `(x, y)`.
 *
 * This is what makes a corner drag resize AGAINST the opposite corner instead of
 * about the center: resize first, then re-pin the corner that must not move.
 * Note it re-derives the box from the natural size passed in rather than scaling
 * the previous one — that is what keeps it honest for text, whose height jumps a
 * whole line the moment a bigger font re-wraps the block.
 */
export function anchorRectAt(
  t: Transform,
  naturalW: number,
  naturalH: number,
  canvasW: number,
  canvasH: number,
  anchor: RectAnchor,
): Transform {
  const p = rectPoint(
    visibleRect(t, naturalW, naturalH, canvasW, canvasH),
    anchor.fx,
    anchor.fy,
  )
  return {
    ...t,
    tx: t.tx + (anchor.x - p.x) / canvasW,
    ty: t.ty + (anchor.y - p.y) / canvasH,
  }
}

/** Translate by fractional-of-canvas deltas. */
export function applyMove(
  t: Transform,
  dxFrac: number,
  dyFrac: number,
): Transform {
  return { ...t, tx: t.tx + dxFrac, ty: t.ty + dyFrac }
}

/** Uniformly scale about the center by `factor` (aspect preserved, clamped). */
export function applyScale(t: Transform, factor: number): Transform {
  return { ...t, scale: clamp(t.scale * factor, MIN_SCALE, MAX_SCALE) }
}

/**
 * Set one edge's crop inset to `value` (a fraction of the fitted media),
 * clamped so the inset never goes negative and always leaves `MIN_VISIBLE` of the
 * dimension past the opposite edge. This TRIMS the media (hides content) rather
 * than scaling it.
 */
export function applyCrop(
  t: Transform,
  edge: keyof CropInsets,
  value: number,
): Transform {
  const crop = cropInsets(t)
  const opposite: keyof CropInsets =
    edge === 'left'
      ? 'right'
      : edge === 'right'
        ? 'left'
        : edge === 'top'
          ? 'bottom'
          : 'top'
  const max = Math.max(0, 1 - crop[opposite] - MIN_VISIBLE)
  return { ...t, crop: { ...crop, [edge]: clamp(value, 0, max) } }
}

/** Set the absolute rotation, snapping to the nearest right angle when close. */
export function applyRotation(
  t: Transform,
  deg: number,
  snap = true,
): Transform {
  if (!snap) return { ...t, rotationDeg: deg }
  const nearest = Math.round(deg / 90) * 90
  return {
    ...t,
    rotationDeg: Math.abs(deg - nearest) <= SNAP_DEG ? nearest : deg,
  }
}
