import { describe, expect, it } from 'vitest'
import {
  clampTrimToLane,
  laneHasRoom,
  normalizeLaneOverlaps,
  pickOverlayLane,
  resolveLaneStart,
} from './lanes'
import { createProject, createTrack } from './factories'
import { IDENTITY } from '@/lib/transform'
import type { Clip, Track } from './types'

function clip(id: string, start: number, duration: number): Clip {
  return {
    id,
    type: 'text',
    assetId: null,
    start,
    duration,
    trimIn: 0,
    transform: { ...IDENTITY },
  }
}

function overlay(...clips: Clip[]): Track {
  const t = createTrack('overlay')
  t.clips = clips
  return t
}

describe('laneHasRoom', () => {
  // Lane: A[1,4) B[6,9).
  const clips = [clip('a', 1, 3), clip('b', 6, 3)]

  it('accepts a window inside a gap', () => {
    expect(laneHasRoom(clips, 4, 2)).toBe(true)
  })

  it('rejects any overlap with an occupant', () => {
    expect(laneHasRoom(clips, 3, 2)).toBe(false)
    expect(laneHasRoom(clips, 0, 2)).toBe(false)
    expect(laneHasRoom(clips, 2, 1)).toBe(false)
  })

  it('is half-open: touching edges are legal', () => {
    expect(laneHasRoom(clips, 4, 2)).toBe(true) // flush A-end to B-start
    expect(laneHasRoom(clips, 9, 5)).toBe(true) // flush against B's end
    expect(laneHasRoom(clips, 0, 1)).toBe(true) // flush against A's start
  })

  it('ignores the excluded clip (the one being moved)', () => {
    expect(laneHasRoom(clips, 2, 2, 'a')).toBe(true)
  })

  it('is trivially true on an empty lane', () => {
    expect(laneHasRoom([], 3, 100)).toBe(true)
  })
})

describe('resolveLaneStart', () => {
  // Lane: A[2,5) B[6,9) — gaps [0,2) [5,6) and the tail from 9.
  const clips = [clip('a', 2, 3), clip('b', 6, 3)]

  it('returns the desired start on an empty lane, floored at 0', () => {
    expect(resolveLaneStart([], 3.2, 4)).toBe(3.2)
    expect(resolveLaneStart([], -1, 4)).toBe(0)
  })

  it('keeps a start that already fits', () => {
    expect(resolveLaneStart(clips, 0.5, 1)).toBe(0.5)
  })

  it('clamps flush against the neighbour when the drag overshoots', () => {
    // Desired 1.5 with a 1s clip overlaps A → pinned to A.start - duration.
    expect(resolveLaneStart(clips, 1.5, 1)).toBe(1)
    // Desired 4 in the [5,6) gap territory → flush after A.
    expect(resolveLaneStart(clips, 4, 1)).toBe(5)
  })

  it('skips a too-small gap for the nearest one that fits', () => {
    // A 2s clip cannot fit the [5,6) gap; the fitting starts are 0 and 9+.
    expect(resolveLaneStart(clips, 1, 2)).toBe(0)
    expect(resolveLaneStart(clips, 5.2, 2)).toBe(9)
  })

  it('uses the unbounded tail past the last clip', () => {
    expect(resolveLaneStart(clips, 42, 10)).toBe(42)
  })

  it('excludes the moved clip from the occupancy map', () => {
    // Moving A itself: its old window is free, so a small shift stays exact.
    expect(resolveLaneStart(clips, 2.5, 3, 'a')).toBe(2.5)
  })

  it('survives legacy overlapping occupants without fabricating a gap', () => {
    // A[0,4) and B[2,6) overlap (pre-normalization data); the span [0,6) is
    // taken, so a 1s clip desired at 3 lands flush at 6.
    const messy = [clip('a', 0, 4), clip('b', 2, 4)]
    expect(resolveLaneStart(messy, 3, 1)).toBe(6)
  })
})

describe('clampTrimToLane', () => {
  // Lane: L[0,2) SELF[4,7) R[9,11).
  const clips = [clip('l', 0, 2), clip('self', 4, 3), clip('r', 9, 2)]

  it('passes through a window already inside the free span', () => {
    const next = { start: 3, trimIn: 0, duration: 5 }
    expect(clampTrimToLane(clips, 'self', next)).toEqual(next)
  })

  it('shaves the head at the left neighbour, advancing trimIn with start', () => {
    // Head un-trim overshoots to start 1 → pinned at L's end (2); the shaved
    // second comes back off trimIn and duration.
    expect(
      clampTrimToLane(clips, 'self', { start: 1, trimIn: 0, duration: 6 }),
    ).toEqual({ start: 2, trimIn: 1, duration: 5 })
  })

  it('shaves the tail at the right neighbour', () => {
    expect(
      clampTrimToLane(clips, 'self', { start: 4, trimIn: 0, duration: 8 }),
    ).toEqual({ start: 4, trimIn: 0, duration: 5 })
  })

  it('clamps the head at t=0 when there is no left neighbour', () => {
    expect(
      clampTrimToLane([clip('self', 1, 2)], 'self', {
        start: -1,
        trimIn: 0,
        duration: 4,
      }),
    ).toEqual({ start: 0, trimIn: 1, duration: 3 })
  })

  it('returns the proposal untouched for an unknown clip', () => {
    const next = { start: -5, trimIn: 0, duration: 100 }
    expect(clampTrimToLane(clips, 'ghost', next)).toEqual(next)
  })
})

describe('pickOverlayLane', () => {
  it('is null when no overlay lane exists', () => {
    expect(pickOverlayLane(createProject('t'), 0, 4)).toBeNull()
  })

  it('picks the lowest lane with room, bottom-up', () => {
    const p = createProject('t')
    const low = overlay(clip('a', 0, 5))
    const high = overlay()
    p.tracks.push(low, high)
    expect(pickOverlayLane(p, 6, 4)).toBe(low.id) // fits below → stays low
    expect(pickOverlayLane(p, 2, 4)).toBe(high.id) // blocked below → bumps up
  })

  it('is null when every lane is blocked', () => {
    const p = createProject('t')
    p.tracks.push(overlay(clip('a', 0, 5)), overlay(clip('b', 2, 5)))
    expect(pickOverlayLane(p, 3, 2)).toBeNull()
  })
})

describe('normalizeLaneOverlaps — hydration of pre-lane documents', () => {
  it('returns the very same project when every lane is clean', () => {
    const p = createProject('t')
    p.tracks.push(overlay(clip('a', 0, 3), clip('b', 3, 3)))
    expect(normalizeLaneOverlaps(p)).toBe(p)
  })

  it('bumps an overlapping clip to a fresh lane on top', () => {
    const p = createProject('t')
    p.tracks.push(overlay(clip('a', 0, 4), clip('b', 2, 4)))
    const out = normalizeLaneOverlaps(p)
    expect(out.tracks).toHaveLength(3)
    expect(out.tracks[1].clips.map((c) => c.id)).toEqual(['a'])
    expect(out.tracks[2].type).toBe('overlay')
    expect(out.tracks[2].clips.map((c) => c.id)).toEqual(['b'])
  })

  it('leaves clean higher lanes untouched — displaced clips go to fresh lanes', () => {
    const p = createProject('t')
    p.tracks.push(
      overlay(clip('a', 0, 4), clip('b', 2, 4)),
      overlay(clip('c', 10, 2)),
    )
    const out = normalizeLaneOverlaps(p)
    expect(out.tracks).toHaveLength(4)
    expect(out.tracks[2].clips.map((c) => c.id)).toEqual(['c'])
    expect(out.tracks[3].clips.map((c) => c.id)).toEqual(['b'])
  })

  it('never displaces a higher lane original for a displaced clip', () => {
    const p = createProject('t')
    p.tracks.push(
      overlay(clip('a', 0, 4), clip('b', 2, 4)),
      overlay(clip('c', 3, 2)),
    )
    const out = normalizeLaneOverlaps(p)
    // b would collide with c too — it must land on a fresh lane, not push c.
    expect(out.tracks).toHaveLength(4)
    expect(out.tracks[2].clips.map((c) => c.id)).toEqual(['c'])
    expect(out.tracks[3].clips.map((c) => c.id)).toEqual(['b'])
  })

  it('cascades a pile-up across as many new lanes as it takes', () => {
    const p = createProject('t')
    p.tracks.push(overlay(clip('a', 0, 4), clip('b', 1, 4), clip('c', 2, 4)))
    const out = normalizeLaneOverlaps(p)
    expect(out.tracks).toHaveLength(4)
    expect(out.tracks[1].clips.map((c) => c.id)).toEqual(['a'])
    expect(out.tracks[2].clips.map((c) => c.id)).toEqual(['b'])
    expect(out.tracks[3].clips.map((c) => c.id)).toEqual(['c'])
  })

  it('keeps timings untouched — only lane membership changes', () => {
    const p = createProject('t')
    const b = clip('b', 2, 4)
    p.tracks.push(overlay(clip('a', 0, 4), b))
    const out = normalizeLaneOverlaps(p)
    const moved = out.tracks[2].clips[0]
    expect(moved.start).toBe(2)
    expect(moved.duration).toBe(4)
    expect(moved.id).toBe(b.id)
  })
})
