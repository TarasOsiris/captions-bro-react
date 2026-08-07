import { describe, expect, it } from 'vitest'
import { TRACK_PAD, tickModel, tickStep, timeToX, xToTime } from './ruler'
import { DEFAULT_PX_PER_SEC } from './zoom'

/** The scales the ruler has to stay honest at: zoomed out, default, zoomed in. */
const SCALES = [4, DEFAULT_PX_PER_SEC, 400]

describe('timeToX / xToTime', () => {
  it('starts the track at TRACK_PAD at every scale', () => {
    for (const s of SCALES) expect(timeToX(0, s)).toBe(TRACK_PAD)
  })

  it('advances by pxPerSec per second', () => {
    for (const s of SCALES) expect(timeToX(2, s) - timeToX(1, s)).toBeCloseTo(s)
  })

  it('round-trips at every scale', () => {
    for (const s of SCALES) {
      for (const t of [0, 0.25, 1, 7.5, 123]) {
        expect(xToTime(timeToX(t, s), s)).toBeCloseTo(t)
      }
    }
  })

  it('floors at 0 — the inset is not negative time', () => {
    for (const s of SCALES) expect(xToTime(0, s)).toBe(0)
    expect(xToTime(-500, DEFAULT_PX_PER_SEC)).toBe(0)
  })
})

describe('tickStep', () => {
  it('picks the smallest step that keeps labels apart', () => {
    // Unchanged at the default scale: 1s labels sit 40px apart, under the 56px
    // minimum, so the step is 2s.
    expect(tickStep(DEFAULT_PX_PER_SEC)).toBe(2)
  })

  it('goes SUB-SECOND when zoomed in', () => {
    // The reason the ladder was extended downward: at 400px/s a 1s step would
    // put labels 400px apart and the ruler would read as nearly blank.
    expect(tickStep(400)).toBeLessThan(1)
    expect(tickStep(500)).toBeLessThan(1)
  })

  it('goes to minutes and beyond when zoomed out', () => {
    expect(tickStep(4)).toBeGreaterThanOrEqual(15)
    expect(tickStep(2)).toBeGreaterThanOrEqual(30)
  })

  it('always keeps labels at least the minimum apart', () => {
    for (const s of [2, 4, 10, 40, 100, 400, 500]) {
      expect(tickStep(s) * s).toBeGreaterThanOrEqual(56)
    }
  })
})

describe('tickModel — virtualized by x window', () => {
  it('emits only the ticks in the window (plus a margin)', () => {
    // The whole point: a 30 000px content width must not become 2 600 spans.
    const wide = tickModel(0, 30_000, 400)
    const window = tickModel(10_000, 11_000, 400)
    expect(window.length).toBeLessThan(wide.length / 10)
  })

  it('keeps the tick COUNT bounded by the viewport, not the project', () => {
    // A 1000px window costs the same wherever it sits along a long timeline —
    // scrolling to 50 000px must not cost 50x more nodes. (The window at the
    // very start is a few ticks shorter: it clamps at t=0 instead of carrying
    // a left margin.)
    const atStart = tickModel(0, 1000, 100).length
    const farAlong = tickModel(50_000, 51_000, 100).length
    expect(farAlong).toBeLessThan(atStart + 5)
    expect(farAlong).toBeLessThan(60)
  })

  it('aligns ticks to ABSOLUTE time, not to the window origin', () => {
    // Ticks must not crawl as you scroll: a tick present in two overlapping
    // windows has to land on the same t in both.
    const left = tickModel(1000, 2000, 40)
    const right = tickModel(1500, 2500, 40)
    const shared = left.filter((t) => right.some((r) => r.t === t.t))
    expect(shared.length).toBeGreaterThan(0)
    for (const tick of shared) {
      const other = right.find((r) => r.t === tick.t)
      expect(other?.major).toBe(tick.major)
    }
  })

  it('makes every fifth tick major', () => {
    const ticks = tickModel(0, 1000, 40)
    const majors = ticks.filter((t) => t.major)
    expect(majors.length).toBeGreaterThan(0)
    for (const m of majors) {
      expect(Math.round(m.t / tickStep(40)) * tickStep(40)).toBeCloseTo(m.t)
    }
  })

  it('never emits negative time', () => {
    for (const tick of tickModel(-500, 500, 40)) {
      expect(tick.t).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns nothing for a degenerate window or scale', () => {
    expect(tickModel(500, 500, 40)).toEqual([])
    expect(tickModel(600, 500, 40)).toEqual([])
    expect(tickModel(0, 500, 0)).toEqual([])
  })
})
