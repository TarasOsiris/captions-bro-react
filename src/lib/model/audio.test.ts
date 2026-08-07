import { describe, expect, it } from 'vitest'
import {
  audibleClips,
  clipCarriesAudio,
  clipGain,
  hasAudioClips,
  intendsAudio,
  planAudioSchedule,
} from './audio'
import { createProject } from './factories'
import { IDENTITY } from '@/lib/transform'
import type { Clip, MediaAsset, Project } from './types'

function videoClip(id: string, patch: Partial<Clip> = {}): Clip {
  return {
    id,
    type: 'video',
    assetId: `asset_${id}`,
    start: 0,
    duration: 5,
    trimIn: 0,
    transform: { ...IDENTITY },
    ...patch,
  }
}

function asset(id: string): MediaAsset {
  return {
    id,
    kind: 'video',
    name: `${id}.mp4`,
    sizeBytes: 1,
    file: new File([], `${id}.mp4`),
    url: `blob:${id}`,
    naturalWidth: 1920,
    naturalHeight: 1080,
    durationSec: 10,
    thumbs: [],
  }
}

function projectWith(clips: Clip[]): Project {
  const p = createProject('audio-test')
  p.tracks[0].clips = clips
  for (const c of clips) {
    if (c.assetId) p.assets[c.assetId] = asset(c.assetId)
  }
  return p
}

describe('clipGain', () => {
  it('defaults to full volume', () => {
    expect(clipGain({})).toBe(1)
  })

  it('is silent when muted, whatever the volume', () => {
    expect(clipGain({ muted: true, volume: 1 })).toBe(0)
  })

  it('clamps into [0,1] — the export mixer used to skip this', () => {
    expect(clipGain({ volume: 2 })).toBe(1)
    expect(clipGain({ volume: -1 })).toBe(0)
    expect(clipGain({ volume: 0.4 })).toBeCloseTo(0.4)
  })
})

describe('audibleClips / hasAudioClips', () => {
  it('skips muted and zero-volume clips', () => {
    const project = projectWith([
      videoClip('a'),
      videoClip('b', { muted: true }),
      videoClip('c', { volume: 0 }),
    ])
    expect(audibleClips(project).map((c) => c.id)).toEqual(['a'])
  })

  it('hasAudioClips still counts a muted video — it HAD audio', () => {
    const project = projectWith([videoClip('a', { muted: true })])
    expect(audibleClips(project)).toHaveLength(0)
    expect(hasAudioClips(project)).toBe(true)
  })

  it('a project of stills has no audio at all', () => {
    const project = projectWith([videoClip('a', { type: 'image' })])
    expect(hasAudioClips(project)).toBe(false)
  })
})

describe('planAudioSchedule', () => {
  const durations = new Map([['a', 10]])

  it('places a clip at its start with its trim offset', () => {
    const [entry] = planAudioSchedule(
      [videoClip('a', { start: 3, trimIn: 2, duration: 4 })],
      durations,
    )
    expect(entry).toMatchObject({
      clipId: 'a',
      when: 3,
      offset: 2,
      duration: 4,
      gain: 1,
    })
  })

  it('clamps the window to what the source actually has', () => {
    const [entry] = planAudioSchedule(
      [videoClip('a', { trimIn: 8, duration: 5 })], // source is only 10s
      durations,
    )
    expect(entry.duration).toBeCloseTo(2)
  })

  it('omits a clip trimmed entirely past the end of its source', () => {
    expect(
      planAudioSchedule(
        [videoClip('a', { trimIn: 10, duration: 5 })],
        durations,
      ),
    ).toEqual([])
  })

  it('skips clips with no decodable audio (absent from the duration map)', () => {
    expect(planAudioSchedule([videoClip('missing')], durations)).toEqual([])
  })

  it('carries the clamped gain through', () => {
    const [entry] = planAudioSchedule(
      [videoClip('a', { volume: 3 })],
      durations,
    )
    expect(entry.gain).toBe(1)
  })
})

describe('intendsAudio', () => {
  function project(clips: Partial<Clip>[]): Project {
    const p = createProject('t')
    p.assets.a1 = {
      id: 'a1',
      kind: 'video',
      name: 'a',
      sizeBytes: 1,
      file: new File([], 'a'),
      url: 'blob:a',
      naturalWidth: 16,
      naturalHeight: 9,
      durationSec: 10,
      thumbs: [],
    }
    p.tracks[0].clips = clips.map((c, i) => ({
      id: `c${i.toString()}`,
      type: 'video',
      assetId: 'a1',
      start: i,
      duration: 1,
      trimIn: 0,
      transform: { ...IDENTITY },
      ...c,
    }))
    return p
  }

  it('is true when any audio-carrying clip is audible', () => {
    expect(intendsAudio(project([{ muted: true }, {}]))).toBe(true)
  })

  it('is FALSE when every clip is muted — silence the user asked for', () => {
    // The verdict both export paths ask, so the composite path stops warning
    // "your export has no sound" about a deliberate mute.
    expect(intendsAudio(project([{ muted: true }, { volume: 0 }]))).toBe(false)
  })

  it('ignores clip types that carry no sound at all', () => {
    expect(intendsAudio(project([{ type: 'image' }, { type: 'text' }]))).toBe(
      false,
    )
  })

  it('is false for an empty project', () => {
    expect(intendsAudio(createProject('t'))).toBe(false)
  })
})

describe('clipCarriesAudio', () => {
  it('is true for the sound-bearing types only', () => {
    expect(clipCarriesAudio({ type: 'video' })).toBe(true)
    expect(clipCarriesAudio({ type: 'audio' })).toBe(true)
    expect(clipCarriesAudio({ type: 'image' })).toBe(false)
    expect(clipCarriesAudio({ type: 'text' })).toBe(false)
  })
})
