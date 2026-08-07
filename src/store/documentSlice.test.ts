import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './editorStore'
import { createProject, createTextClip } from '@/lib/model/factories'
import { IDENTITY } from '@/lib/transform'
import type { Clip, Project } from '@/lib/model/types'

function clip(id: string, duration: number): Clip {
  return {
    id,
    type: 'video',
    assetId: `asset_${id}`,
    start: 0,
    duration,
    trimIn: 0,
    transform: { ...IDENTITY },
  }
}

/** A project whose single video track holds `clips`, packed from t=0. */
function projectWith(clips: Clip[]): Project {
  const p = createProject('test')
  let t = 0
  for (const c of clips) {
    c.start = t
    t += c.duration
  }
  p.tracks[0].clips = clips
  return p
}

const trackClips = () => useEditorStore.getState().project.tracks[0].clips
const trackId = () => useEditorStore.getState().project.tracks[0].id

/** Assert the track is packed: contiguous from 0, no gaps or overlaps. */
function expectPacked(clips: Clip[]) {
  let t = 0
  for (const c of clips) {
    expect(c.start).toBeCloseTo(t)
    t += c.duration
  }
}

describe('addClipAtIndex', () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .replaceProject(projectWith([clip('a', 5), clip('b', 3)]))
  })

  it('inserts at the index and re-packs the track', () => {
    useEditorStore.getState().addClipAtIndex(clip('n', 2), trackId(), 1)
    const clips = trackClips()
    expect(clips.map((c) => c.id)).toEqual(['a', 'n', 'b'])
    expect(clips.map((c) => c.start)).toEqual([0, 5, 7])
    expectPacked(clips)
  })

  it('appends when the index is past the end', () => {
    useEditorStore.getState().addClipAtIndex(clip('n', 2), trackId(), 99)
    expect(trackClips().map((c) => c.id)).toEqual(['a', 'b', 'n'])
    expectPacked(trackClips())
  })

  it('is a no-op for an unknown track', () => {
    useEditorStore.getState().addClipAtIndex(clip('n', 2), 'nope', 0)
    expect(trackClips().map((c) => c.id)).toEqual(['a', 'b'])
  })
})

describe('moveClipToTrack within the magnetic track (reorder)', () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .replaceProject(projectWith([clip('a', 5), clip('b', 3), clip('c', 4)]))
  })

  it('moves a clip to the front and re-packs', () => {
    useEditorStore.getState().moveClipToTrack('c', trackId(), { index: 0 })
    const clips = trackClips()
    expect(clips.map((c) => c.id)).toEqual(['c', 'a', 'b'])
    expect(clips.map((c) => c.start)).toEqual([0, 4, 9])
    expectPacked(clips)
  })

  it('moves a clip to the end and re-packs', () => {
    useEditorStore.getState().moveClipToTrack('a', trackId(), { index: 2 })
    const clips = trackClips()
    expect(clips.map((c) => c.id)).toEqual(['b', 'c', 'a'])
    expectPacked(clips)
  })

  it('leaves order unchanged when moved to its own slot', () => {
    useEditorStore.getState().moveClipToTrack('b', trackId(), { index: 1 })
    expect(trackClips().map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expectPacked(trackClips())
  })
})

describe('setClipTrimWindow on a magnetic track', () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .replaceProject(projectWith([clip('a', 5), clip('b', 3), clip('c', 4)]))
  })

  it('shortens a clip and ripples the clips after it', () => {
    // Right-trim b: 3 → 2. The proposal's start is ignored — re-pack owns it.
    useEditorStore
      .getState()
      .setClipTrimWindow('b', { start: 5, trimIn: 0, duration: 2 })
    const clips = trackClips()
    expect(clips.map((c) => c.duration)).toEqual([5, 2, 4])
    expect(clips.map((c) => c.start)).toEqual([0, 5, 7]) // c rippled left
    expectPacked(clips)
  })

  it('applies a head trim (trimIn up, duration down) and re-packs', () => {
    // Head-trim a by 2s; the free-lane start (2) must NOT move a packed clip.
    useEditorStore
      .getState()
      .setClipTrimWindow('a', { start: 2, trimIn: 2, duration: 3 })
    const clips = trackClips()
    expect(clips[0].trimIn).toBe(2)
    expect(clips.map((c) => c.duration)).toEqual([3, 3, 4])
    expect(clips.map((c) => c.start)).toEqual([0, 3, 6])
    expectPacked(clips)
  })
})

describe('magnetic-track timing patches re-pack', () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .replaceProject(projectWith([clip('a', 4), clip('b', 3)]))
  })

  it('updateClip re-packs after a duration patch', () => {
    // The real case: a video clip inserted with a placeholder duration learns
    // its true length from metadata (PreviewStage.onVideoMeta) — the sibling
    // must ripple, not overlap.
    useEditorStore.getState().updateClip('a', { duration: 10 })
    const clips = trackClips()
    expect(clips.map((c) => c.start)).toEqual([0, 10])
    expectPacked(clips)
  })

  it('a start patch cannot unpack the magnetic track', () => {
    useEditorStore.getState().updateClip('a', { start: 5 })
    expectPacked(trackClips()) // re-pack owns start; the patch is overridden
  })

  it('setClipWindow re-packs on the magnetic track', () => {
    useEditorStore.getState().setClipWindow('a', 3, 2)
    const clips = trackClips()
    expect(clips.map((c) => c.duration)).toEqual([2, 3])
    expect(clips.map((c) => c.start)).toEqual([0, 2]) // start proposal ignored
    expectPacked(clips)
  })

  it('a non-timing patch does not disturb the pack', () => {
    useEditorStore.getState().updateClip('a', { volume: 0.5 })
    expect(trackClips().map((c) => c.start)).toEqual([0, 4])
  })
})

// ── Overlay (text) tracks: free-positioned, never re-packed ──────────────────
// The magnetic model is right for video and wrong for captions. These tests pin
// the distinction, because a regression in `repackTrack` would silently drag
// every text clip to t=0 the first time a neighbour is trimmed.

const overlay = () =>
  useEditorStore.getState().project.tracks.find((t) => t.type === 'overlay')

function textClip(id: string, start: number, duration: number): Clip {
  return {
    ...createTextClip({ start, duration }),
    id,
  }
}

describe('addOverlayTrack', () => {
  beforeEach(() => {
    useEditorStore.getState().replaceProject(projectWith([clip('a', 5)]))
  })

  it('appends LAST by default, so draw order puts the new lane on top', () => {
    const id = useEditorStore.getState().addOverlayTrack()
    const tracks = useEditorStore.getState().project.tracks
    expect(tracks[tracks.length - 1]).toMatchObject({ id, type: 'overlay' })
  })

  it('creates a NEW lane on every call — lanes are plural', () => {
    const first = useEditorStore.getState().addOverlayTrack()
    const second = useEditorStore.getState().addOverlayTrack()
    expect(first).not.toBe(second)
    expect(
      useEditorStore
        .getState()
        .project.tracks.filter((t) => t.type === 'overlay'),
    ).toHaveLength(2)
  })

  it('splices directly ABOVE `belowTrackId` in the stack', () => {
    const top = useEditorStore.getState().addOverlayTrack()
    const mid = useEditorStore.getState().addOverlayTrack(trackId())
    const order = useEditorStore.getState().project.tracks.map((t) => t.id)
    expect(order).toEqual([trackId(), mid, top])
  })
})

describe('overlay clips are free-positioned', () => {
  let overlayId = ''
  beforeEach(() => {
    useEditorStore.getState().replaceProject(projectWith([clip('a', 5)]))
    overlayId = useEditorStore.getState().addOverlayTrack()
  })

  it('addClip clamps a lane insert into a free gap', () => {
    // The no-overlap invariant holds at EVERY store entry point, not just the
    // policy callers: useClipInsert pre-resolves with the same geometry (the
    // clamp is idempotent for a legal start), so only a buggy or legacy caller
    // ever sees the clamp move a clip.
    useEditorStore.getState().addClip(textClip('t1', 3, 4), overlayId)
    useEditorStore.getState().addClip(textClip('t2', 1, 4), overlayId)
    // Desired [1,5) overlaps t1 [3,7) and 4s does not fit before it → flush
    // after, at 7.
    expect(overlay()!.clips.map((c) => c.start)).toEqual([3, 7])
  })

  it('addClipAtIndex does not re-pack an overlay track', () => {
    useEditorStore.getState().addClip(textClip('t1', 6, 2), overlayId)
    useEditorStore.getState().addClipAtIndex(textClip('t2', 2, 2), overlayId, 0)
    expect(overlay()!.clips.map((c) => c.start)).toEqual([2, 6])
  })

  it('trimming one overlay clip never ripples onto its siblings', () => {
    useEditorStore.getState().addClip(textClip('t1', 2, 4), overlayId)
    useEditorStore.getState().addClip(textClip('t2', 9, 3), overlayId)
    useEditorStore
      .getState()
      .setClipTrimWindow('t1', { start: 2, trimIn: 0, duration: 1 })
    const clips = overlay()!.clips
    expect(clips.map((c) => c.start)).toEqual([2, 9]) // t2 did NOT move
    expect(clips[0].duration).toBe(1)
  })

  it('still packs the video track (the magnetic model is intact)', () => {
    useEditorStore.getState().addClip(textClip('t1', 7, 2), overlayId)
    useEditorStore.getState().addClipAtIndex(clip('n', 2), trackId(), 0)
    expectPacked(trackClips())
    expect(overlay()!.clips[0].start).toBe(7)
  })

  it('setClipWindow sets the window outright, clamped', () => {
    useEditorStore.getState().addClip(textClip('t1', 2, 4), overlayId)
    useEditorStore.getState().setClipWindow('t1', 8, 3)
    expect(overlay()!.clips[0]).toMatchObject({ start: 8, duration: 3 })
    useEditorStore.getState().setClipWindow('t1', -4, 0)
    expect(overlay()!.clips[0].start).toBe(0)
    expect(overlay()!.clips[0].duration).toBeGreaterThan(0)
  })

  it('a same-lane move sets the time without touching the duration', () => {
    useEditorStore.getState().addClip(textClip('t1', 2, 4), overlayId)
    useEditorStore.getState().moveClipToTrack('t1', overlayId, { start: 11.5 })
    expect(overlay()!.clips[0]).toMatchObject({ start: 11.5, duration: 4 })
  })

  it('a same-lane move clamps flush against a sibling instead of overlapping', () => {
    useEditorStore.getState().addClip(textClip('t1', 0, 4), overlayId)
    useEditorStore.getState().addClip(textClip('t2', 6, 2), overlayId)
    useEditorStore.getState().moveClipToTrack('t2', overlayId, { start: 1 })
    // Desired 1 sits over t1 [0,4) → flush at 4.
    expect(overlay()!.clips.find((c) => c.id === 't2')!.start).toBe(4)
  })

  it('setClipWindow clamps the resized window into a free gap', () => {
    useEditorStore.getState().addClip(textClip('t1', 0, 4), overlayId)
    useEditorStore.getState().addClip(textClip('t2', 5, 1), overlayId)
    useEditorStore.getState().setClipWindow('t2', 3, 2) // [3,5) over t1 → at 4
    expect(overlay()!.clips[1]).toMatchObject({ start: 4, duration: 2 })
  })

  it('updateClip re-clamps a lane clip whose timing patch made it overlap', () => {
    // A PiP video learning its real duration from metadata is the real case.
    useEditorStore.getState().addClip(textClip('t1', 0, 4), overlayId)
    useEditorStore.getState().addClip(textClip('t2', 4, 2), overlayId)
    useEditorStore.getState().updateClip('t1', { duration: 6 }) // [0,6) over t2
    expect(overlay()!.clips[0]).toMatchObject({ start: 6, duration: 6 })
  })
})

describe('duplicate / split / remove on an overlay track', () => {
  let overlayId = ''
  beforeEach(() => {
    useEditorStore.getState().replaceProject(projectWith([clip('a', 5)]))
    overlayId = useEditorStore.getState().addOverlayTrack()
    useEditorStore.getState().addClip(textClip('t1', 2, 4), overlayId)
  })

  it('duplicate offsets the copy so it is not hidden under the original', () => {
    const newId = useEditorStore.getState().duplicateClip('t1')
    const clips = overlay()!.clips
    expect(clips).toHaveLength(2)
    expect(clips[1].id).toBe(newId)
    expect(clips[1].start).toBeCloseTo(6) // 2 + 4
    expect(clips[0].start).toBeCloseTo(2) // original untouched
  })

  it('duplicate on a blocked lane lands on a fresh lane directly above', () => {
    // A sibling occupies [6,10) — no room right after t1 [2,6) on this lane.
    useEditorStore.getState().addClip(textClip('t2', 6, 4), overlayId)
    const newId = useEditorStore.getState().duplicateClip('t1')
    const tracks = useEditorStore.getState().project.tracks
    expect(tracks).toHaveLength(3)
    expect(tracks[2].type).toBe('overlay')
    expect(tracks[2].clips.map((c) => c.id)).toEqual([newId])
    expect(tracks[2].clips[0].start).toBeCloseTo(2) // over its source
  })

  it('duplicate gives the copy its own textStyle (no aliasing)', () => {
    useEditorStore.getState().duplicateClip('t1')
    const [a, b] = overlay()!.clips
    expect(a.textStyle).not.toBe(b.textStyle)
    useEditorStore.getState().updateClip(b.id, {
      textStyle: { ...b.textStyle!, fontSize: 0.5 },
    })
    expect(overlay()!.clips[0].textStyle!.fontSize).not.toBe(0.5)
  })

  it('split keeps trimIn at 0 for text (there is no source to advance into)', () => {
    useEditorStore.getState().splitClip('t1', 4)
    const clips = overlay()!.clips
    expect(clips).toHaveLength(2)
    expect(clips.map((c) => c.trimIn)).toEqual([0, 0])
    // t1 spans [2, 6); cutting at 4 gives [2, 4) and [4, 6).
    expect(clips.map((c) => c.start)).toEqual([2, 4])
    expect(clips.map((c) => c.duration)).toEqual([2, 2])
    expect(clips[0].textStyle).not.toBe(clips[1].textStyle)
  })

  it('removing the last overlay clip prunes the empty track', () => {
    useEditorStore.getState().removeClip('t1')
    expect(overlay()).toBeUndefined()
    expect(useEditorStore.getState().project.tracks).toHaveLength(1)
  })

  it('keeps the overlay track while other text clips remain', () => {
    useEditorStore.getState().addClip(textClip('t2', 9, 2), overlayId)
    useEditorStore.getState().removeClip('t1')
    expect(overlay()!.clips.map((c) => c.id)).toEqual(['t2'])
  })
})

describe('removeClip ripples the magnetic track', () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .replaceProject(projectWith([clip('a', 5), clip('b', 3), clip('c', 2)]))
  })

  it('closes the gap left by a middle clip', () => {
    useEditorStore.getState().removeClip('b')
    const clips = trackClips()
    expect(clips.map((c) => c.id)).toEqual(['a', 'c'])
    // The whole point: 'c' slides back to 5, it does not stay at 8.
    expectPacked(clips)
  })

  it('leaves free-lane siblings where they are', () => {
    const laneId = useEditorStore.getState().addOverlayTrack()
    useEditorStore.getState().addClip(textClip('t1', 2, 2), laneId)
    useEditorStore.getState().addClip(textClip('t2', 7, 2), laneId)
    useEditorStore.getState().removeClip('t1')
    const lane = useEditorStore
      .getState()
      .project.tracks.find((t) => t.id === laneId)!
    expect(lane.clips.map((c) => c.start)).toEqual([7])
  })
})

describe('removeClips', () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .replaceProject(projectWith([clip('a', 5), clip('b', 3), clip('c', 2)]))
  })

  it('removes across tracks and re-packs the magnetic one', () => {
    const laneId = useEditorStore.getState().addOverlayTrack()
    useEditorStore.getState().addClip(textClip('t1', 2, 2), laneId)
    useEditorStore.getState().addClip(textClip('t2', 7, 2), laneId)

    useEditorStore.getState().removeClips(['b', 't1'])

    expect(trackClips().map((c) => c.id)).toEqual(['a', 'c'])
    expectPacked(trackClips())
    const lane = useEditorStore
      .getState()
      .project.tracks.find((t) => t.id === laneId)!
    expect(lane.clips.map((c) => c.id)).toEqual(['t2'])
  })

  it('is ONE undo entry however many clips go', () => {
    const before = useEditorStore.getState().undoStack.length
    useEditorStore.getState().beginEdit()
    useEditorStore.getState().removeClips(['a', 'b'])
    expect(useEditorStore.getState().undoStack.length).toBe(before + 1)

    useEditorStore.getState().undo()
    expect(trackClips().map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expectPacked(trackClips())
  })

  it('ignores ids that are not in the document', () => {
    useEditorStore.getState().removeClips(['nope', 'b'])
    expect(trackClips().map((c) => c.id)).toEqual(['a', 'c'])
  })

  it('prunes an overlay lane emptied by the batch', () => {
    const laneId = useEditorStore.getState().addOverlayTrack()
    useEditorStore.getState().addClip(textClip('t1', 2, 2), laneId)
    useEditorStore.getState().addClip(textClip('t2', 7, 2), laneId)
    useEditorStore.getState().removeClips(['t1', 't2'])
    expect(
      useEditorStore.getState().project.tracks.find((t) => t.id === laneId),
    ).toBeUndefined()
  })
})

// ── Cross-track moves: the vertical drag's commit actions ────────────────────

describe('moveClipToTrack', () => {
  let laneId = ''
  beforeEach(() => {
    useEditorStore
      .getState()
      .replaceProject(projectWith([clip('a', 5), clip('b', 3)]))
    laneId = useEditorStore.getState().addOverlayTrack()
  })

  it('main → lane: frees the clip at the given start and re-packs the source', () => {
    useEditorStore.getState().moveClipToTrack('b', laneId, { start: 7 })
    expect(trackClips().map((c) => c.id)).toEqual(['a'])
    expectPacked(trackClips())
    expect(overlay()!.clips).toHaveLength(1)
    expect(overlay()!.clips[0]).toMatchObject({ id: 'b', start: 7 })
  })

  it('lane → main: splices at the index, re-packs, prunes the emptied lane', () => {
    useEditorStore.getState().moveClipToTrack('b', laneId, { start: 7 })
    useEditorStore.getState().moveClipToTrack('b', trackId(), { index: 0 })
    expect(trackClips().map((c) => c.id)).toEqual(['b', 'a'])
    expectPacked(trackClips())
    expect(overlay()).toBeUndefined()
  })

  it('lane → lane: lands in the nearest free gap of the target', () => {
    const upperId = useEditorStore.getState().addOverlayTrack()
    useEditorStore.getState().addClip(textClip('t1', 3, 4), laneId)
    useEditorStore.getState().addClip(textClip('t2', 0, 4), upperId)
    useEditorStore.getState().moveClipToTrack('t1', upperId, { start: 1 })
    const tracks = useEditorStore.getState().project.tracks
    const upper = tracks.find((t) => t.id === upperId)!
    expect(upper.clips.map((c) => c.id)).toEqual(['t2', 't1'])
    expect(upper.clips[1].start).toBe(4) // flush after t2
    expect(tracks.some((t) => t.id === laneId)).toBe(false) // source pruned
  })

  it('never lets text join the magnetic track', () => {
    useEditorStore.getState().addClip(textClip('t1', 2, 4), laneId)
    useEditorStore.getState().moveClipToTrack('t1', trackId(), { index: 0 })
    expect(trackClips().map((c) => c.id)).toEqual(['a', 'b'])
    expect(overlay()!.clips.map((c) => c.id)).toEqual(['t1'])
  })
})

describe('moveClipToNewTrack', () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .replaceProject(projectWith([clip('a', 5), clip('b', 3)]))
  })

  it('creates a lane directly above `belowTrackId` and moves the clip onto it', () => {
    useEditorStore.getState().moveClipToNewTrack('b', trackId(), 2)
    const tracks = useEditorStore.getState().project.tracks
    expect(tracks).toHaveLength(2)
    expect(tracks[1].type).toBe('overlay')
    expect(tracks[1].clips).toHaveLength(1)
    expect(tracks[1].clips[0]).toMatchObject({ id: 'b', start: 2 })
    expectPacked(trackClips())
  })

  it('prunes an overlay source that emptied into the move', () => {
    const laneId = useEditorStore.getState().addOverlayTrack()
    useEditorStore.getState().addClip(textClip('t1', 0, 2), laneId)
    useEditorStore.getState().addClip(textClip('t2', 5, 2), laneId)
    useEditorStore.getState().moveClipToNewTrack('t1', laneId, 1)
    const tracks = useEditorStore.getState().project.tracks
    expect(tracks).toHaveLength(3)
    expect(tracks[1].clips.map((c) => c.id)).toEqual(['t2'])
    expect(tracks[2].clips[0]).toMatchObject({ id: 't1', start: 1 })
  })

  it('sole occupant into the seam above its own lane just changes time', () => {
    const laneId = useEditorStore.getState().addOverlayTrack()
    useEditorStore.getState().addClip(textClip('t1', 0, 2), laneId)
    useEditorStore.getState().moveClipToNewTrack('t1', laneId, 4)
    const tracks = useEditorStore.getState().project.tracks
    expect(tracks).toHaveLength(2)
    expect(tracks[1].id).toBe(laneId) // no churn — same lane object
    expect(tracks[1].clips[0].start).toBe(4)
  })

  it('sole occupant into the seam below its own lane is the same no-op', () => {
    const laneId = useEditorStore.getState().addOverlayTrack()
    useEditorStore.getState().addClip(textClip('t1', 3, 2), laneId)
    useEditorStore.getState().moveClipToNewTrack('t1', trackId(), 1)
    const tracks = useEditorStore.getState().project.tracks
    expect(tracks).toHaveLength(2)
    expect(tracks[1].id).toBe(laneId)
    expect(tracks[1].clips[0].start).toBe(1)
  })
})

// ── The document-dirtied seam (store/touch.ts) ───────────────────────────────
// Every CONTENT action must bump `documentRevision` and clear a stale FINISHED
// export; asset-metadata writes must not. This table is the backstop for the
// `mutate` wrapper — a new action wired with raw `set` fails here.

describe('touchDocument seam', () => {
  const st = () => useEditorStore.getState()

  /** Seed: main clip + overlay text clip + a finished export on the books. */
  function seedDone() {
    st().replaceProject(projectWith([clip('a', 5), clip('b', 3)]))
    const laneId = st().addOverlayTrack()
    useEditorStore.getState().addClip(textClip('t1', 0, 2), laneId)
    useEditorStore.setState({
      exportPhase: 'done',
      exportProgress: 1,
      downloadUrl: 'blob:stale',
      downloadName: 'stale.mp4',
    })
    return laneId
  }

  const contentActions: [string, () => void][] = [
    [
      'addAsset',
      () => {
        st().addAsset({
          id: 'na',
          kind: 'image',
          name: 'n.png',
          sizeBytes: 1,
          file: new File([], 'n.png'),
          url: 'blob:n',
          naturalWidth: 1,
          naturalHeight: 1,
          durationSec: null,
          thumbs: [],
        })
      },
    ],
    [
      'addClip',
      () => {
        st().addClip(clip('n', 2))
      },
    ],
    [
      'addClipAtIndex',
      () => {
        st().addClipAtIndex(clip('n', 2), trackId(), 0)
      },
    ],
    [
      'addOverlayTrack',
      () => {
        st().addOverlayTrack()
      },
    ],
    [
      'setClipWindow',
      () => {
        st().setClipWindow('t1', 4, 2)
      },
    ],
    [
      'moveClipToTrack',
      () => {
        st().moveClipToTrack('b', trackId(), { index: 0 })
      },
    ],
    [
      'moveClipToNewTrack',
      () => {
        st().moveClipToNewTrack('b', trackId(), 1)
      },
    ],
    [
      'setClipTrimWindow',
      () => {
        st().setClipTrimWindow('a', { start: 0, trimIn: 1, duration: 4 })
      },
    ],
    [
      'updateClip',
      () => {
        st().updateClip('t1', { text: 'x' })
      },
    ],
    [
      'setClipTransform',
      () => {
        st().setClipTransform('a', { ...IDENTITY, tx: 0.1 })
      },
    ],
    [
      'removeClip',
      () => {
        st().removeClip('b')
      },
    ],
    [
      'setCanvas',
      () => {
        st().setCanvas({ width: 1080, height: 1920, background: '#000000' })
      },
    ],
    [
      'removeClips',
      () => {
        st().removeClips(['b', 't1'])
      },
    ],
    [
      'splitClip',
      () => {
        st().splitClip('a', 2)
      },
    ],
    [
      'duplicateClip',
      () => {
        st().duplicateClip('a')
      },
    ],
    [
      'replaceProject',
      () => {
        st().replaceProject(projectWith([clip('z', 1)]))
      },
    ],
  ]

  for (const [name, run] of contentActions) {
    it(`${name} bumps the revision and clears a stale finished export`, () => {
      seedDone()
      const before = st().documentRevision
      run()
      expect(st().documentRevision).toBeGreaterThan(before)
      expect(st().exportPhase).toBe('idle')
      expect(st().downloadUrl).toBeNull()
    })
  }

  it('updateAsset does NOT clear a finished export (async metadata writer)', () => {
    st().replaceProject(projectWith([clip('a', 5)]))
    st().addAsset({
      id: 'asset_a',
      kind: 'video',
      name: 'a.mp4',
      sizeBytes: 1,
      file: new File([], 'a.mp4'),
      url: 'blob:a',
      naturalWidth: 0,
      naturalHeight: 0,
      durationSec: null,
      thumbs: [],
    })
    useEditorStore.setState({ exportPhase: 'done', downloadUrl: 'blob:keep' })
    const before = st().documentRevision
    st().updateAsset('asset_a', { thumbs: ['t'] })
    expect(st().documentRevision).toBe(before)
    expect(st().exportPhase).toBe('done')
    expect(st().downloadUrl).toBe('blob:keep')
  })

  it('a mutation mid-EXPORTING leaves the phase alone (progress UI stays up)', () => {
    st().replaceProject(projectWith([clip('a', 5)]))
    useEditorStore.setState({ exportPhase: 'exporting', exportProgress: 0.4 })
    st().updateClip('a', { volume: 0.5 })
    expect(st().exportPhase).toBe('exporting')
    expect(st().exportProgress).toBe(0.4)
  })
})

describe('setClipTrimWindow — the free-lane edge trim', () => {
  let laneId = ''
  beforeEach(() => {
    useEditorStore.getState().replaceProject(projectWith([clip('a', 5)]))
    laneId = useEditorStore.getState().addOverlayTrack()
    useEditorStore.getState().addClip(textClip('l', 0, 2), laneId)
    useEditorStore.getState().addClip(textClip('t1', 4, 3), laneId)
    useEditorStore.getState().addClip(textClip('r', 9, 2), laneId)
  })

  const t1 = () => overlay()!.clips.find((c) => c.id === 't1')!

  it('moves the left edge with start (head trim keeps the end fixed)', () => {
    useEditorStore
      .getState()
      .setClipTrimWindow('t1', { start: 5, trimIn: 1, duration: 2 })
    expect(t1()).toMatchObject({ start: 5, trimIn: 1, duration: 2 })
  })

  it('clamps an outward head drag flush at the left neighbour', () => {
    useEditorStore
      .getState()
      .setClipTrimWindow('t1', { start: 1, trimIn: 0, duration: 6 })
    expect(t1()).toMatchObject({ start: 2, trimIn: 1, duration: 5 })
  })

  it('clamps an outward tail drag flush at the right neighbour', () => {
    useEditorStore
      .getState()
      .setClipTrimWindow('t1', { start: 4, trimIn: 0, duration: 8 })
    expect(t1()).toMatchObject({ start: 4, duration: 5 })
  })
})

describe('splitClip returns both halves', () => {
  beforeEach(() => {
    useEditorStore.getState().replaceProject(projectWith([clip('a', 6)]))
  })

  it('hands back the two ids so the caller can select one', () => {
    // The Timeline selects the RIGHT half; without a return value it had to
    // deselect, dropping the user into an empty inspector after every cut.
    const halves = useEditorStore.getState().splitClip('a', 2)
    expect(halves).not.toBeNull()
    expect(trackClips().map((c) => c.id)).toEqual([
      halves!.leftId,
      halves!.rightId,
    ])
  })

  it('returns null for a cut ON an edge or outside the clip', () => {
    const st = useEditorStore.getState
    expect(st().splitClip('a', 0)).toBeNull()
    expect(st().splitClip('a', 6)).toBeNull()
    expect(st().splitClip('a', 99)).toBeNull()
    expect(trackClips()).toHaveLength(1)
  })

  it('returns null for an unknown clip', () => {
    expect(useEditorStore.getState().splitClip('nope', 1)).toBeNull()
  })
})

describe('clipboard slice', () => {
  it('starts empty and holds what it is given', () => {
    useEditorStore.setState({ clipboard: null })
    expect(useEditorStore.getState().clipboard).toBeNull()
    const c = clip('x', 3)
    useEditorStore.getState().setClipboard(c)
    expect(useEditorStore.getState().clipboard?.id).toBe('x')
  })

  it('SURVIVES replaceProject — a copy outlives an undo or a reload', () => {
    useEditorStore.getState().setClipboard(clip('x', 3))
    useEditorStore.getState().replaceProject(projectWith([clip('a', 5)]))
    expect(useEditorStore.getState().clipboard?.id).toBe('x')
  })

  it('is NOT captured by undo — copying is not a document edit', () => {
    useEditorStore.getState().replaceProject(projectWith([clip('a', 5)]))
    const before = useEditorStore.getState()
    useEditorStore.getState().setClipboard(clip('x', 3))
    const after = useEditorStore.getState()
    expect(after.undoStack.length).toBe(before.undoStack.length)
    // The revision counter runs across the whole suite, so compare it rather
    // than expecting an absolute value.
    expect(after.documentRevision).toBe(before.documentRevision)
  })
})

describe('setCanvas', () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .replaceProject(projectWith([clip('a', 5), clip('b', 3)]))
  })

  it('swaps the canvas and is undoable', () => {
    const portrait = { width: 1080, height: 1920, background: '#000000' }
    useEditorStore.getState().beginEdit()
    useEditorStore.getState().setCanvas(portrait)
    expect(useEditorStore.getState().project.canvas).toEqual(portrait)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().project.canvas.width).toBe(1920)
  })

  it('leaves every clip transform DEEP-EQUAL — it does not reshape clips', () => {
    // The decision made executable: transforms are canvas-RELATIVE, so
    // placeRect re-frames them by construction. Rewriting them would be a
    // second placement path, and would make 16:9 → 9:16 → 16:9 lossy.
    const before = trackClips().map((c) => structuredClone(c.transform))
    useEditorStore
      .getState()
      .setCanvas({ width: 1080, height: 1920, background: '#000000' })
    expect(trackClips().map((c) => c.transform)).toEqual(before)
  })

  it('is a round trip: 16:9 → 9:16 → 16:9 restores the exact framing', () => {
    const original = useEditorStore.getState().project.canvas
    const framed = { ...IDENTITY, scale: 1.7, tx: 0.2, ty: -0.1 }
    useEditorStore.getState().setClipTransform('a', framed)
    useEditorStore
      .getState()
      .setCanvas({ width: 1080, height: 1920, background: '#000000' })
    useEditorStore.getState().setCanvas(original)
    expect(trackClips()[0].transform).toEqual(framed)
    expect(useEditorStore.getState().project.canvas).toEqual(original)
  })
})
