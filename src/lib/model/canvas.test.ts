import { describe, expect, it } from 'vitest'
import {
  CANVAS_PRESETS,
  canvasAspect,
  canvasForRatio,
  normalizeCanvas,
  ratioIdFor,
} from './canvas'
import { DEFAULT_CANVAS } from './factories'
import { outputCanvas } from '@/lib/export/canvas'

describe('CANVAS_PRESETS', () => {
  it('has EVEN dimensions, so H.264 rounding is a no-op', () => {
    // The reason sizes are written out instead of derived from a float ratio:
    // 1080 * 9/16 is 607.5, which would round to 606 and put the export 0.25%
    // off the aspect the preview composed at.
    for (const p of CANVAS_PRESETS) {
      expect(p.width % 2).toBe(0)
      expect(p.height % 2).toBe(0)
      expect(outputCanvas({ ...p, background: '#000' })).toMatchObject({
        width: p.width,
        height: p.height,
      })
    }
  })

  it('matches the ratio each preset claims', () => {
    const declared: Record<string, number> = {
      '16:9': 16 / 9,
      '9:16': 9 / 16,
      '1:1': 1,
      '4:5': 4 / 5,
    }
    for (const p of CANVAS_PRESETS) {
      expect(canvasAspect(p)).toBeCloseTo(declared[p.id], 3)
    }
  })

  it('has unique ids', () => {
    const ids = CANVAS_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('canvasForRatio', () => {
  it('keeps the background and takes the preset size', () => {
    expect(canvasForRatio('9:16', '#123456')).toEqual({
      width: 1080,
      height: 1920,
      background: '#123456',
    })
  })

  it('agrees with DEFAULT_CANVAS for 16:9', () => {
    // factories re-exports this; the two spellings must not drift.
    expect(canvasForRatio('16:9', DEFAULT_CANVAS.background)).toEqual(
      DEFAULT_CANVAS,
    )
  })
})

describe('ratioIdFor', () => {
  it('round-trips every preset', () => {
    for (const p of CANVAS_PRESETS) {
      expect(ratioIdFor(canvasForRatio(p.id, '#000'))).toBe(p.id)
    }
  })

  it('matches on ASPECT, not on exact pixels', () => {
    // A 4K 16:9 project is still 16:9.
    expect(ratioIdFor({ width: 3840, height: 2160 })).toBe('16:9')
  })

  it('returns null for a size no preset describes', () => {
    // Shows NO selection rather than lying about one.
    expect(ratioIdFor({ width: 1000, height: 999 })).toBeNull()
    expect(ratioIdFor({ width: 1000, height: 0 })).toBeNull()
  })
})

describe('normalizeCanvas', () => {
  it('passes a healthy canvas through, portrait included', () => {
    const portrait = { width: 1080, height: 1920, background: '#111111' }
    expect(normalizeCanvas(portrait)).toEqual(portrait)
  })

  it('repairs the shapes a corrupt document can produce', () => {
    // The hole this closes: projectStore validated tracks and assets but never
    // the canvas, so any of these reached drawScene as NaN geometry.
    for (const bad of [
      undefined,
      null,
      {},
      { width: 0, height: 0 },
      { width: Number.NaN, height: 1080 },
      { width: -1920, height: 1080 },
      'nonsense',
    ]) {
      expect(normalizeCanvas(bad)).toEqual(DEFAULT_CANVAS)
    }
  })

  it('keeps a valid size but replaces a missing background', () => {
    expect(normalizeCanvas({ width: 1080, height: 1080 })).toEqual({
      width: 1080,
      height: 1080,
      background: DEFAULT_CANVAS.background,
    })
  })
})
