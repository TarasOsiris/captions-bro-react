// The single source of truth for how the media is placed on the 16:9 project
// canvas. The preview (CSS transform in `PreviewStage`) and the export
// compositor (canvas 2D in `export.ts`) BOTH derive placement from here, so what
// you see in the preview is exactly what exports. Any change to this math must be
// reflected on both consumers — see the invariant note in CLAUDE.md.

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
  /** Edge crop insets to apply within the rect (see `croppedRect`). */
  crop: CropInsets
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
    crop: cropInsets(transform),
  }
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
  const w = r.w * (1 - c.left - c.right)
  const h = r.h * (1 - c.top - c.bottom)
  // Center offset in the media's LOCAL (unrotated) frame, then rotated into canvas space.
  const ox = (r.w * (c.left - c.right)) / 2
  const oy = (r.h * (c.top - c.bottom)) / 2
  const rad = (r.rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    cx: r.cx + ox * cos - oy * sin,
    cy: r.cy + ox * sin + oy * cos,
    w,
    h,
    rotationDeg: r.rotationDeg,
    crop: NO_CROP,
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
