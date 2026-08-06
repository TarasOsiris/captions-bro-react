// The localStorage boundary — a jsdom test, because this is the one
// persistence module whose whole job is talking to the browser. Its failure
// mode is silent data loss, which is exactly what the node-only test glob used
// to leave uncovered.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearStoredProject,
  loadStoredProject,
  saveProject,
  serializeProject,
} from './projectStore'
import { CURRENT_VERSION } from './migrations'
import {
  createProject,
  createTextClip,
  createTrack,
} from '@/lib/model/factories'
import { IDENTITY } from '@/lib/transform'
import type { MediaAsset, Project } from '@/lib/model/types'

function asset(id: string): MediaAsset {
  return {
    id,
    kind: 'video',
    name: `${id}.mp4`,
    sizeBytes: 42,
    file: new File(['data'], `${id}.mp4`),
    url: `blob:${id}`,
    naturalWidth: 1920,
    naturalHeight: 1080,
    durationSec: 12.5,
    thumbs: ['blob:thumb1', 'blob:thumb2'],
  }
}

function seeded(): Project {
  const p = createProject('round trip')
  p.tracks[0].clips = [
    {
      id: 'c1',
      type: 'video',
      assetId: 'a1',
      start: 0,
      duration: 5,
      trimIn: 1,
      transform: { ...IDENTITY, tx: 0.2 },
    },
  ]
  const lane = createTrack('overlay')
  lane.clips = [createTextClip({ start: 2, duration: 3, content: 'hello' })]
  p.tracks.push(lane)
  p.assets.a1 = asset('a1')
  return p
}

describe('serializeProject', () => {
  it('strips every runtime-only asset field', () => {
    const stored = serializeProject(seeded())
    const [a] = stored.assets
    expect(a).not.toHaveProperty('file')
    expect(a).not.toHaveProperty('url')
    expect(a).not.toHaveProperty('thumbs')
  })

  it('keeps the persisted asset fields', () => {
    const [a] = serializeProject(seeded()).assets
    expect(a).toMatchObject({
      id: 'a1',
      kind: 'video',
      name: 'a1.mp4',
      sizeBytes: 42,
      naturalWidth: 1920,
      naturalHeight: 1080,
      durationSec: 12.5,
    })
  })

  it('stamps the current version', () => {
    expect(serializeProject(seeded()).version).toBe(CURRENT_VERSION)
  })

  it('produces something JSON can actually hold (no File/Blob left in)', () => {
    expect(() => JSON.stringify(serializeProject(seeded()))).not.toThrow()
    const json = JSON.stringify(serializeProject(seeded()))
    expect(json).not.toContain('blob:')
  })
})

describe('save → load round trip', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('restores the document structure verbatim', () => {
    const project = seeded()
    expect(saveProject(project)).toBe(true)
    const loaded = loadStoredProject()
    expect(loaded?.name).toBe('round trip')
    expect(loaded?.tracks).toHaveLength(2)
    expect(loaded?.tracks[0].clips[0]).toMatchObject({
      id: 'c1',
      trimIn: 1,
      duration: 5,
    })
    expect(loaded?.tracks[0].clips[0].transform.tx).toBeCloseTo(0.2)
    expect(loaded?.tracks[1].clips[0].text).toBe('hello')
    expect(loaded?.assets).toHaveLength(1)
  })

  it('returns null when nothing is stored', () => {
    expect(loadStoredProject()).toBeNull()
  })

  it('returns null for unparseable or wrong-shaped JSON', () => {
    localStorage.setItem('cb-project', 'not json at all')
    expect(loadStoredProject()).toBeNull()
    localStorage.setItem('cb-project', JSON.stringify({ nope: true }))
    expect(loadStoredProject()).toBeNull()
  })

  it('clearStoredProject makes the document unloadable again', () => {
    saveProject(seeded())
    expect(loadStoredProject()).not.toBeNull()
    clearStoredProject()
    expect(loadStoredProject()).toBeNull()
  })

  it('reports a failed write instead of losing it silently', () => {
    // The storage-full case: the user must be told their work is not saved,
    // which is the whole reason saveProject returns a boolean.
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(saveProject(seeded())).toBe(false)
    spy.mockRestore()
    // …and recovers once there is room again.
    expect(saveProject(seeded())).toBe(true)
  })
})
