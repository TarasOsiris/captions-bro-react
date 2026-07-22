// The single source of truth for how the media is placed on the 16:9 project
// canvas. The preview (CSS transform in `PreviewStage`) and the export
// compositor (canvas 2D in `export.ts`) BOTH derive placement from here, so what
// you see in the preview is exactly what exports. Any change to this math must be
// reflected on both consumers — see the invariant note in CLAUDE.md.

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
}

/** The untouched placement: media contain-fitted and centered, no rotation. */
export const IDENTITY: Transform = { scale: 1, tx: 0, ty: 0, rotationDeg: 0 }

/** The output aspect ratio of the project canvas (and the preview frame). */
export const CANVAS_ASPECT = 16 / 9

const MIN_SCALE = 0.1
const MAX_SCALE = 10
/** Rotation lands on a right angle when within this many degrees of one. */
const SNAP_DEG = 4

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** The placed media rectangle. */
export interface MediaRect {
  /** Center, in canvas pixels. */
  cx: number
  cy: number
  /** Size, in canvas pixels (already includes `scale`). */
  w: number
  h: number
  rotationDeg: number
}

/**
 * The object-contain fit of `mediaAspect` into a `canvasW×canvasH` box: the
 * largest centered rectangle of that aspect that fits, matching CSS
 * `object-contain`.
 */
function containFit(
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
 * Where the media lands on a 16:9 canvas of the given pixel size, given the
 * transform. Consumed identically by preview and export.
 *
 * Canonical order (both consumers must match): scale about center → rotate about
 * center → translate.
 */
export function mediaRect(
  transform: Transform,
  mediaAspect: number,
  canvasW: number,
  canvasH: number,
): MediaRect {
  const fit = containFit(mediaAspect, canvasW, canvasH)
  return {
    cx: canvasW / 2 + transform.tx * canvasW,
    cy: canvasH / 2 + transform.ty * canvasH,
    w: fit.w * transform.scale,
    h: fit.h * transform.scale,
    rotationDeg: transform.rotationDeg,
  }
}

/** Translate by fractional-of-canvas deltas. */
export function applyMove(t: Transform, dxFrac: number, dyFrac: number): Transform {
  return { ...t, tx: t.tx + dxFrac, ty: t.ty + dyFrac }
}

/** Uniformly scale about the center by `factor` (aspect preserved, clamped). */
export function applyScale(t: Transform, factor: number): Transform {
  return { ...t, scale: clamp(t.scale * factor, MIN_SCALE, MAX_SCALE) }
}

/** Set the absolute rotation, snapping to the nearest right angle when close. */
export function applyRotation(t: Transform, deg: number, snap = true): Transform {
  if (!snap) return { ...t, rotationDeg: deg }
  const nearest = Math.round(deg / 90) * 90
  return { ...t, rotationDeg: Math.abs(deg - nearest) <= SNAP_DEG ? nearest : deg }
}
