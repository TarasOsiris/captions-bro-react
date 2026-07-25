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

/** A 2D context stub that records the calls drawScene makes. */
function fakeCtx() {
  const painted: Array<{ dx: number; dy: number; dw: number; dh: number }> = []
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, painted }
}

function item(source: DrawItem['source']): DrawItem {
  return { transform: { ...IDENTITY }, source }
}

describe('drawScene — the two source extents', () => {
  it('CONTAIN-FITS an aspect source (media)', () => {
    const { ctx, painted } = fakeCtx()
    drawScene(ctx, CANVAS, [
      item({
        aspect: 2,
        paint: (_c, dx, dy, dw, dh) => painted.push({ dx, dy, dw, dh }),
      }),
    ])
    // 2:1 into 16:9 → fills the width, letterboxed.
    expect(painted[0].dw).toBeCloseTo(1920)
    expect(painted[0].dh).toBeCloseTo(960)
  })

  it('places a natural-SIZE source as-is (text) — never contain-fit', () => {
    const { ctx, painted } = fakeCtx()
    drawScene(ctx, CANVAS, [
      item({
        size: { w: 600, h: 300 },
        paint: (_c, dx, dy, dw, dh) => painted.push({ dx, dy, dw, dh }),
      }),
    ])
    // Same 2:1 ratio as above, but it must stay 600 wide, not blow up to 1920.
    expect(painted[0].dw).toBeCloseTo(600)
    expect(painted[0].dh).toBeCloseTo(300)
    expect(painted[0].dx).toBeCloseTo(-300)
    expect(painted[0].dy).toBeCloseTo(-150)
  })

  it('scales a natural-size source by transform.scale', () => {
    const { ctx, painted } = fakeCtx()
    drawScene(ctx, CANVAS, [
      {
        transform: { ...IDENTITY, scale: 1.5 },
        source: {
          size: { w: 600, h: 300 },
          paint: (_c, dx, dy, dw, dh) => painted.push({ dx, dy, dw, dh }),
        },
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
