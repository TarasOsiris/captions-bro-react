// The drag-drop rules CLAUDE.md describes in prose ("a drop onto occupied time
// stacks onto a new lane instead", "text never joins the magnetic track") — the
// largest body of previously untested domain logic in the app.

import { describe, expect, it } from 'vitest'
import {
  SEAM_OFFSET_PX,
  classifyLaneZone,
  resolveAssetDrop,
  resolveClipDrop,
  sameDropTarget,
} from './dropResolver'
import { createTextClip, createTrack } from '@/lib/model/factories'
import { IDENTITY } from '@/lib/transform'
import type { LaneRect } from './dropResolver'
import type { Clip, Track } from '@/lib/model/types'

function mediaClip(id: string, start: number, duration: number): Clip {
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

function textClip(id: string, start: number, duration: number): Clip {
  return { ...createTextClip({ start, duration }), id }
}

function main(clips: Clip[]): Track {
  const t = createTrack('video')
  t.clips = clips
  return t
}

function lane(clips: Clip[]): Track {
  const t = createTrack('overlay')
  t.clips = clips
  return t
}

/** Lanes in DOCUMENT order (bottom-up), laid out 100px tall with 10px gaps. */
function stack(tracks: Track[]): LaneRect[] {
  // Document order is bottom-up on screen, so the LAST track is highest =
  // smallest `top`.
  return tracks.map((track, i) => {
    const fromTop = tracks.length - 1 - i
    return { track, top: fromTop * 110, bottom: fromTop * 110 + 100 }
  })
}

describe('classifyLaneZone', () => {
  const mainTrack = main([mediaClip('a', 0, 5)])
  const laneTrack = lane([textClip('t', 0, 2)])
  const lanes = stack([mainTrack, laneTrack]) // lane on top, main below

  it('classifies the magnetic track as `main`', () => {
    const zone = classifyLaneZone(lanes, 160, 0) // inside main [110,210]
    expect(zone).toMatchObject({ kind: 'main' })
  })

  it('classifies an overlay track as `lane`', () => {
    const zone = classifyLaneZone(lanes, 50, 0) // inside lane [0,100]
    expect(zone).toMatchObject({ kind: 'lane' })
  })

  it('the gap BETWEEN lanes is a seam above the lower one', () => {
    const zone = classifyLaneZone(lanes, 105, 0) // in the 100→110 gap
    expect(zone).toMatchObject({ kind: 'seam', belowTrackId: mainTrack.id })
  })

  it('above the whole stack is a seam above the topmost lane', () => {
    const zone = classifyLaneZone(lanes, -50, 0)
    expect(zone).toMatchObject({ kind: 'seam', belowTrackId: laneTrack.id })
  })

  it('below the bottom lane still targets it — a drag off the end is not a miss', () => {
    const zone = classifyLaneZone(lanes, 9999, 0)
    expect(zone).toMatchObject({ kind: 'main' })
  })

  it('reports Y relative to the given origin (scroll-invariance)', () => {
    const zone = classifyLaneZone(lanes, 160, 40)
    expect(zone).toMatchObject({ seamYAbove: 110 - 40 - SEAM_OFFSET_PX })
  })

  it('is null when nothing is rendered yet', () => {
    expect(classifyLaneZone([], 10, 0)).toBeNull()
  })
})

describe('resolveClipDrop', () => {
  const mainTrack = main([mediaClip('a', 0, 4), mediaClip('b', 4, 4)])
  const mainZone = { kind: 'main' as const, track: mainTrack, seamYAbove: 5 }

  it('a media clip over the magnetic track gets an insertion SLOT', () => {
    const target = resolveClipDrop({
      zone: mainZone,
      clip: mainTrack.clips[1],
      sourceTrackId: mainTrack.id,
      snappedStart: 0,
      timeAtPointer: 1,
    })
    expect(target).toMatchObject({ kind: 'main', index: 0 })
  })

  it('the caret ignores the dragged clip’s own width', () => {
    const target = resolveClipDrop({
      zone: mainZone,
      clip: mainTrack.clips[0], // 'a', 4s wide, dragged toward the end
      sourceTrackId: mainTrack.id,
      snappedStart: 0,
      timeAtPointer: 7,
    })
    // With 'a' lifted out, the only remaining boundary before the end is at
    // t=4 (after 'b'), so the caret must be measured on the REMAINING clips.
    expect(target).toMatchObject({ kind: 'main' })
    if (target.kind === 'main') expect(target.caretX).toBeGreaterThan(0)
  })

  it('TEXT over the magnetic track is remapped to a new lane above it', () => {
    const target = resolveClipDrop({
      zone: mainZone,
      clip: textClip('t', 0, 2),
      sourceTrackId: 'somewhere',
      snappedStart: 3,
      timeAtPointer: 3,
    })
    expect(target).toMatchObject({
      kind: 'seam',
      belowTrackId: mainTrack.id,
      start: 3,
    })
  })

  it('a same-lane drag clamps flush against a sibling instead of stacking', () => {
    const laneTrack = lane([textClip('t1', 0, 4), textClip('t2', 8, 2)])
    const target = resolveClipDrop({
      zone: { kind: 'lane', track: laneTrack, seamYAbove: 5 },
      clip: laneTrack.clips[1], // t2 dragged back over t1
      sourceTrackId: laneTrack.id,
      snappedStart: 1,
      timeAtPointer: 1,
    })
    // Desired [1,3) overlaps t1 [0,4) → clamped flush after it, same lane.
    expect(target).toMatchObject({
      kind: 'lane',
      trackId: laneTrack.id,
      start: 4,
    })
  })

  it('a CROSS-lane drop onto occupied time stacks onto a new lane', () => {
    const target = lane([textClip('other', 0, 6)])
    const dropped = resolveClipDrop({
      zone: { kind: 'lane', track: target, seamYAbove: 5 },
      clip: textClip('t', 0, 3),
      sourceTrackId: 'a-different-lane',
      snappedStart: 1,
      timeAtPointer: 1,
    })
    expect(dropped).toMatchObject({ kind: 'seam', belowTrackId: target.id })
  })

  it('a CROSS-lane drop onto free time lands on that lane', () => {
    const target = lane([textClip('other', 0, 2)])
    const dropped = resolveClipDrop({
      zone: { kind: 'lane', track: target, seamYAbove: 5 },
      clip: textClip('t', 0, 3),
      sourceTrackId: 'a-different-lane',
      snappedStart: 5,
      timeAtPointer: 5,
    })
    expect(dropped).toMatchObject({
      kind: 'lane',
      trackId: target.id,
      start: 5,
    })
  })

  it('a seam zone passes the snapped start straight through', () => {
    const dropped = resolveClipDrop({
      zone: { kind: 'seam', belowTrackId: 'below', seamY: 12 },
      clip: textClip('t', 0, 3),
      sourceTrackId: 'x',
      snappedStart: 7.5,
      timeAtPointer: 7.5,
    })
    expect(dropped).toEqual({
      kind: 'seam',
      belowTrackId: 'below',
      seamY: 12,
      start: 7.5,
    })
  })
})

describe('resolveAssetDrop', () => {
  const mainTrack = main([mediaClip('a', 0, 4)])

  it('no zone (nothing rendered) falls back to the magnetic track', () => {
    const target = resolveAssetDrop({
      zone: null,
      mainTrack,
      duration: 3,
      snappedStart: 0,
      timeAtPointer: 2,
    })
    expect(target).toMatchObject({ kind: 'main', trackId: mainTrack.id })
  })

  it('an occupied lane stacks a new lane above it', () => {
    const laneTrack = lane([textClip('t', 0, 5)])
    const target = resolveAssetDrop({
      zone: { kind: 'lane', track: laneTrack, seamYAbove: 5 },
      mainTrack,
      duration: 3,
      snappedStart: 1,
      timeAtPointer: 1,
    })
    expect(target).toMatchObject({ kind: 'seam', belowTrackId: laneTrack.id })
  })

  it('a free lane takes the clip at the snapped start', () => {
    const laneTrack = lane([textClip('t', 0, 2)])
    const target = resolveAssetDrop({
      zone: { kind: 'lane', track: laneTrack, seamYAbove: 5 },
      mainTrack,
      duration: 3,
      snappedStart: 4,
      timeAtPointer: 4,
    })
    expect(target).toMatchObject({ kind: 'lane', start: 4, duration: 3 })
  })
})

describe('sameDropTarget', () => {
  it('is true for equal values — so the indicator keeps its identity', () => {
    const a = { kind: 'lane' as const, trackId: 'l', start: 2, duration: 3 }
    expect(sameDropTarget(a, { ...a })).toBe(true)
  })

  it('distinguishes a changed field', () => {
    const a = { kind: 'lane' as const, trackId: 'l', start: 2, duration: 3 }
    expect(sameDropTarget(a, { ...a, start: 2.5 })).toBe(false)
  })

  it('distinguishes kinds and handles null', () => {
    expect(sameDropTarget(null, null)).toBe(true)
    expect(
      sameDropTarget(null, {
        kind: 'main',
        trackId: 'm',
        index: 0,
        caretX: 24,
      }),
    ).toBe(false)
    expect(
      sameDropTarget(
        { kind: 'main', trackId: 'm', index: 0, caretX: 24 },
        { kind: 'seam', belowTrackId: 'm', seamY: 1, start: 0 },
      ),
    ).toBe(false)
  })
})
