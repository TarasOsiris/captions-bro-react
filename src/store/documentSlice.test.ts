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

describe('moveClipToIndex', () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .replaceProject(projectWith([clip('a', 5), clip('b', 3), clip('c', 4)]))
  })

  it('moves a clip to the front and re-packs', () => {
    useEditorStore.getState().moveClipToIndex('c', 0)
    const clips = trackClips()
    expect(clips.map((c) => c.id)).toEqual(['c', 'a', 'b'])
    expect(clips.map((c) => c.start)).toEqual([0, 4, 9])
    expectPacked(clips)
  })

  it('moves a clip to the end and re-packs', () => {
    useEditorStore.getState().moveClipToIndex('a', 2)
    const clips = trackClips()
    expect(clips.map((c) => c.id)).toEqual(['b', 'c', 'a'])
    expectPacked(clips)
  })

  it('leaves order unchanged when moved to its own slot', () => {
    useEditorStore.getState().moveClipToIndex('b', 1)
    expect(trackClips().map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expectPacked(trackClips())
  })
})

describe('trimClip', () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .replaceProject(projectWith([clip('a', 5), clip('b', 3), clip('c', 4)]))
  })

  it('shortens a clip and ripples the clips after it', () => {
    useEditorStore.getState().trimClip('b', 0, 2) // right-trim b: 3 → 2
    const clips = trackClips()
    expect(clips.map((c) => c.duration)).toEqual([5, 2, 4])
    expect(clips.map((c) => c.start)).toEqual([0, 5, 7]) // c rippled left
    expectPacked(clips)
  })

  it('applies a head trim (trimIn up, duration down) and re-packs', () => {
    useEditorStore.getState().trimClip('a', 2, 3) // head-trim a by 2s
    const clips = trackClips()
    expect(clips[0].trimIn).toBe(2)
    expect(clips.map((c) => c.duration)).toEqual([3, 3, 4])
    expect(clips.map((c) => c.start)).toEqual([0, 3, 6])
    expectPacked(clips)
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

describe('ensureOverlayTrack', () => {
  beforeEach(() => {
    useEditorStore.getState().replaceProject(projectWith([clip('a', 5)]))
  })

  it('creates the track on first use and is idempotent after', () => {
    const first = useEditorStore.getState().ensureOverlayTrack()
    const second = useEditorStore.getState().ensureOverlayTrack()
    expect(first).toBe(second)
    expect(
      useEditorStore
        .getState()
        .project.tracks.filter((t) => t.type === 'overlay'),
    ).toHaveLength(1)
  })

  it('appends LAST, so draw order puts text above the video', () => {
    useEditorStore.getState().ensureOverlayTrack()
    const tracks = useEditorStore.getState().project.tracks
    expect(tracks[tracks.length - 1].type).toBe('overlay')
  })
})

describe('overlay clips are free-positioned', () => {
  let overlayId = ''
  beforeEach(() => {
    useEditorStore.getState().replaceProject(projectWith([clip('a', 5)]))
    overlayId = useEditorStore.getState().ensureOverlayTrack()
  })

  it('keeps out-of-order, overlapping starts instead of packing them', () => {
    useEditorStore.getState().addClip(textClip('t1', 3, 4), overlayId)
    useEditorStore.getState().addClip(textClip('t2', 1, 4), overlayId)
    expect(overlay()!.clips.map((c) => c.start)).toEqual([3, 1]) // overlapping
  })

  it('addClipAtIndex does not re-pack an overlay track', () => {
    useEditorStore.getState().addClip(textClip('t1', 6, 2), overlayId)
    useEditorStore.getState().addClipAtIndex(textClip('t2', 2, 2), overlayId, 0)
    expect(overlay()!.clips.map((c) => c.start)).toEqual([2, 6])
  })

  it('trimming one overlay clip never ripples onto its siblings', () => {
    useEditorStore.getState().addClip(textClip('t1', 2, 4), overlayId)
    useEditorStore.getState().addClip(textClip('t2', 9, 3), overlayId)
    useEditorStore.getState().trimClip('t1', 0, 1)
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

  it('setClipStart moves without touching the duration', () => {
    useEditorStore.getState().addClip(textClip('t1', 2, 4), overlayId)
    useEditorStore.getState().setClipStart('t1', 11.5)
    expect(overlay()!.clips[0]).toMatchObject({ start: 11.5, duration: 4 })
  })
})

describe('duplicate / split / remove on an overlay track', () => {
  let overlayId = ''
  beforeEach(() => {
    useEditorStore.getState().replaceProject(projectWith([clip('a', 5)]))
    overlayId = useEditorStore.getState().ensureOverlayTrack()
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
