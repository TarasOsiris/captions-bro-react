import { describe, expect, it } from 'vitest'
import { insertionIndex } from './selectors'
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
