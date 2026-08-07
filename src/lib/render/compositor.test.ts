import { describe, expect, it, vi } from 'vitest'
import { drawScene } from './compositor'
import { IDENTITY } from '@/lib/transform'
import type { DrawItem } from './compositor'
import type { CanvasSettings } from '@/lib/model/types'

const CANVAS: CanvasSettings = {
  width: 1920,
  height: 1080,
  background: '#000000',
}

/**
 * A 2D context stub that records the calls drawScene makes.
 *
 * `save`/`restore` really do stack `globalAlpha` rather than being pure spies:
 * a no-op restore would let one item's alpha leak into the next and the
 * non-leakage test below would pass vacuously, which is the one thing it exists
 * to catch.
 */
function fakeCtx() {
  const painted: Array<{
    dx: number
    dy: number
    dw: number
    dh: number
    alpha: number
  }> = []
  const stack: number[] = []
  const ctx = {
    globalAlpha: 1,
    save: vi.fn(() => {
      stack.push(ctx.globalAlpha)
    }),
    restore: vi.fn(() => {
      ctx.globalAlpha = stack.pop() ?? 1
    }),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
  }
  /** A source that records the destination rect AND the alpha in force. */
  const recorder = (
    extent: { aspect: number } | { size: { w: number; h: number } },
  ) =>
    ({
      ...extent,
      paint: (_c: unknown, dx: number, dy: number, dw: number, dh: number) => {
        painted.push({ dx, dy, dw, dh, alpha: ctx.globalAlpha })
      },
    }) as NonNullable<DrawItem['source']>
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    painted,
    recorder,
  }
}

function item(source: DrawItem['source']): DrawItem {
  return { transform: { ...IDENTITY }, source }
}

describe('drawScene — the two source extents', () => {
  it('CONTAIN-FITS an aspect source (media)', () => {
    const { ctx, painted, recorder } = fakeCtx()
    drawScene(ctx, CANVAS, [item(recorder({ aspect: 2 }))])
    // 2:1 into 16:9 → fills the width, letterboxed.
    expect(painted[0].dw).toBeCloseTo(1920)
    expect(painted[0].dh).toBeCloseTo(960)
  })

  it('places a natural-SIZE source as-is (text) — never contain-fit', () => {
    const { ctx, painted, recorder } = fakeCtx()
    drawScene(ctx, CANVAS, [item(recorder({ size: { w: 600, h: 300 } }))])
    // Same 2:1 ratio as above, but it must stay 600 wide, not blow up to 1920.
    expect(painted[0].dw).toBeCloseTo(600)
    expect(painted[0].dh).toBeCloseTo(300)
    expect(painted[0].dx).toBeCloseTo(-300)
    expect(painted[0].dy).toBeCloseTo(-150)
  })

  it('scales a natural-size source by transform.scale', () => {
    const { ctx, painted, recorder } = fakeCtx()
    drawScene(ctx, CANVAS, [
      {
        transform: { ...IDENTITY, scale: 1.5 },
        source: recorder({ size: { w: 600, h: 300 } }),
      },
    ])
    expect(painted[0].dw).toBeCloseTo(900)
    expect(painted[0].dh).toBeCloseTo(450)
  })

  it('draws items in list order, so an overlay lands on top', () => {
    const { ctx } = fakeCtx()
    const order: string[] = []
    drawScene(ctx, CANVAS, [
      item({ aspect: 16 / 9, paint: () => order.push('video') }),
      item({ size: { w: 400, h: 100 }, paint: () => order.push('text') }),
    ])
    expect(order).toEqual(['video', 'text'])
  })

  it('skips an item whose source is still loading', () => {
    const { ctx } = fakeCtx()
    const paint = vi.fn()
    drawScene(ctx, CANVAS, [item(null), item({ aspect: 1, paint })])
    expect(paint).toHaveBeenCalledTimes(1)
  })
})

describe('drawScene — per-item opacity', () => {
  it('applies the alpha for the duration of the item', () => {
    const { ctx, painted, recorder } = fakeCtx()
    drawScene(ctx, CANVAS, [{ ...item(recorder({ aspect: 1 })), opacity: 0.5 }])
    expect(painted[0].alpha).toBeCloseTo(0.5)
  })

  it('leaves alpha at 1 when opacity is ABSENT (every old document)', () => {
    const { ctx, painted, recorder } = fakeCtx()
    drawScene(ctx, CANVAS, [item(recorder({ aspect: 1 }))])
    expect(painted[0].alpha).toBe(1)
  })

  it('does NOT leak alpha onto the next item', () => {
    // The bug this pins: setting globalAlpha outside the per-item save/restore
    // would fade every layer above a semi-transparent one.
    const { ctx, painted, recorder } = fakeCtx()
    drawScene(ctx, CANVAS, [
      { ...item(recorder({ aspect: 1 })), opacity: 0.25 },
      item(recorder({ aspect: 1 })),
      { ...item(recorder({ size: { w: 10, h: 5 } })), opacity: 0.75 },
    ])
    expect(painted.map((p) => p.alpha)).toEqual([0.25, 1, 0.75])
    expect(ctx.globalAlpha).toBe(1)
  })

  it('SKIPS a fully transparent item rather than painting it', () => {
    const { ctx, painted, recorder } = fakeCtx()
    drawScene(ctx, CANVAS, [
      { ...item(recorder({ aspect: 1 })), opacity: 0 },
      item(recorder({ aspect: 1 })),
    ])
    expect(painted).toHaveLength(1)
    expect(painted[0].alpha).toBe(1)
  })
})
