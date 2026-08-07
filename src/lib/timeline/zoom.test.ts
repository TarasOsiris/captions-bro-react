import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PX_PER_SEC,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  anchorScrollLeft,
  clampZoom,
  fitZoom,
  zoomAnchorTime,
  zoomBy,
} from './zoom'
import { TRACK_PAD, timeToX } from './ruler'

describe('clampZoom', () => {
  it('holds the bounds', () => {
    expect(clampZoom(1e6)).toBe(MAX_PX_PER_SEC)
    expect(clampZoom(0.001)).toBe(MIN_PX_PER_SEC)
    expect(clampZoom(100)).toBe(100)
  })

  it('falls back to the default rather than propagating a bad number', () => {
    expect(clampZoom(Number.NaN)).toBe(DEFAULT_PX_PER_SEC)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PX_PER_SEC)
  })
})

describe('zoomBy', () => {
  it('multiplies and clamps', () => {
    expect(zoomBy(40, 2)).toBe(80)
    expect(zoomBy(40, 0.5)).toBe(20)
    expect(zoomBy(MAX_PX_PER_SEC, 2)).toBe(MAX_PX_PER_SEC)
    expect(zoomBy(MIN_PX_PER_SEC, 0.5)).toBe(MIN_PX_PER_SEC)
  })

  it('ignores a nonsense factor instead of zeroing the scale', () => {
    expect(zoomBy(40, 0)).toBe(40)
    expect(zoomBy(40, -1)).toBe(40)
    expect(zoomBy(40, Number.NaN)).toBe(40)
  })
})

describe('fitZoom', () => {
  it('fits the duration into the usable width', () => {
    // 1000px viewport minus both insets = 952px. A 60s project needs to zoom
    // OUT to fit, so the "never past the default" cap does not bind here.
    expect(fitZoom(60, 1000)).toBeCloseTo(952 / 60)
  })

  it('never zooms IN past the default', () => {
    // A 3-second project should look normal, not stretched to 300px/s.
    expect(fitZoom(3, 1000)).toBe(DEFAULT_PX_PER_SEC)
  })

  it('returns the DEFAULT for an empty project, not MIN or Infinity', () => {
    expect(fitZoom(0, 1000)).toBe(DEFAULT_PX_PER_SEC)
    expect(fitZoom(-5, 1000)).toBe(DEFAULT_PX_PER_SEC)
  })

  it('survives a viewport narrower than the insets', () => {
    expect(fitZoom(10, 10)).toBe(DEFAULT_PX_PER_SEC)
    expect(fitZoom(10, 0)).toBe(DEFAULT_PX_PER_SEC)
  })

  it('clamps a very long project to MIN rather than going below it', () => {
    expect(fitZoom(100_000, 1000)).toBe(MIN_PX_PER_SEC)
  })
})

describe('anchorScrollLeft', () => {
  it('keeps a time under the same viewport x across a scale change', () => {
    // The contract that makes zooming feel anchored rather than jumping to 0.
    // The anchor is deep enough into the timeline that no scale here clamps.
    const anchorTime = 120
    const anchorX = 300
    for (const next of [10, 40, 120, 400]) {
      const scroll = anchorScrollLeft(anchorTime, anchorX, next)
      expect(timeToX(anchorTime, next) - scroll).toBeCloseTo(anchorX)
    }
  })

  it('pins to the start rather than scrolling negative', () => {
    // Near t=0 the anchor simply cannot be held that far right; the content
    // does not extend leftward. Clamping beats a negative scrollLeft the
    // browser would silently coerce anyway.
    expect(anchorScrollLeft(0, 500, 40)).toBe(0)
    expect(anchorScrollLeft(1, 500, 40)).toBe(0)
  })
})

describe('zoomAnchorTime', () => {
  const viewportWidth = 1000

  it('pivots on the PLAYHEAD when it is on screen', () => {
    expect(
      zoomAnchorTime({
        scrollLeft: 0,
        viewportWidth,
        playheadTime: 5,
        pxPerSec: 40,
      }),
    ).toBeCloseTo(5)
  })

  it('pivots on the viewport CENTRE when the playhead is off screen', () => {
    // Zooming while parked elsewhere should expand what you are looking at,
    // not yank the view to the playhead.
    const scrollLeft = 4000
    const t = zoomAnchorTime({
      scrollLeft,
      viewportWidth,
      playheadTime: 0,
      pxPerSec: 40,
    })
    expect(t).toBeCloseTo((scrollLeft + viewportWidth / 2 - TRACK_PAD) / 40)
  })

  it('never returns negative time', () => {
    expect(
      zoomAnchorTime({
        scrollLeft: 0,
        viewportWidth: 10,
        playheadTime: 9999,
        pxPerSec: 40,
      }),
    ).toBeGreaterThanOrEqual(0)
  })
})
