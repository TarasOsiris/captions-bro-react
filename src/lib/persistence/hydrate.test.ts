import { describe, expect, it } from 'vitest'
import { hydrateProject } from './hydrate'
import { CURRENT_VERSION } from './migrations'
import { createTextClip, createTrack } from '@/lib/model/factories'
import { DEFAULT_TEXT_STYLE } from '@/lib/model/text'
import { IDENTITY } from '@/lib/transform'
import type { HydrateDeps } from './hydrate'
import type { StoredProject } from './projectStore'
import type { Clip, Track } from '@/lib/model/types'

function videoClip(id: string, assetId: string): Clip {
  return {
    id,
    type: 'video',
    assetId,
    start: 0,
    duration: 5,
    trimIn: 0,
    transform: { ...IDENTITY },
  }
}

function storedAsset(id: string) {
  return {
    id,
    kind: 'video' as const,
    name: `${id}.mp4`,
    sizeBytes: 3,
    naturalWidth: 1920,
    naturalHeight: 1080,
    durationSec: 5,
  }
}

function stored(tracks: Track[], assets: string[]): StoredProject {
  return {
    version: CURRENT_VERSION,
    id: 'p1',
    name: 'test',
    canvas: { width: 1920, height: 1080, background: '#000' },
    tracks,
    assets: assets.map(storedAsset),
  }
}

/** Deps whose blob store holds exactly `have`; object URLs are fake strings. */
function deps(have: string[]): HydrateDeps {
  return {
    loadBlob: (id) =>
      Promise.resolve(
        have.includes(id)
          ? new Blob(['abc'], { type: 'video/mp4' })
          : undefined,
      ),
    createUrl: (file) => `blob:fake/${file.name}`,
  }
}

describe('hydrateProject', () => {
  it('rebuilds assets (File + url) and keeps their clips', async () => {
    const main = createTrack('video')
    main.clips = [videoClip('c1', 'a1')]
    const { project, missingAssets, droppedClips } = await hydrateProject(
      stored([main], ['a1']),
      deps(['a1']),
    )
    expect(missingAssets).toBe(0)
    expect(droppedClips).toBe(0)
    expect(project?.assets.a1.url).toBe('blob:fake/a1.mp4')
    expect(project?.assets.a1.file.name).toBe('a1.mp4')
    expect(project?.tracks[0].clips.map((c) => c.id)).toEqual(['c1'])
  })

  it('drops clips whose media is gone and reports the loss', async () => {
    const main = createTrack('video')
    main.clips = [videoClip('c1', 'a1'), videoClip('c2', 'a2')]
    const { project, missingAssets, droppedClips } = await hydrateProject(
      stored([main], ['a1', 'a2']),
      deps(['a1']),
    )
    expect(missingAssets).toBe(1)
    expect(droppedClips).toBe(1)
    expect(project?.tracks[0].clips.map((c) => c.id)).toEqual(['c1'])
  })

  it('keeps asset-less clips (text) when media around them is dropped', async () => {
    const main = createTrack('video')
    main.clips = [videoClip('c1', 'a1')]
    const lane = createTrack('overlay')
    lane.clips = [createTextClip({ start: 1, duration: 2 })]
    const { project, droppedClips } = await hydrateProject(
      stored([main, lane], ['a1']),
      deps([]),
    )
    // a1 was the ONLY asset and it is gone → unrecoverable by the total rule.
    expect(project).toBeNull()
    expect(droppedClips).toBe(1)
  })

  it('is unrecoverable only when media existed and NONE survived', async () => {
    const lane = createTrack('overlay')
    lane.clips = [createTextClip({ start: 0, duration: 2 })]
    const { project } = await hydrateProject(stored([lane], []), deps([]))
    expect(project).not.toBeNull()
  })

  it('normalizes text styles so old documents cannot hand undefined to layout', async () => {
    const lane = createTrack('overlay')
    const clip = createTextClip({ start: 0, duration: 2 })
    // Simulate an older build: a partial style with fields missing.
    clip.textStyle = { fontFamily: 'Inter' } as Clip['textStyle']
    lane.clips = [clip]
    const { project } = await hydrateProject(stored([lane], []), deps([]))
    const style = project?.tracks[0].clips[0].textStyle
    expect(style?.fontSize).toBe(DEFAULT_TEXT_STYLE.fontSize)
    expect(style?.fontFamily).toBe('Inter')
  })

  it('a swallowed loadBlob rejection counts as missing, not a crash', async () => {
    const main = createTrack('video')
    main.clips = [videoClip('c1', 'a1')]
    const { project, missingAssets } = await hydrateProject(
      stored([main], ['a1']),
      {
        loadBlob: () => Promise.reject(new Error('idb broke')),
        createUrl: () => 'unused',
      },
    )
    expect(project).toBeNull()
    expect(missingAssets).toBe(1)
  })
})
