// Lane geometry for free-positioned (overlay) tracks — the CapCut model: clips
// on one lane never overlap in time; overlap is resolved by stacking onto
// another lane instead. All pure, so the store's clamping and the timeline's
// drop preview share one definition and cannot disagree.
//
// Windows are half-open [start, start+duration), matching `clipIsLiveAt`, so
// clips that merely touch are legal neighbours.

import { clamp } from '@/lib/math'
import { createTrack } from './factories'
import { overlayTracks } from './selectors'
import type { Clip, Project } from './types'

/** Whether `[start, start+duration)` fits on the lane without overlapping any
 *  clip (except `excludeId` — the clip being moved). */
export function laneHasRoom(
  clips: Clip[],
  start: number,
  duration: number,
  excludeId?: string,
): boolean {
  const end = start + duration
  return clips.every(
    (c) =>
      c.id === excludeId || c.start + c.duration <= start || c.start >= end,
  )
}

/** The legal start nearest `desiredStart` for a `duration`-long clip on the
 *  lane: enumerate the free gaps (including `[0, first)` and the unbounded
 *  tail), keep those that fit, clamp the desired start into each and take the
 *  closest candidate. Always succeeds — the tail gap is infinite. This yields
 *  both CapCut behaviours at once: a drag stops flush against a neighbour, and
 *  a too-small gap is skipped for the next one. */
export function resolveLaneStart(
  clips: Clip[],
  desiredStart: number,
  duration: number,
  excludeId?: string,
): number {
  const desired = Math.max(0, desiredStart)
  const occupied = clips
    .filter((c) => c.id !== excludeId)
    .map((c) => ({ start: c.start, end: c.start + c.duration }))
    .sort((a, b) => a.start - b.start)

  // One candidate per gap that fits: the desired start clamped into it. The
  // unbounded tail always contributes, so the list is never empty.
  const candidates: number[] = []
  const consider = (lo: number, hi: number) => {
    if (hi - lo >= duration) candidates.push(clamp(desired, lo, hi - duration))
  }

  let gapStart = 0
  for (const w of occupied) {
    consider(gapStart, w.start)
    // max() so legacy overlapping windows (pre-normalization data) can't walk
    // the cursor backwards and fabricate a gap inside an occupied span.
    gapStart = Math.max(gapStart, w.end)
  }
  consider(gapStart, Infinity)
  return candidates.reduce((a, b) =>
    Math.abs(b - desired) < Math.abs(a - desired) ? b : a,
  )
}

/** Bound a proposed trim window to the free span between the clip's CURRENT
 *  lane neighbours, so an outward edge drag stops flush at them. Shaving the
 *  head keeps the source in sync (`trimIn` advances with `start`, as
 *  `resolveTrim` does); shaving the tail just shortens `duration`. */
export function clampTrimToLane(
  clips: Clip[],
  clipId: string,
  next: { start: number; trimIn: number; duration: number },
): { start: number; trimIn: number; duration: number } {
  const self = clips.find((c) => c.id === clipId)
  if (!self) return next

  let lo = 0
  let hi = Infinity
  for (const c of clips) {
    if (c.id === clipId) continue
    const end = c.start + c.duration
    if (end <= self.start) lo = Math.max(lo, end)
    if (c.start >= self.start + self.duration) hi = Math.min(hi, c.start)
  }

  let { start, trimIn, duration } = next
  if (start < lo) {
    const shaved = lo - start
    start = lo
    trimIn += shaved
    duration -= shaved
  }
  if (start + duration > hi) duration = hi - start
  return { start, trimIn, duration }
}

/** The lowest overlay lane with room for `[start, start+duration)`, or null if
 *  none fits (the caller then creates a new lane on top). Bottom-up, so text
 *  fills existing lanes before the stack grows. */
export function pickOverlayLane(
  project: Project,
  start: number,
  duration: number,
): string | null {
  for (const track of overlayTracks(project)) {
    if (laneHasRoom(track.clips, start, duration)) return track.id
  }
  return null
}

function hasLaneOverlap(clips: Clip[]): boolean {
  const sorted = [...clips].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].start + sorted[i - 1].duration > sorted[i].start) {
      return true
    }
  }
  return false
}

/**
 * One-time hydration migration for documents saved before lanes stopped
 * overlapping (which all had a single overlay track): per lane, clips by
 * start, the first claimant of a span keeps it and every overlapper cascades
 * onto fresh lanes appended on top (first with room, else a new one). Returns
 * the project untouched when every lane is already clean — the common case.
 */
export function normalizeLaneOverlaps(project: Project): Project {
  const overlays = overlayTracks(project)
  if (!overlays.some((t) => hasLaneOverlap(t.clips))) return project

  const extras: Clip[][] = []
  const cleaned = new Map<string, Clip[]>()
  for (const lane of overlays) {
    const kept: Clip[] = []
    for (const clip of [...lane.clips].sort((a, b) => a.start - b.start)) {
      if (laneHasRoom(kept, clip.start, clip.duration)) {
        kept.push(clip)
      } else {
        const extra = extras.find((clips) =>
          laneHasRoom(clips, clip.start, clip.duration),
        )
        if (extra) extra.push(clip)
        else extras.push([clip])
      }
    }
    cleaned.set(lane.id, kept)
  }

  return {
    ...project,
    tracks: [
      ...project.tracks.map((t) =>
        t.type === 'overlay' ? { ...t, clips: cleaned.get(t.id)! } : t,
      ),
      ...extras.map((clips) => ({ ...createTrack('overlay'), clips })),
    ],
  }
}
