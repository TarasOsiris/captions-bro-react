// Timeline ↔ pixel geometry, in one place. `TRACK_PAD + t * PX_PER_SEC` used to
// be restated at six sites in Timeline.tsx (clip left, boundary caret, playhead,
// ticks, lane drop outline, seam bar) plus two near-identical clientX→time
// functions that differed only in how they clamped.
//
// Every function takes `pxPerSec` EXPLICITLY, with no default. A default is how
// a call site survives the switch to a zoomable timeline while still measuring
// at the old fixed scale — silently, and only visibly once you zoom. See
// ./zoom.ts for the bounds and the scroll arithmetic.

/** Horizontal inset (px) so overhanging clip chrome stays on-screen at scroll ends. */
export const TRACK_PAD = 24

/** Labels must stay at least this far apart for a tick to be a MAJOR one. */
const MIN_LABEL_PX = 56

/** Seconds → x offset (px) inside the scroll content. */
export function timeToX(t: number, pxPerSec: number): number {
  return TRACK_PAD + t * pxPerSec
}

/** x offset (px) inside the scroll content → seconds, floored at 0. */
export function xToTime(x: number, pxPerSec: number): number {
  return Math.max(0, (x - TRACK_PAD) / pxPerSec)
}

/**
 * Major-tick spacing (s) — smallest that keeps labels ≥MIN_LABEL_PX apart.
 *
 * The ladder runs SUB-SECOND at the top: zoomed all the way in, whole-second
 * labels would sit ~500px apart and the ruler would read as almost blank.
 */
export function tickStep(pxPerSec: number): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  for (const s of steps) {
    if (s * pxPerSec >= MIN_LABEL_PX) return s
  }
  return 1800
}

export interface Tick {
  t: number
  major: boolean
}

/**
 * The ticks visible in the x range `[fromX, toX)` of the scroll content, minor
 * ticks at a fifth of the major step and every fifth one major (and labelled).
 *
 * VIRTUALIZED by x range rather than emitting the whole content width: at
 * 400px/s a 60-second project is 24 000px, i.e. ~2 100 absolutely-positioned
 * spans, rebuilt on every zoom step. Bounding the count by the VIEWPORT keeps
 * that flat at any scale.
 *
 * Ticks stay aligned to ABSOLUTE time (indices are derived from `fromX`, not
 * counted from it), so scrolling doesn't make the major ticks crawl.
 */
export function tickModel(
  fromX: number,
  toX: number,
  pxPerSec: number,
): Tick[] {
  if (!(pxPerSec > 0) || !(toX > fromX)) return []
  const minorStep = tickStep(pxPerSec) / 5
  const fromT = Math.max(0, (fromX - TRACK_PAD) / pxPerSec)
  const toT = (toX - TRACK_PAD) / pxPerSec
  if (!(toT >= 0)) return []
  // One minor step of margin each side, so a tick partly scrolled in still draws.
  const first = Math.max(0, Math.floor(fromT / minorStep) - 1)
  const last = Math.ceil(toT / minorStep) + 1
  const ticks: Tick[] = []
  for (let i = first; i <= last; i++) {
    ticks.push({ t: i * minorStep, major: i % 5 === 0 })
  }
  return ticks
}
