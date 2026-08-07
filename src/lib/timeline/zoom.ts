// Timeline scale, pure. The px-per-second the ruler, the clips and every drag
// measure against used to be the module constant `TIMELINE_PX_PER_SEC`; it is
// now a value threaded from `uiSlice`, and this module owns its bounds and the
// scroll arithmetic a zoom has to do to feel anchored.
//
// Zoom lives in the UI slice, NOT in `Project`: it is chrome, so putting it in
// the document would make it undoable, persist it into saved files, and dirty
// the autosave on every pinch.

import { clamp } from '@/lib/math'
import { TRACK_PAD, timeToX } from './ruler'

/** Zoomed all the way out: ~30 minutes across a laptop viewport. */
export const MIN_PX_PER_SEC = 2
/** Zoomed all the way in: ~16px per frame at 30fps — frame-accurate trimming. */
export const MAX_PX_PER_SEC = 500
/** The scale the timeline has always rendered at; still the default. */
export const DEFAULT_PX_PER_SEC = 40
/** One click of the +/− buttons, and one keyboard step. */
export const ZOOM_STEP = 1.5
/** Ceiling on the snap tolerance, in seconds — see `snapToleranceSec`. */
const MAX_SNAP_SEC = 0.5

export function clampZoom(pxPerSec: number): number {
  if (!Number.isFinite(pxPerSec)) return DEFAULT_PX_PER_SEC
  return clamp(pxPerSec, MIN_PX_PER_SEC, MAX_PX_PER_SEC)
}

/** Multiply the scale, clamped. `factor > 1` zooms in. */
export function zoomBy(pxPerSec: number, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return clampZoom(pxPerSec)
  return clampZoom(pxPerSec * factor)
}

/**
 * The scale that fits `durationSec` into `viewportWidth`.
 *
 * Never zooms IN past the default: "Fit" on a 3-second project should show a
 * normal-looking timeline, not one stretched to 400px/s. An empty project fits
 * at the default rather than at MIN (or at Infinity).
 */
export function fitZoom(durationSec: number, viewportWidth: number): number {
  const usable = viewportWidth - 2 * TRACK_PAD
  if (!(durationSec > 0) || !(usable > 0)) return DEFAULT_PX_PER_SEC
  return clamp(usable / durationSec, MIN_PX_PER_SEC, DEFAULT_PX_PER_SEC)
}

/**
 * The `scrollLeft` that keeps `anchorTime` under `anchorViewportX` at the NEW
 * scale — what makes zooming feel like it happens around the playhead (or the
 * viewport centre) rather than yanking the content back to t=0.
 */
export function anchorScrollLeft(
  anchorTime: number,
  anchorViewportX: number,
  pxPerSec: number,
): number {
  return Math.max(0, timeToX(anchorTime, pxPerSec) - anchorViewportX)
}

/**
 * The time a zoom should pivot around: the playhead when it is on screen, else
 * the viewport centre. Zooming while the playhead is parked off-screen should
 * expand what you are LOOKING at, not jump to the playhead.
 */
export function zoomAnchorTime(opts: {
  scrollLeft: number
  viewportWidth: number
  playheadTime: number
  pxPerSec: number
}): number {
  const { scrollLeft, viewportWidth, playheadTime, pxPerSec } = opts
  const playheadX = timeToX(playheadTime, pxPerSec)
  const onScreen =
    playheadX >= scrollLeft && playheadX <= scrollLeft + viewportWidth
  if (onScreen) return playheadTime
  return Math.max(0, (scrollLeft + viewportWidth / 2 - TRACK_PAD) / pxPerSec)
}

/**
 * How near (in SECONDS) a dragged edge must come to a snap target before it
 * engages, at the given scale.
 *
 * Constant in PIXELS, so the snap feels identical at every zoom and simply
 * means a finer time tolerance as you zoom in. Capped, because zoomed all the
 * way out those same pixels are many seconds and a drag would teleport to a
 * distant edge.
 */
export function snapToleranceSec(pxPerSec: number, snapPx: number): number {
  if (!(pxPerSec > 0)) return MAX_SNAP_SEC
  return Math.min(snapPx / pxPerSec, MAX_SNAP_SEC)
}
