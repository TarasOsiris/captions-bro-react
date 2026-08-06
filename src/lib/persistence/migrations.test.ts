import { describe, expect, it } from 'vitest'
import { CURRENT_VERSION, migrateStoredProject } from './migrations'
import { createTextClip, createTrack } from '@/lib/model/factories'
import type { StoredProject } from './projectStore'
import type { Track } from '@/lib/model/types'

function storedWith(tracks: Track[], version?: number): StoredProject {
  return {
    // `version` deliberately allowed to be undefined: pre-versioning shape.
    version: version as number,
    id: 'p1',
    name: 'test',
    canvas: { width: 1920, height: 1080, background: '#000' },
    tracks,
    assets: [],
  }
}

function overlayWith(clips: { start: number; duration: number }[]): Track {
  const lane = createTrack('overlay')
  lane.clips = clips.map((c) => createTextClip(c))
  return lane
}

describe('migrateStoredProject', () => {
  it('stamps the current version on an already-current document', () => {
    const doc = migrateStoredProject(storedWith([], CURRENT_VERSION))
    expect(doc?.version).toBe(CURRENT_VERSION)
  })

  it('refuses a document from a future build', () => {
    expect(migrateStoredProject(storedWith([], CURRENT_VERSION + 1))).toBeNull()
  })

  it('treats a missing version as v1 and migrates it', () => {
    const doc = migrateStoredProject(storedWith([]))
    expect(doc?.version).toBe(CURRENT_VERSION)
  })

  it('v1 → v2 spreads an overlapping overlay lane across lanes', () => {
    const main = createTrack('video')
    const lane = overlayWith([
      { start: 0, duration: 4 },
      { start: 2, duration: 4 }, // overlaps the first
    ])
    const doc = migrateStoredProject(storedWith([main, lane], 1))!
    const overlays = doc.tracks.filter((t) => t.type === 'overlay')
    expect(overlays.length).toBe(2)
    for (const t of overlays) expect(t.clips).toHaveLength(1)
  })

  it('v1 → v2 leaves a clean document structurally untouched', () => {
    const main = createTrack('video')
    const lane = overlayWith([
      { start: 0, duration: 2 },
      { start: 3, duration: 2 },
    ])
    const doc = migrateStoredProject(storedWith([main, lane], 1))!
    expect(doc.tracks).toHaveLength(2)
    expect(doc.tracks[1].clips.map((c) => c.start)).toEqual([0, 3])
  })
})
