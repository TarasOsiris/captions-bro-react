import { describe, expect, it } from 'vitest'
import {
  clipIsLiveAt,
  freeTrimWindow,
  insertionIndex,
  mediaClips,
  overlayTracks,
  resolveTrim,
  snapTargets,
  snapTime,
} from './selectors'
import { createProject, createTextClip, createTrack } from './factories'
import { IDENTITY } from '@/lib/transform'
import type { Clip } from './types'

function clip(id: string, start: number, duration: number): Clip {
  return {
    id,
    type: 'video',
    assetId: `asset_${id}`,
    start,
    duration,
    trimIn: 0,
    transform: { ...IDENTITY },
  }
}

describe('insertionIndex', () => {
  // Packed track: A[0,5) B[5,8) C[8,12) — midpoints 2.5, 6.5, 10.
  const clips = [clip('a', 0, 5), clip('b', 5, 3), clip('c', 8, 4)]

  it('is 0 before the first clip midpoint', () => {
    expect(insertionIndex(clips, 1)).toBe(0)
  })

  it('counts clips whose midpoint is at or before the time', () => {
    expect(insertionIndex(clips, 3)).toBe(1) // past A's midpoint (2.5)
    expect(insertionIndex(clips, 7)).toBe(2) // past A and B midpoints
  })

  it('is length past the last clip', () => {
    expect(insertionIndex(clips, 100)).toBe(3)
  })

  it('ignores the excluded clip (reposition case)', () => {
    // Exclude B; only A's midpoint (2.5) is ≤ 7, C's (10) is not.
    expect(insertionIndex(clips, 7, 'b')).toBe(1)
  })

  it('treats a midpoint hit as inclusive', () => {
    expect(insertionIndex(clips, 2.5)).toBe(1)
  })
})

describe('resolveTrim', () => {
  const MIN = 0.1

  it('extends the right edge, bounded by the source end', () => {
    // trimIn 2, dur 5 → out-point at source 7; source is 10 → max dur 8.
    expect(
      resolveTrim('right', { trimIn: 2, duration: 5 }, 3, 10, MIN),
    ).toEqual({
      trimIn: 2,
      duration: 8,
    })
    expect(
      resolveTrim('right', { trimIn: 2, duration: 5 }, 5, 10, MIN).duration,
    ).toBe(8) // clamped to source end, not 10
  })

  it('shrinks the right edge no smaller than the minimum', () => {
    expect(
      resolveTrim('right', { trimIn: 0, duration: 5 }, -10, Infinity, MIN)
        .duration,
    ).toBeCloseTo(MIN)
  })

  it('trims the head: trimIn up, duration down', () => {
    expect(resolveTrim('left', { trimIn: 1, duration: 5 }, 2, 10, MIN)).toEqual(
      {
        trimIn: 3,
        duration: 3,
      },
    )
  })

  it('restores the head no further than trimIn 0', () => {
    expect(
      resolveTrim('left', { trimIn: 1, duration: 5 }, -3, 10, MIN),
    ).toEqual({
      trimIn: 0,
      duration: 6,
    })
  })

  it('is unbounded on the right for a still (Infinity source)', () => {
    expect(
      resolveTrim('right', { trimIn: 0, duration: 5 }, 100, Infinity, MIN)
        .duration,
    ).toBe(105)
  })

  it('never snaps an over-long clip shorter on an outward drag', () => {
    // duration (8) already exceeds source (5); dragging outward must not shrink it.
    expect(
      resolveTrim('right', { trimIn: 0, duration: 8 }, 2, 5, MIN).duration,
    ).toBe(8)
  })
})

describe('freeTrimWindow — the free-lane edge-trim window', () => {
  it('moves start with a left trim, keeping the end pinned', () => {
    // [4, 9) trimmed to 3s from the left → [6, 9).
    expect(
      freeTrimWindow(
        'left',
        { start: 4, duration: 5 },
        { trimIn: 2, duration: 3 },
      ),
    ).toEqual({ start: 6, trimIn: 2, duration: 3 })
  })

  it('leaves start alone on a right trim', () => {
    expect(
      freeTrimWindow(
        'right',
        { start: 4, duration: 5 },
        { trimIn: 0, duration: 7 },
      ),
    ).toEqual({ start: 4, trimIn: 0, duration: 7 })
  })
})

describe('overlayTracks', () => {
  it('is empty on a fresh project (lanes are created lazily on insert)', () => {
    expect(overlayTracks(createProject('t'))).toEqual([])
  })

  it('lists overlay lanes in array order — the z-order, bottom first', () => {
    const p = createProject('t')
    const low = createTrack('overlay')
    const high = createTrack('overlay')
    p.tracks.push(low, high)
    expect(overlayTracks(p).map((t) => t.id)).toEqual([low.id, high.id])
  })
})

describe('mediaClips — what the media bin lists', () => {
  it('keeps asset-backed clips and drops generated (text) ones', () => {
    const p = createProject('t')
    p.tracks[0].clips = [clip('a', 0, 5)]
    const overlay = createTrack('overlay')
    overlay.clips = [createTextClip({ start: 1, duration: 3 })]
    p.tracks.push(overlay)
    expect(mediaClips(p).map((c) => c.id)).toEqual(['a'])
  })
})

describe('snapTargets / snapTime — the free-positioned overlay drag', () => {
  it('collects 0, the playhead and both edges of every other clip', () => {
    const p = createProject('t')
    p.tracks[0].clips = [clip('a', 0, 5), clip('b', 5, 3)]
    expect(snapTargets(p, 6.5).sort((x, y) => x - y)).toEqual([
      0, 0, 5, 5, 6.5, 8,
    ])
  })

  it('excludes the dragged clip so it cannot snap to itself', () => {
    const p = createProject('t')
    const text = createTextClip({ start: 2, duration: 4 })
    p.tracks[0].clips = [clip('a', 0, 5), text]
    expect(snapTargets(p, 1, text.id)).not.toContain(2)
  })

  it('pulls to the nearest target inside the tolerance', () => {
    expect(snapTime(5.08, [0, 5, 8], 0.15)).toBe(5)
    expect(snapTime(4.9, [0, 5, 8], 0.15)).toBe(5)
  })

  it('leaves a time alone outside the tolerance', () => {
    expect(snapTime(5.4, [0, 5, 8], 0.15)).toBeCloseTo(5.4)
    expect(snapTime(3, [], 0.15)).toBe(3)
  })

  it('picks the closest when two targets are both in range', () => {
    expect(snapTime(5.06, [5, 5.1], 0.15)).toBeCloseTo(5.1)
  })
})

describe('clipIsLiveAt — the live window the export fast path relies on', () => {
  it('is half-open: start inclusive, end exclusive', () => {
    const c = createTextClip({ start: 2, duration: 3 })
    expect(clipIsLiveAt(c, 2)).toBe(true)
    expect(clipIsLiveAt(c, 4.999)).toBe(true)
    expect(clipIsLiveAt(c, 5)).toBe(false)
    expect(clipIsLiveAt(c, 1.99)).toBe(false)
    expect(clipIsLiveAt(c, 5.01)).toBe(false)
  })
})
