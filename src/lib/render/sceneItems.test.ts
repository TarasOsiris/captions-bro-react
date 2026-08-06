// The ONE clip-type branch shared by the preview and the timeline export.
// A fake text resolver is injected because the real one needs a DOM canvas to
// measure with, and these tests run in the node env.

import { describe, expect, it, vi } from 'vitest'
import {
  bitmapSource,
  liveTextItems,
  sceneDrawItems,
  videoSampleSource,
} from './sceneItems'
import { resolveScene } from '@/lib/model/scene'
import { projectDuration } from '@/lib/model/selectors'
import {
  createProject,
  createTextClip,
  createTrack,
} from '@/lib/model/factories'
import { IDENTITY } from '@/lib/transform'
import type { RenderSource } from './compositor'
import type { SceneItem } from '@/lib/model/scene'
import type { Clip, Project } from '@/lib/model/types'

/** A text source that needs no font metrics. */
const fakeText = (): RenderSource => ({
  size: { w: 10, h: 5 },
  paint: () => undefined,
})

function clip(id: string, type: Clip['type'], patch: Partial<Clip> = {}): Clip {
  return {
    id,
    type,
    assetId: type === 'text' ? null : `asset_${id}`,
    start: 0,
    duration: 5,
    trimIn: 0,
    transform: { ...IDENTITY },
    ...patch,
  }
}

function sceneOf(clips: Clip[]): SceneItem[] {
  return clips.map((c) => ({ clip: c, asset: null, localTime: 0 }))
}

describe('sceneDrawItems', () => {
  it('keeps the scene draw order', () => {
    const items = sceneDrawItems(
      sceneOf([clip('a', 'video'), clip('b', 'text'), clip('c', 'image')]),
      100,
      100,
      () => ({ aspect: 1, paint: () => undefined }),
      fakeText,
    )
    expect(items).toHaveLength(3)
  })

  it('resolves TEXT without ever consulting the media resolver', () => {
    // The regression this pins: text is generated, not decoded, so it has no
    // asset — an asset guard ahead of it dropped captions from the export
    // while the preview still showed them.
    const resolveMedia = vi.fn(() => null)
    const items = sceneDrawItems(
      sceneOf([clip('t', 'text')]),
      100,
      100,
      resolveMedia,
      fakeText,
    )
    expect(items).toHaveLength(1)
    expect(resolveMedia).not.toHaveBeenCalled()
  })

  it('skips audio clips — they never draw', () => {
    const items = sceneDrawItems(
      sceneOf([clip('a', 'audio')]),
      100,
      100,
      () => ({ aspect: 1, paint: () => undefined }),
      fakeText,
    )
    expect(items).toEqual([])
  })

  it('skips a media clip whose pixels are not ready', () => {
    const items = sceneDrawItems(
      sceneOf([clip('v', 'video')]),
      100,
      100,
      () => null,
      fakeText,
    )
    expect(items).toEqual([])
  })

  it('hands the whole scene item to the resolver (localTime included)', () => {
    const seen: number[] = []
    sceneDrawItems(
      [{ clip: clip('v', 'video'), asset: null, localTime: 4.5 }],
      100,
      100,
      (item) => {
        seen.push(item.localTime)
        return null
      },
      fakeText,
    )
    expect(seen).toEqual([4.5])
  })

  it('carries each clip’s own transform onto its item', () => {
    const c = clip('v', 'video', { transform: { ...IDENTITY, tx: 0.25 } })
    const [item] = sceneDrawItems(
      sceneOf([c]),
      100,
      100,
      () => ({ aspect: 1, paint: () => undefined }),
      fakeText,
    )
    expect(item.transform.tx).toBe(0.25)
  })
})

describe('liveTextItems', () => {
  it('includes a caption only inside its half-open window', () => {
    const caption = clip('t', 'text', { start: 2, duration: 3 }) // [2,5)
    const at = (t: number) =>
      liveTextItems([caption], t, 100, 100, fakeText).length
    expect(at(1.9)).toBe(0)
    expect(at(2)).toBe(1)
    expect(at(4.9)).toBe(1)
    expect(at(5)).toBe(0)
  })

  it('does NOT apply the preview’s end-of-timeline hold', () => {
    // The fast path never samples exactly t === projectDuration, so the hold is
    // unobservable there — this pins the deliberate divergence from
    // resolveScene rather than letting it drift into a silent difference.
    const project: Project = createProject('hold')
    const lane = createTrack('overlay')
    const caption = createTextClip({ start: 0, duration: 4 })
    lane.clips = [caption]
    project.tracks.push(lane)
    const end = projectDuration(project)

    const held = sceneDrawItems(
      resolveScene(project, end),
      100,
      100,
      () => null,
      fakeText,
    )
    expect(held).toHaveLength(1) // resolveScene holds the final frame

    const raw = liveTextItems([caption], end, 100, 100, fakeText)
    expect(raw).toHaveLength(0) // the fast path's raw window does not
  })
})

describe('source adapters', () => {
  it('videoSampleSource reports the sample display aspect', () => {
    const src = videoSampleSource({
      displayWidth: 1920,
      displayHeight: 1080,
      draw: () => undefined,
    })
    expect(src.aspect).toBeCloseTo(16 / 9)
  })

  it('bitmapSource reports the bitmap aspect', () => {
    expect(bitmapSource({ width: 800, height: 400 }).aspect).toBe(2)
  })
})
