import { describe, expect, it } from 'vitest'
import {
  clipAtTime,
  clipIsLiveAt,
  clipSourceLen,
  freeTrimWindow,
  insertionIndex,
  mediaClips,
  overlayTracks,
  resolveTrim,
  snapTargets,
  snapTime,
  trimToTimeWindow,
} from './selectors'
import { createProject, createTextClip, createTrack } from './factories'
import { IDENTITY } from '@/lib/transform'
import type { Clip, MediaAsset, Track } from './types'

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

function asset(id: string, durationSec: number): MediaAsset {
  return {
    id,
    kind: 'video',
    name: id,
    sizeBytes: 1,
    file: new File([], id),
    url: 'blob:x',
    naturalWidth: 16,
    naturalHeight: 9,
    durationSec,
    thumbs: [],
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

describe('clipAtTime', () => {
  const track: Track = {
    id: 'tr',
    type: 'video',
    clips: [clip('a', 0, 5), clip('b', 5, 3)],
  }

  it('finds the clip covering a time', () => {
    expect(clipAtTime(track, 2)?.id).toBe('a')
    expect(clipAtTime(track, 6)?.id).toBe('b')
  })

  it('is half-open — the LATER clip wins at a packed boundary', () => {
    // Same rule as clipIsLiveAt, so split-at-the-playhead agrees with what the
    // preview is actually showing at that instant.
    expect(clipAtTime(track, 5)?.id).toBe('b')
  })

  it('returns null past the end and on an empty track', () => {
    expect(clipAtTime(track, 8)).toBeNull()
    expect(clipAtTime({ id: 'e', type: 'video', clips: [] }, 0)).toBeNull()
  })
})

describe('clipSourceLen', () => {
  it('bounds a video by its asset duration', () => {
    const project = createProject('t')
    project.assets.a1 = asset('a1', 12)
    expect(
      clipSourceLen(project, {
        ...clip('c', 0, 5),
        type: 'video',
        assetId: 'a1',
      }),
    ).toBe(12)
  })

  it('leaves a still UNBOUNDED — it has no source timeline', () => {
    const project = createProject('t')
    project.assets.a1 = asset('a1', 12)
    expect(
      clipSourceLen(project, {
        ...clip('c', 0, 5),
        type: 'image',
        assetId: 'a1',
      }),
    ).toBe(Number.POSITIVE_INFINITY)
  })

  it('is unbounded when the asset is unknown', () => {
    expect(
      clipSourceLen(createProject('t'), {
        ...clip('c', 0, 5),
        type: 'video',
        assetId: 'gone',
      }),
    ).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('trimToTimeWindow', () => {
  const c = { ...clip('c', 10, 6), trimIn: 2 }

  it('trims the HEAD up to the playhead, moving start with it', () => {
    // t=13 is 3s into a clip starting at 10: 3s comes off the head.
    const next = trimToTimeWindow('left', c, 13, Number.POSITIVE_INFINITY, 0.1)
    expect(next).toEqual({ start: 13, trimIn: 5, duration: 3 })
  })

  it('trims the TAIL to the playhead, leaving start alone', () => {
    const next = trimToTimeWindow('right', c, 13, Number.POSITIVE_INFINITY, 0.1)
    expect(next).toEqual({ start: 10, trimIn: 2, duration: 3 })
  })

  it('refuses a cut ON either edge — there is nothing to trim', () => {
    for (const edge of ['left', 'right'] as const) {
      expect(
        trimToTimeWindow(edge, c, 10, Number.POSITIVE_INFINITY, 0.1),
      ).toBeNull()
      expect(
        trimToTimeWindow(edge, c, 16, Number.POSITIVE_INFINITY, 0.1),
      ).toBeNull()
    }
  })

  it('refuses a cut outside the clip entirely', () => {
    expect(
      trimToTimeWindow('left', c, 2, Number.POSITIVE_INFINITY, 0.1),
    ).toBeNull()
    expect(
      trimToTimeWindow('right', c, 99, Number.POSITIVE_INFINITY, 0.1),
    ).toBeNull()
  })

  it('inherits the minimum-duration clamp rather than restating it', () => {
    // A head trim to 15.99 would leave 0.01s; the shared clamp holds it at 1.
    const next = trimToTimeWindow('left', c, 15.99, Number.POSITIVE_INFINITY, 1)
    expect(next?.duration).toBeCloseTo(1)
  })
})
