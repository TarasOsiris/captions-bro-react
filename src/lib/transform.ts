// The single source of truth for how the media is placed on the project
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

/** A media placement, in normalized (resolution-independent) canvas terms —
 *  every field is a FRACTION of the canvas, so the same transform frames the
 *  clip identically at any canvas size OR aspect. */
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

/** Is anything actually trimmed off? True for an absent crop AND for one whose
 *  insets are all zero — the two spellings of "uncropped" that a hand-edited or
 *  round-tripped document can produce. */
export function hasCrop(t: Transform): boolean {
  const c = cropInsets(t)
  return c.top > 0 || c.right > 0 || c.bottom > 0 || c.left > 0
}

/** Scale bounds. Exported so the inspector's numeric field clamps to exactly
 *  what `applyScale` does — a field with its own limits would let a typed value
 *  reach a scale the corner handles refuse. */
export const MIN_SCALE = 0.1
export const MAX_SCALE = 10
/** Rotation lands on a right angle when within this many degrees of one. */
const SNAP_DEG = 4
/** How close (px) a drag must get to a snap target before it engages — shared
 *  by the timeline's clip drag and the preview's canvas guides, so the two
 *  drags feel the same. */
export const SNAP_PX = 8
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
 * Where the media lands on a canvas of the given pixel size, given the
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
 * The axis-aligned bounding box of a placed rect, in canvas pixels, with its
 * rotation applied — the rotated silhouette's extremities, which is what a snap
 * or an alignment guide has to measure against. At 0° it degenerates to the
 * plain box, so consumers need no rotation branch of their own. Crop is NOT
 * applied here; pass a `croppedRect`/`visibleRect` result to bound the visible box.
 */
export function rectBounds(r: MediaRect): {
  left: number
  right: number
  top: number
  bottom: number
} {
  const corners = [
    rectPoint(r, 0, 0),
    rectPoint(r, 1, 0),
    rectPoint(r, 1, 1),
    rectPoint(r, 0, 1),
  ]
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  }
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

/** The alignment guides a snapped move has engaged: the vertical line's x as a
 *  fraction of canvas width, the horizontal line's y as a fraction of canvas
 *  height; null = that axis is free. */
export interface SnapGuides {
  x: number | null
  y: number | null
}
export const NO_GUIDES: SnapGuides = { x: null, y: null }

/** A move corrected by canvas snapping, plus the guides it engaged. */
export interface MoveSnap {
  transform: Transform
  guides: SnapGuides
}

/**
 * Pull a proposed move onto the canvas's edges and center lines when it lands
 * within `thresholdPx` of one. Snaps the VISIBLE (cropped, rotated) box, so what
 * aligns is what the chrome outlines and the user sees.
 *
 * Distances are measured in PIXELS, not in the fractional units `tx`/`ty` live
 * in — a fraction-based threshold would feel ~1.8× tighter on x than on y for a
 * 16:9 canvas. Each axis resolves independently; an axis that finds no candidate
 * returns its input coordinate VERBATIM (a fully free move returns `t` itself),
 * so free movement is byte-identical to an unsnapped drag.
 */
export function snapMove(
  t: Transform,
  naturalW: number,
  naturalH: number,
  canvasW: number,
  canvasH: number,
  thresholdPx: number,
): MoveSnap {
  if (canvasW <= 0 || canvasH <= 0) return { transform: t, guides: NO_GUIDES }
  const r = visibleRect(t, naturalW, naturalH, canvasW, canvasH)
  const b = rectBounds(r)
  const x = snapAxis(
    [r.cx, b.left, b.right],
    [canvasW / 2, 0, canvasW],
    thresholdPx,
  )
  const y = snapAxis(
    [r.cy, b.top, b.bottom],
    [canvasH / 2, 0, canvasH],
    thresholdPx,
  )
  if (!x && !y) return { transform: t, guides: NO_GUIDES }
  return {
    transform: {
      ...t,
      tx: x ? t.tx + x.delta / canvasW : t.tx,
      ty: y ? t.ty + y.delta / canvasH : t.ty,
    },
    guides: {
      x: x ? x.target / canvasW : null,
      y: y ? y.target / canvasH : null,
    },
  }
}

/** One axis of `snapMove`: the nearest box-position/target pair inside the
 *  threshold, or null. Seeded at `thresholdPx` with a strict `<`, like
 *  `snapTime` — exactly at the threshold does not snap, and a tie resolves to
 *  whichever candidate came first. Both lists lead with the CENTER, so a
 *  canvas-wide box shows the one center line rather than both edges. */
function snapAxis(
  positions: number[],
  targets: number[],
  thresholdPx: number,
): { delta: number; target: number } | null {
  let best: { delta: number; target: number } | null = null
  let bestDist = thresholdPx
  for (const p of positions) {
    for (const target of targets) {
      const dist = Math.abs(target - p)
      if (dist < bestDist) {
        bestDist = dist
        best = { delta: target - p, target }
      }
    }
  }
  return best
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

// ── Framing: the Fit / Fill / Reset-crop commands ────────────────────────────
// Pure, and here rather than in a new module: they are placement math, and
// `placeRect` is the only placement path.

/**
 * Drop the crop entirely.
 *
 * ABSENT, not zeroed: `cropInsets` reads absent as `NO_CROP`, and an absent key
 * is how an uncropped document has always serialized — so a cleared crop
 * round-trips through JSON identically to one that was never set.
 */
export function clearCrop(t: Transform): Transform {
  if (!hasCrop(t)) return t
  const next = { ...t }
  delete next.crop
  return next
}

/**
 * The scale at which the media COVERS the canvas — no letterboxing; the frame
 * crops the overflow instead. The CSS `object-fit: cover` of this module.
 *
 * The rotation is handled by rotating the CANVAS into the media's own frame,
 * NOT by bounding the rotated media in canvas space. Those are different
 * questions and only the first one is "cover": a 45°-tilted box has a bounding
 * box far larger than itself, so an AABB test says it already covers the canvas
 * while its corners are in fact cut off. Rotating the canvas the other way asks
 * the right thing — how big an axis-aligned box must be to contain the tilted
 * frame — and at 0° it degenerates to the plain `max(cw / fitW, ch / fitH)`.
 *
 * Crop-agnostic: this measures the placed box, not the visible sub-rect.
 */
export function coverScale(
  t: Transform,
  mediaAspect: number,
  canvasW: number,
  canvasH: number,
): number {
  const fit = containFit(mediaAspect, canvasW, canvasH)
  // A degenerate aspect (0, Infinity, NaN) must not hand back NaN scale.
  if (!(fit.w > 0) || !(fit.h > 0)) return t.scale
  const rad = (t.rotationDeg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  // The canvas's extent measured along the media's own axes.
  const needW = canvasW * cos + canvasH * sin
  const needH = canvasW * sin + canvasH * cos
  return clamp(Math.max(needW / fit.w, needH / fit.h), MIN_SCALE, MAX_SCALE)
}

/** Contain-fit and centered — the whole frame visible, letterboxed if it must
 *  be. Rotation is the user's framing choice and is KEPT; crop is cleared,
 *  since a crop of a fitted box would leave it both letterboxed and clipped. */
export function fitTransform(t: Transform): Transform {
  return clearCrop({ ...t, scale: 1, tx: 0, ty: 0 })
}

/** Fill the frame edge to edge, centered, overflow cropped by the canvas. */
export function fillTransform(
  t: Transform,
  mediaAspect: number,
  canvasW: number,
  canvasH: number,
): Transform {
  const bare = fitTransform(t)
  return { ...bare, scale: coverScale(bare, mediaAspect, canvasW, canvasH) }
}
