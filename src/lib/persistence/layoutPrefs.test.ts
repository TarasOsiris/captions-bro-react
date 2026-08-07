import { describe, expect, it } from 'vitest'
import {
  INSPECTOR_TAB_W,
  INSPECTOR_WIDTH,
  MEDIA_WIDTH,
  MIN_PREVIEW_W,
  clampPanelWidth,
  fitPanels,
} from './layoutPrefs'

const media = (preferred: number) => ({ ...MEDIA_WIDTH, preferred })
const inspector = (preferred: number) => ({ ...INSPECTOR_WIDTH, preferred })

describe('fitPanels', () => {
  it('leaves preferred widths alone when they fit', () => {
    expect(fitPanels([media(560), inspector(480)], 1920)).toEqual([560, 480])
  })

  it('clamps a stored width to the panel and rounds', () => {
    expect(fitPanels([media(9000), inspector(10.4)], 1920)).toEqual([560, 224])
  })

  // The pair is the whole point: 560 and 480 are each legal on their own, and
  // together they starve the preview on a laptop.
  it('shrinks the pair so the preview keeps its floor', () => {
    const [m, i] = fitPanels([media(560), inspector(480)], 1024)
    expect(m + i).toBeLessThanOrEqual(1024 - MIN_PREVIEW_W)
    expect(m).toBeGreaterThanOrEqual(MEDIA_WIDTH.min)
    expect(i).toBeGreaterThanOrEqual(INSPECTOR_WIDTH.min)
  })

  it('takes the same fraction of each panel"s slack', () => {
    const [m, i] = fitPanels([media(560), inspector(480)], 1024)
    const mFrac = (m - MEDIA_WIDTH.min) / (560 - MEDIA_WIDTH.min)
    const iFrac = (i - INSPECTOR_WIDTH.min) / (480 - INSPECTOR_WIDTH.min)
    expect(mFrac).toBeCloseTo(iFrac, 2)
  })

  // A re-fit must be reversible — it never touches the stored preference, so
  // widening the window has to restore the exact widths the user picked.
  it('restores the preferred widths when the row grows back', () => {
    expect(fitPanels([media(560), inspector(480)], 1024)).not.toEqual([
      560, 480,
    ])
    expect(fitPanels([media(560), inspector(480)], 1920)).toEqual([560, 480])
  })

  it('falls back to the minimums when even those do not fit', () => {
    expect(fitPanels([media(560), inspector(480)], 600)).toEqual([
      MEDIA_WIDTH.min,
      INSPECTOR_WIDTH.min,
    ])
  })

  it('handles a single panel (the other one hidden below lg)', () => {
    expect(fitPanels([media(560)], 1024)).toEqual([560])
    expect(fitPanels([media(560)], 700)).toEqual([380])
  })

  it('is a no-op on an empty list', () => {
    expect(fitPanels([], 1024)).toEqual([])
  })

  // With the inspector collapsed only the media column is in the budget, and
  // the edge tab that replaced it is invisible to fitPanels. That is safe only
  // because the media column can never reach the row's own floor at lg+, so the
  // tab's 20px is absorbed by slack rather than by the preview. Pin it: raising
  // MEDIA_WIDTH.max past 684 would silently start eating into the preview and
  // nothing else would catch it.
  it('leaves the preview its floor with the inspector collapsed', () => {
    const LG = 1024
    expect(fitPanels([media(MEDIA_WIDTH.max)], LG)).toEqual([MEDIA_WIDTH.max])
    expect(
      MEDIA_WIDTH.max + INSPECTOR_TAB_W + MIN_PREVIEW_W,
    ).toBeLessThanOrEqual(LG)
  })
})

describe('clampPanelWidth', () => {
  it('bounds and rounds', () => {
    expect(clampPanelWidth(MEDIA_WIDTH, 1e6)).toBe(MEDIA_WIDTH.max)
    expect(clampPanelWidth(MEDIA_WIDTH, 0)).toBe(MEDIA_WIDTH.min)
    expect(clampPanelWidth(MEDIA_WIDTH, 400.6)).toBe(401)
  })
})
