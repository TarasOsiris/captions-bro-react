import { describe, expect, it } from 'vitest'
import { inspectorKindForClip, inspectorTitle } from './inspector'
import { IDENTITY } from '@/lib/transform'
import type { Clip } from './types'

function clip(type: Clip['type']): Clip {
  return {
    id: 'c',
    type,
    assetId: type === 'text' ? null : 'a',
    start: 0,
    duration: 1,
    trimIn: 0,
    transform: { ...IDENTITY },
  }
}

describe('inspectorKindForClip', () => {
  it('routes text to the text inspector', () => {
    expect(inspectorKindForClip(clip('text'))).toBe('text')
  })

  it('routes BOTH media types to the media inspector', () => {
    // The gap this closes: video and image used to fall to "coming soon".
    expect(inspectorKindForClip(clip('video'))).toBe('media')
    expect(inspectorKindForClip(clip('image'))).toBe('media')
  })

  it('keeps audio on the placeholder until an audio inspector exists', () => {
    expect(inspectorKindForClip(clip('audio'))).toBe('unsupported')
  })

  it('reports an empty selection distinctly from an unsupported one', () => {
    // They render different copy: "select a clip" vs "coming soon".
    expect(inspectorKindForClip(null)).toBe('empty')
    expect(inspectorKindForClip(undefined)).toBe('empty')
  })
})

describe('inspectorTitle', () => {
  it('names the two real inspectors and falls back otherwise', () => {
    expect(inspectorTitle('text')).toBe('Text')
    expect(inspectorTitle('media')).toBe('Media')
    expect(inspectorTitle('empty')).toBe('Inspector')
    expect(inspectorTitle('unsupported')).toBe('Inspector')
  })
})
