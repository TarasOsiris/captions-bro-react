// Export PATH SELECTION only — `planExport` is pure, so this runs in the node
// env with no WebCodecs. The stakes: picking `timeline` when `video` would do
// silently drops audio wherever there is no AAC encoder (Firefox), and that is
// exactly the regression adding text overlays could have caused.

import { describe, expect, it } from 'vitest'
import { planExport } from './export'
import { createProject, createTextClip, createTrack } from './model/factories'
import { IDENTITY } from './transform'
import type { Clip, MediaAsset, Project } from './model/types'

function asset(id: string, durationSec: number | null): MediaAsset {
  return {
    id,
    kind: durationSec == null ? 'image' : 'video',
    name: `${id}.mp4`,
    sizeBytes: 1,
    file: new File([], `${id}.mp4`),
    url: `blob:${id}`,
    naturalWidth: 1920,
    naturalHeight: 1080,
    durationSec,
    thumbs: [],
  }
}

function mediaClip(
  id: string,
  type: 'video' | 'image',
  assetId: string,
  duration: number,
): Clip {
  return {
    id,
    type,
    assetId,
    start: 0,
    duration,
    trimIn: 0,
    transform: { ...IDENTITY },
  }
}

/** A project with one video track holding `clips`, plus registered assets. */
function projectWith(clips: Clip[], assets: MediaAsset[]): Project {
  const p = createProject('test')
  p.tracks[0].clips = clips
  for (const a of assets) p.assets[a.id] = a
  return p
}

/** Add a text clip on a proper overlay track. */
function withText(p: Project, ...text: Clip[]): Project {
  const overlay = createTrack('overlay')
  overlay.clips = text
  p.tracks.push(overlay)
  return p
}

describe('planExport — the fast path survives text overlays', () => {
  it('uses the video fast path for a single untrimmed clip', () => {
    const p = projectWith(
      [mediaClip('v', 'video', 'a1', 10)],
      [asset('a1', 10)],
    )
    expect(planExport(p)).toMatchObject({ path: 'video', overlays: [] })
  })

  it('STAYS on the video fast path with text overlays, and carries them', () => {
    // This is the whole point: falling back to `timeline` here would export
    // silent on any browser without an AAC encoder.
    const text = createTextClip({ start: 2, duration: 3 })
    const p = withText(
      projectWith([mediaClip('v', 'video', 'a1', 10)], [asset('a1', 10)]),
      text,
    )
    const plan = planExport(p)
    expect(plan.path).toBe('video')
    if (plan.path !== 'video') throw new Error('unreachable')
    expect(plan.overlays.map((c) => c.id)).toEqual([text.id])
  })

  it('carries several overlays in draw order', () => {
    const t1 = createTextClip({ start: 0, duration: 2 })
    const t2 = createTextClip({ start: 4, duration: 2 })
    const p = withText(
      projectWith([mediaClip('v', 'video', 'a1', 10)], [asset('a1', 10)]),
      t1,
      t2,
    )
    const plan = planExport(p)
    if (plan.path !== 'video') throw new Error('expected the video fast path')
    expect(plan.overlays.map((c) => c.id)).toEqual([t1.id, t2.id])
  })

  it('uses the image fast path only when there is NO text', () => {
    const still = projectWith(
      [mediaClip('i', 'image', 'a1', 5)],
      [asset('a1', null)],
    )
    expect(planExport(still).path).toBe('image')

    // `exportImage` repeats ONE baked frame, so time-windowed overlays would be
    // wrong — and a still has no audio for the fast path to protect.
    const withCaption = withText(
      projectWith([mediaClip('i', 'image', 'a1', 5)], [asset('a1', null)]),
      createTextClip({ start: 1, duration: 2 }),
    )
    expect(planExport(withCaption).path).toBe('timeline')
  })

  it('falls back to the compositor for a text-only project', () => {
    const p = withText(createProject('t'), createTextClip({ duration: 4 }))
    expect(planExport(p).path).toBe('timeline')
  })

  it('still falls back for genuinely multi-clip or trimmed projects', () => {
    const two = projectWith(
      [mediaClip('v1', 'video', 'a1', 5), mediaClip('v2', 'video', 'a2', 5)],
      [asset('a1', 5), asset('a2', 5)],
    )
    expect(planExport(two).path).toBe('timeline')

    const trimmed = projectWith(
      [{ ...mediaClip('v', 'video', 'a1', 4), trimIn: 2 }],
      [asset('a1', 10)],
    )
    expect(planExport(trimmed).path).toBe('timeline')

    const shortened = projectWith(
      [mediaClip('v', 'video', 'a1', 4)],
      [asset('a1', 10)],
    )
    expect(planExport(shortened).path).toBe('timeline')

    const offset = projectWith(
      [{ ...mediaClip('v', 'video', 'a1', 10), start: 3 }],
      [asset('a1', 10)],
    )
    expect(planExport(offset).path).toBe('timeline')
  })
})
