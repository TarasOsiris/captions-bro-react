import { describe, expect, it } from 'vitest'
import {
  IDENTITY,
  applyCrop,
  applyMove,
  applyRotation,
  applyScale,
  containFit,
  croppedRect,
  mediaRect,
  placeRect,
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

describe('placeRect — natural-size placement (the text path)', () => {
  const W = 1920
  const H = 1080

  it('places a natural-size box AS IS — it does not contain-fit it', () => {
    // The whole reason placeRect exists: a 2:1 text block must stay 400×200,
    // not be blown up to 1920 wide the way mediaRect would size a 2:1 video.
    const r = placeRect(IDENTITY, 400, 200, W, H)
    expect(r.cx).toBeCloseTo(960)
    expect(r.cy).toBeCloseTo(540)
    expect(r.w).toBeCloseTo(400)
    expect(r.h).toBeCloseTo(200)
    expect(mediaRect(IDENTITY, 2, W, H).w).toBeCloseTo(1920) // contrast
  })

  it('applies scale, translation and rotation exactly as mediaRect does', () => {
    const t = applyRotation(
      applyMove(applyScale(IDENTITY, 1.5), 0.25, -0.1),
      30,
    )
    const r = placeRect(t, 400, 200, W, H)
    expect(r.w).toBeCloseTo(600)
    expect(r.h).toBeCloseTo(300)
    expect(r.cx).toBeCloseTo(960 + 0.25 * W)
    expect(r.cy).toBeCloseTo(540 - 0.1 * H)
    expect(r.rotationDeg).toBe(30)
  })

  it('mediaRect is exactly placeRect ∘ containFit (the refactor is behaviour-free)', () => {
    const transforms = [
      IDENTITY,
      applyScale(IDENTITY, 2),
      applyMove(IDENTITY, 0.3, -0.2),
      applyRotation(IDENTITY, 45, false),
      applyCrop(applyScale(IDENTITY, 1.5), 'left', 0.2),
    ]
    for (const t of transforms) {
      for (const aspect of [16 / 9, 9 / 16, 1, 4 / 3, 2.39]) {
        for (const [cw, ch] of [
          [1920, 1080],
          [960, 540],
          [800, 600],
        ]) {
          const fit = containFit(aspect, cw, ch)
          expect(mediaRect(t, aspect, cw, ch)).toEqual(
            placeRect(t, fit.w, fit.h, cw, ch),
          )
        }
      }
    }
  })

  it('is resolution-independent when the natural size scales with the canvas', () => {
    // How text behaves: its box is derived from canvas-relative fractions, so
    // halving the canvas halves the natural size — and every dimension halves.
    const t = applyMove(applyScale(IDENTITY, 1.5), 0.1, 0.2)
    const big = placeRect(t, 800, 200, 1920, 1080)
    const small = placeRect(t, 400, 100, 960, 540)
    expect(big.cx / small.cx).toBeCloseTo(2)
    expect(big.cy / small.cy).toBeCloseTo(2)
    expect(big.w / small.w).toBeCloseTo(2)
    expect(big.h / small.h).toBeCloseTo(2)
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

describe('crop — edge handles trim, not scale', () => {
  it('applyCrop sets the named inset without touching scale', () => {
    const t = applyCrop(IDENTITY, 'left', 0.25)
    expect(t.crop?.left).toBeCloseTo(0.25)
    expect(t.scale).toBe(1) // trimming never resizes the media
  })

  it('applyCrop clamps to [0, 1 - opposite - min-visible] and never negative', () => {
    expect(applyCrop(IDENTITY, 'top', -0.5).crop?.top).toBe(0)
    // Opposite edge already at 0.5 → the other side can trim at most ~0.45.
    const half = applyCrop(IDENTITY, 'right', 0.5)
    expect(applyCrop(half, 'left', 0.9).crop?.left).toBeLessThanOrEqual(
      0.45 + 1e-9,
    )
  })

  it('croppedRect shrinks the box and shifts its center toward the kept side', () => {
    const r = mediaRect(applyCrop(IDENTITY, 'left', 0.25), 16 / 9, 1920, 1080)
    const v = croppedRect(r)
    // Trimming 25% off the left keeps 75% of the width...
    expect(v.w).toBeCloseTo(1920 * 0.75)
    expect(v.h).toBeCloseTo(1080)
    // ...and the visible center moves right by half the trimmed amount.
    expect(v.cx).toBeCloseTo(960 + (1920 * 0.25) / 2)
    expect(v.cy).toBeCloseTo(540)
  })

  it('an uncropped rect is unchanged by croppedRect', () => {
    const r = mediaRect(IDENTITY, 16 / 9, 1920, 1080)
    const v = croppedRect(r)
    expect(v.cx).toBeCloseTo(r.cx)
    expect(v.w).toBeCloseTo(r.w)
    expect(v.h).toBeCloseTo(r.h)
  })
})
