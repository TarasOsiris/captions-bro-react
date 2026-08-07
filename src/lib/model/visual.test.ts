import { describe, expect, it } from 'vitest'
import { clipOpacity } from './visual'

describe('clipOpacity', () => {
  it('is fully opaque when absent — every document written before the field', () => {
    expect(clipOpacity({})).toBe(1)
    expect(clipOpacity({ opacity: undefined })).toBe(1)
  })

  it('passes a legal value through', () => {
    expect(clipOpacity({ opacity: 0.35 })).toBeCloseTo(0.35)
    expect(clipOpacity({ opacity: 0 })).toBe(0)
    expect(clipOpacity({ opacity: 1 })).toBe(1)
  })

  it('clamps out-of-range values', () => {
    expect(clipOpacity({ opacity: 2 })).toBe(1)
    expect(clipOpacity({ opacity: -1 })).toBe(0)
  })

  it('treats a non-finite value as opaque, never passing NaN to globalAlpha', () => {
    // A NaN globalAlpha paints NOTHING, silently — and a hand-edited or
    // half-migrated document is the realistic source of one.
    expect(clipOpacity({ opacity: Number.NaN })).toBe(1)
    expect(clipOpacity({ opacity: Number.POSITIVE_INFINITY })).toBe(1)
  })
})
