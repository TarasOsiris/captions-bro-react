import { describe, expect, it } from 'vitest'
import {
  IDENTITY,
  applyMove,
  applyRotation,
  applyScale,
  mediaRect,
} from './transform'

describe('mediaRect — the WYSIWYG geometry (preview == export)', () => {
  const W = 1920
  const H = 1080

  it('centers a 16:9 source and fills the canvas at identity', () => {
    const r = mediaRect(IDENTITY, 16 / 9, W, H)
    expect(r.cx).toBeCloseTo(960)
    expect(r.cy).toBeCloseTo(540)
    expect(r.w).toBeCloseTo(1920)
    expect(r.h).toBeCloseTo(1080)
    expect(r.rotationDeg).toBe(0)
  })

  it('pillarboxes a portrait source (fills height, narrower width)', () => {
    const r = mediaRect(IDENTITY, 9 / 16, W, H)
    expect(r.h).toBeCloseTo(1080)
    // width = height * aspect = 1080 * 9/16
    expect(r.w).toBeCloseTo(607.5)
    expect(r.cx).toBeCloseTo(960)
  })

  it('scale grows about the center; translate is a fraction of the canvas', () => {
    const t = applyMove(applyScale(IDENTITY, 2), 0.25, -0.1)
    const r = mediaRect(t, 16 / 9, W, H)
    expect(r.w).toBeCloseTo(3840)
    expect(r.h).toBeCloseTo(2160)
    expect(r.cx).toBeCloseTo(960 + 0.25 * W)
    expect(r.cy).toBeCloseTo(540 - 0.1 * H)
  })

  it('is resolution-independent (proportional between preview and export sizes)', () => {
    const t = applyMove(applyScale(IDENTITY, 1.5), 0.1, 0.2)
    const big = mediaRect(t, 4 / 3, 1920, 1080)
    const small = mediaRect(t, 4 / 3, 960, 540)
    expect(big.cx / small.cx).toBeCloseTo(2)
    expect(big.w / small.w).toBeCloseTo(2)
    expect(big.rotationDeg).toBe(small.rotationDeg)
  })
})

describe('transform pointer helpers', () => {
  it('applyScale clamps and is relative to the current scale', () => {
    expect(applyScale(IDENTITY, 3).scale).toBeCloseTo(3)
    expect(applyScale({ ...IDENTITY, scale: 2 }, 2).scale).toBeCloseTo(4)
    expect(applyScale(IDENTITY, 1000).scale).toBeLessThanOrEqual(10)
    expect(applyScale(IDENTITY, 0.0001).scale).toBeGreaterThanOrEqual(0.1)
  })

  it('applyRotation snaps near right angles but leaves free angles alone', () => {
    expect(applyRotation(IDENTITY, 88).rotationDeg).toBe(90)
    expect(applyRotation(IDENTITY, 2).rotationDeg).toBe(0)
    expect(applyRotation(IDENTITY, 45).rotationDeg).toBe(45)
    expect(applyRotation(IDENTITY, 45, false).rotationDeg).toBe(45)
  })

  it('applyMove accumulates fractional offsets', () => {
    const t = applyMove(applyMove(IDENTITY, 0.1, 0.1), 0.2, -0.3)
    expect(t.tx).toBeCloseTo(0.3)
    expect(t.ty).toBeCloseTo(-0.2)
  })
})
