import { describe, expect, it } from 'vitest'
import { TRACK_PAD, boundaryX, tickModel, timeToX, xToTime } from './ruler'
import { TIMELINE_PX_PER_SEC } from '@/lib/thumbs'

describe('timeToX / xToTime', () => {
  it('t=0 sits at the track inset, not at x=0', () => {
    expect(timeToX(0)).toBe(TRACK_PAD)
  })

  it('advances by PX_PER_SEC per second', () => {
    expect(timeToX(2) - timeToX(1)).toBeCloseTo(TIMELINE_PX_PER_SEC)
  })

  it('round-trips', () => {
    for (const t of [0, 0.5, 3, 42.25]) {
      expect(xToTime(timeToX(t))).toBeCloseTo(t)
    }
  })

  it('floors at 0 — a drag left of the inset must not seek negative', () => {
    expect(xToTime(0)).toBe(0)
    expect(xToTime(-500)).toBe(0)
  })
})

describe('boundaryX', () => {
  const clips = [{ duration: 2 }, { duration: 3 }, { duration: 1 }]

  it('index 0 is the start of the track', () => {
    expect(boundaryX(clips, 0)).toBe(timeToX(0))
  })

  it('accumulates the durations before the index', () => {
    expect(boundaryX(clips, 2)).toBeCloseTo(timeToX(5))
  })

  it('clamps past the end to the total duration', () => {
    expect(boundaryX(clips, 99)).toBeCloseTo(timeToX(6))
  })
})

describe('tickModel', () => {
  it('every fifth tick is major', () => {
    const ticks = tickModel(1000)
    expect(ticks[0].major).toBe(true)
    expect(ticks[1].major).toBe(false)
    expect(ticks[5].major).toBe(true)
  })

  it('ticks are evenly spaced and start at zero', () => {
    const ticks = tickModel(1000)
    expect(ticks[0].t).toBe(0)
    const step = ticks[1].t - ticks[0].t
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].t - ticks[i - 1].t).toBeCloseTo(step)
    }
  })

  it('covers the ruler without running far past it', () => {
    const width = 1200
    const ticks = tickModel(width)
    const last = ticks[ticks.length - 1]
    expect(timeToX(last.t)).toBeLessThanOrEqual(width + TRACK_PAD)
  })

  it('a zero-width ruler still yields the origin tick', () => {
    expect(tickModel(0)).toEqual([{ t: 0, major: true }])
  })
})
