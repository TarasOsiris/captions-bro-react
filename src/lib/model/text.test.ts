import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE, withAlpha, withTextDefaults } from './text'
import { cloneClip, createTextClip } from './factories'

describe('withTextDefaults — the one migration seam', () => {
  it('fills every field when nothing is stored', () => {
    const s = withTextDefaults(undefined)
    for (const key of Object.keys(DEFAULT_TEXT_STYLE)) {
      expect(s[key as keyof typeof s]).toBeDefined()
    }
    expect(withTextDefaults(null)).toEqual(DEFAULT_TEXT_STYLE)
  })

  it('keeps overrides and still fills the rest (an older document)', () => {
    const s = withTextDefaults({ fontSize: 0.2, color: '#ff0000' })
    expect(s.fontSize).toBe(0.2)
    expect(s.color).toBe('#ff0000')
    expect(s.lineHeight).toBe(DEFAULT_TEXT_STYLE.lineHeight)
    expect(s.boxWidth).toBe(DEFAULT_TEXT_STYLE.boxWidth)
  })

  it('returns a fresh object, never the shared default', () => {
    const a = withTextDefaults()
    const b = withTextDefaults()
    expect(a).not.toBe(b)
    expect(a).not.toBe(DEFAULT_TEXT_STYLE)
    a.fontSize = 0.5
    expect(DEFAULT_TEXT_STYLE.fontSize).not.toBe(0.5)
  })
})

describe('withAlpha', () => {
  it('converts 6- and 3-digit hex', () => {
    expect(withAlpha('#ff8000', 0.5)).toBe('rgba(255,128,0,0.5)')
    expect(withAlpha('#f80', 1)).toBe('rgba(255,136,0,1)')
    expect(withAlpha('ff8000', 0.25)).toBe('rgba(255,128,0,0.25)')
  })

  it('clamps alpha and degrades safely on garbage', () => {
    expect(withAlpha('#000000', 5)).toBe('rgba(0,0,0,1)')
    expect(withAlpha('#000000', -1)).toBe('rgba(0,0,0,0)')
    expect(withAlpha('not-a-colour', 0.5)).toBe('rgba(255,255,255,0.5)')
  })
})

describe('createTextClip', () => {
  it('is asset-less, untrimmed and carries a complete style', () => {
    const c = createTextClip({ start: 3 })
    expect(c.type).toBe('text')
    expect(c.assetId).toBeNull()
    expect(c.trimIn).toBe(0)
    expect(c.start).toBe(3)
    expect(c.duration).toBeGreaterThan(0)
    expect(c.text).toBeTruthy()
    expect(c.textStyle).toEqual(DEFAULT_TEXT_STYLE)
  })

  it('never starts before zero', () => {
    expect(createTextClip({ start: -5 }).start).toBe(0)
  })
})

describe('cloneClip — nested objects must not alias', () => {
  it('gives the copy its own textStyle', () => {
    const original = createTextClip({ start: 0 })
    const copy = cloneClip(original)
    expect(copy.id).not.toBe(original.id)
    expect(copy.textStyle).not.toBe(original.textStyle)
    copy.textStyle!.fontSize = 0.42
    expect(original.textStyle!.fontSize).not.toBe(0.42)
  })

  it('gives the copy its own transform.crop', () => {
    const original = createTextClip()
    original.transform.crop = { top: 0.1, right: 0, bottom: 0, left: 0 }
    const copy = cloneClip(original)
    expect(copy.transform.crop).not.toBe(original.transform.crop)
    copy.transform.crop!.top = 0.9
    expect(original.transform.crop.top).toBeCloseTo(0.1)
  })
})
