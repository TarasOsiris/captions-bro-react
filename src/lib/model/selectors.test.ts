import { describe, expect, it } from 'vitest'
import { insertionIndex, resolveTrim } from './selectors'
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
