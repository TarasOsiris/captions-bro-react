// Timeline ↔ pixel geometry, in one place. `TRACK_PAD + t * PX_PER_SEC` used to
// be restated at six sites in Timeline.tsx (clip left, boundary caret, playhead,
// ticks, lane drop outline, seam bar) plus two near-identical clientX→time
// functions that differed only in how they clamped.

import { TIMELINE_PX_PER_SEC } from '@/lib/thumbs'

/** Horizontal inset (px) so overhanging clip chrome stays on-screen at scroll ends. */
export const TRACK_PAD = 24

/** Labels must stay at least this far apart for a tick to be a MAJOR one. */
const MIN_LABEL_PX = 56

/** Seconds → x offset (px) inside the scroll content. */
export function timeToX(t: number): number {
  return TRACK_PAD + t * TIMELINE_PX_PER_SEC
}

/** x offset (px) inside the scroll content → seconds, floored at 0. */
export function xToTime(x: number): number {
  return Math.max(0, (x - TRACK_PAD) / TIMELINE_PX_PER_SEC)
}

/** X (px) of the boundary before `index` on a packed track — where an inserted
 *  or moved clip's left edge will land. */
export function boundaryX(
  clips: ReadonlyArray<{ duration: number }>,
  index: number,
): number {
  let t = 0
  for (let i = 0; i < index && i < clips.length; i++) t += clips[i].duration
  return timeToX(t)
}

/** Major-tick spacing (s) — smallest that keeps labels ≥MIN_LABEL_PX apart. */
export function tickStep(): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  for (const s of steps) {
    if (s * TIMELINE_PX_PER_SEC >= MIN_LABEL_PX) return s
  }
  return 1800
}

export interface Tick {
  t: number
  major: boolean
}

/** Every tick across a ruler of `width` px: minor ticks at a fifth of the major
 *  step, every fifth one major (and labelled). */
export function tickModel(width: number): Tick[] {
  const minorStep = tickStep() / 5
  const count = Math.floor(width / TIMELINE_PX_PER_SEC / minorStep)
  const ticks: Tick[] = []
  for (let i = 0; i <= count; i++) {
    ticks.push({ t: i * minorStep, major: i % 5 === 0 })
  }
  return ticks
}
