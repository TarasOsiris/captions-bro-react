import { describe, expect, it } from 'vitest'
import { applyGain, fastAudioMode } from './audioFast'

describe('fastAudioMode', () => {
  it('COPIES at full volume — the packet-copy that keeps Firefox audible', () => {
    // The regression guard: anything but `copy` here means the fast path
    // transcodes AAC by default, and a browser with no AAC encoder exports
    // silent. Both the absent-field default and an explicit 1 must land here.
    expect(fastAudioMode({})).toEqual({ kind: 'copy' })
    expect(fastAudioMode({ volume: 1 })).toEqual({ kind: 'copy' })
    expect(fastAudioMode({ volume: 1, muted: false })).toEqual({ kind: 'copy' })
  })

  it('DISCARDS a muted clip rather than encoding zeroes', () => {
    // Exact silence, and it needs no encoder at all.
    expect(fastAudioMode({ muted: true })).toEqual({ kind: 'discard' })
    expect(fastAudioMode({ volume: 0 })).toEqual({ kind: 'discard' })
  })

  it('lets mute beat a non-zero volume (the clipGain rule)', () => {
    expect(fastAudioMode({ muted: true, volume: 0.8 })).toEqual({
      kind: 'discard',
    })
  })

  it('GAINS only for a genuine partial volume', () => {
    expect(fastAudioMode({ volume: 0.5 })).toEqual({ kind: 'gain', gain: 0.5 })
  })

  it('clamps out-of-range volumes through clipGain rather than restating it', () => {
    expect(fastAudioMode({ volume: 2 })).toEqual({ kind: 'copy' })
    expect(fastAudioMode({ volume: -1 })).toEqual({ kind: 'discard' })
  })
})

describe('applyGain', () => {
  it('scales in place and returns the same array', () => {
    const pcm = new Float32Array([1, -1, 0.5, -0.25])
    const out = applyGain(pcm, 0.5)
    expect(out).toBe(pcm)
    expect(Array.from(out)).toEqual([0.5, -0.5, 0.25, -0.125])
  })

  it('is the identity at gain 1', () => {
    // Compared against a fresh Float32Array, not a JS number literal — 0.3 is
    // not representable in f32 and would fail on the rounding, not the gain.
    const pcm = new Float32Array([0.3, -0.7])
    expect(applyGain(pcm, 1)).toEqual(new Float32Array([0.3, -0.7]))
  })

  it('silences at gain 0 without producing -0 artefacts in the sum', () => {
    const pcm = new Float32Array([0.3, -0.7])
    applyGain(pcm, 0)
    expect(pcm.every((v) => v === 0)).toBe(true)
  })

  it('handles an empty buffer', () => {
    expect(applyGain(new Float32Array(0), 0.5).length).toBe(0)
  })
})
