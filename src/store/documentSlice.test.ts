import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './editorStore'
import { createProject } from '@/lib/model/factories'
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
