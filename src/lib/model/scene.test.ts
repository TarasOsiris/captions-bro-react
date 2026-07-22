import { describe, expect, it } from 'vitest'
import { resolveScene } from './scene'
import { projectDuration } from './selectors'
import { createProject } from './factories'
import { IDENTITY } from '@/lib/transform'
import type { Clip, Project } from './types'

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

function projectWith(clips: Clip[]): Project {
  const p = createProject('test')
  p.tracks[0].clips = clips
  return p
}

describe('resolveScene', () => {
  it('returns the clip live at a time, with correct local time', () => {
    const p = projectWith([clip('a', 0, 5), clip('b', 5, 3)])
    const at2 = resolveScene(p, 2)
    expect(at2.map((i) => i.clip.id)).toEqual(['a'])
    expect(at2[0].localTime).toBeCloseTo(2)

    const at6 = resolveScene(p, 6)
    expect(at6.map((i) => i.clip.id)).toEqual(['b'])
    expect(at6[0].localTime).toBeCloseTo(1) // 6 - start(5)
  })

  it('honors trimIn when computing local time', () => {
    const c = clip('a', 10, 5)
    c.trimIn = 2
    const items = resolveScene(projectWith([c]), 11)
    expect(items[0].localTime).toBeCloseTo(3) // trimIn(2) + (11 - 10)
  })

  it('includes the end frame so a clip paused at its end stays visible', () => {
    const p = projectWith([clip('a', 0, 5)])
    expect(resolveScene(p, 5).map((i) => i.clip.id)).toEqual(['a'])
    expect(resolveScene(p, 5.01)).toHaveLength(0)
  })

  it('skips audio tracks in the drawn scene', () => {
    const p = createProject('test')
    p.tracks = [
      { id: 't-vid', type: 'video', clips: [clip('v', 0, 5)] },
      { id: 't-aud', type: 'audio', clips: [clip('a', 0, 5)] },
    ]
    expect(resolveScene(p, 2).map((i) => i.clip.id)).toEqual(['v'])
  })
})

describe('projectDuration', () => {
  it('is the furthest clip end across tracks', () => {
    const p = projectWith([clip('a', 0, 5), clip('b', 5, 3)])
    expect(projectDuration(p)).toBeCloseTo(8)
  })

  it('is 0 for an empty project', () => {
    expect(projectDuration(createProject('empty'))).toBe(0)
  })
})
