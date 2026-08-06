// The small pure pieces the three export paths share: naming, result
// construction, the discarded-track policy, canvas sizing, progress mapping.

import { describe, expect, it } from 'vitest'
import { even, outputCanvas } from './canvas'
import { ExportUnsupportedError } from './errors'
import { exportFileName, mp4Name } from './filename'
import { ENCODE_END, encodeFraction } from './progress'
import { classifyDiscardedTracks, makeResult } from './result'
import { ResourceBag } from './resources'
import {
  createProject,
  createTextClip,
  createTrack,
  DEFAULT_CANVAS,
} from '@/lib/model/factories'
import { CANVAS_ASPECT, IDENTITY } from '@/lib/transform'
import type { Clip, MediaAsset, Project } from '@/lib/model/types'

function asset(id: string, name: string): MediaAsset {
  return {
    id,
    kind: 'video',
    name,
    sizeBytes: 1,
    file: new File([], name),
    url: `blob:${id}`,
    naturalWidth: 1920,
    naturalHeight: 1080,
    durationSec: 5,
    thumbs: [],
  }
}

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

function projectWith(clips: Clip[], assets: MediaAsset[]): Project {
  const p = createProject('Untitled project')
  p.tracks[0].clips = clips
  for (const a of assets) p.assets[a.id] = a
  return p
}

describe('filename', () => {
  it('replaces the extension with the export suffix', () => {
    expect(mp4Name('clip.mov')).toBe('clip-captions-bro.mp4')
    expect(mp4Name('no-extension')).toBe('no-extension-captions-bro.mp4')
  })

  it('falls back to a generic stem for an empty basename', () => {
    expect(mp4Name('.mp4')).toBe('video-captions-bro.mp4')
  })

  it('names a project after its FIRST media asset in document order', () => {
    const project = projectWith(
      [videoClip('c1', 'a1'), videoClip('c2', 'a2')],
      [asset('a1', 'holiday.mov'), asset('a2', 'second.mp4')],
    )
    expect(exportFileName(project)).toBe('holiday-captions-bro.mp4')
  })

  it('falls back to the project name when there is no media', () => {
    const project = createProject('My project')
    const lane = createTrack('overlay')
    lane.clips = [createTextClip({ start: 0, duration: 2 })]
    project.tracks.push(lane)
    expect(exportFileName(project)).toBe('My project-captions-bro.mp4')
  })
})

describe('progress', () => {
  it('maps the encode phase into 0…ENCODE_END', () => {
    expect(encodeFraction(0)).toBe(0)
    expect(encodeFraction(1)).toBeCloseTo(ENCODE_END)
    expect(encodeFraction(0.5)).toBeCloseTo(ENCODE_END / 2)
  })

  it('clamps out-of-range input', () => {
    expect(encodeFraction(-1)).toBe(0)
    expect(encodeFraction(2)).toBeCloseTo(ENCODE_END)
  })

  it('leaves headroom for the container finalize', () => {
    expect(ENCODE_END).toBeLessThan(1)
  })
})

describe('canvas sizing', () => {
  it('rounds dimensions down to even (H.264 requires it)', () => {
    expect(even(1080)).toBe(1080)
    expect(even(1081)).toBe(1080)
    expect(even(1)).toBe(2) // floor of 2, never zero
    expect(even(0)).toBe(2)
  })

  it('evens both axes and keeps the background', () => {
    expect(
      outputCanvas({ width: 1921, height: 1081, background: '#123' }),
    ).toEqual({ width: 1920, height: 1080, background: '#123' })
  })
})

describe('DEFAULT_CANVAS', () => {
  it('derives its width from the ONE aspect constant', () => {
    expect(DEFAULT_CANVAS.width / DEFAULT_CANVAS.height).toBeCloseTo(
      CANVAS_ASPECT,
    )
    expect(DEFAULT_CANVAS.width).toBe(1920)
  })
})

describe('classifyDiscardedTracks', () => {
  it('collects audio drops as non-fatal', () => {
    const out = classifyDiscardedTracks([
      { track: { type: 'audio' }, reason: 'no_encodable_target_codec' },
    ])
    expect(out).toEqual([
      { type: 'audio', reason: 'no_encodable_target_codec' },
    ])
  })

  it('throws Unsupported when the VIDEO track has no encoder', () => {
    expect(() =>
      classifyDiscardedTracks([
        { track: { type: 'video' }, reason: 'no_encodable_target_codec' },
      ]),
    ).toThrow(ExportUnsupportedError)
  })

  it('throws a decode error for any other video drop', () => {
    expect(() =>
      classifyDiscardedTracks([
        { track: { type: 'video' }, reason: 'undecodable_source_codec' },
      ]),
    ).toThrow(/can't decode/)
  })

  it('is empty for no drops', () => {
    expect(classifyDiscardedTracks([])).toEqual([])
  })
})

describe('makeResult', () => {
  it('builds an mp4 blob with defaulted diagnostics', () => {
    const result = makeResult({
      buffer: new ArrayBuffer(8),
      fileName: 'out.mp4',
    })
    expect(result.blob.type).toBe('video/mp4')
    expect(result.suggestedFileName).toBe('out.mp4')
    expect(result.discardedTracks).toEqual([])
    expect(result.silent).toBe(false)
  })

  it('rejects a missing buffer', () => {
    expect(() => makeResult({ buffer: null, fileName: 'out.mp4' })).toThrow()
  })
})

describe('ResourceBag', () => {
  it('disposes newest-first and only once', () => {
    const order: number[] = []
    const bag = new ResourceBag()
    bag.add(() => order.push(1))
    bag.add(() => order.push(2))
    bag.disposeAll()
    bag.disposeAll()
    expect(order).toEqual([2, 1])
  })

  it('keeps going when a teardown throws', () => {
    const order: number[] = []
    const bag = new ResourceBag()
    bag.add(() => order.push(1))
    bag.add(() => {
      throw new Error('already disposed')
    })
    expect(() => {
      bag.disposeAll()
    }).not.toThrow()
    expect(order).toEqual([1])
  })
})
