import { describe, expect, it } from 'vitest'
import {
  IDENTITY,
  anchorRectAt,
  applyCrop,
  applyMove,
  applyRotation,
  applyScale,
  containFit,
  cropInsets,
  cropValueForDrag,
  croppedRect,
  hitTestRect,
  mediaRect,
  placeRect,
  rectBounds,
  rectPoint,
  snapMove,
  toLocalDelta,
  visibleRect,
  wrapWidthForDrag,
} from './transform'
import type { RectAnchor, Transform } from './transform'

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

describe('corner resize anchors the OPPOSITE corner, never the center', () => {
  const W = 1920
  const H = 1080
  // A 4:3 source, so the fitted box is pillarboxed and its corners are not the
  // canvas corners — a center-anchored bug would still pass on a full-bleed box.
  const ASPECT = 4 / 3
  const fit = containFit(ASPECT, W, H)

  /** The (fx, fy) corner of the visible box under `t`, at a given natural size. */
  const corner = (
    t: Transform,
    fx: number,
    fy: number,
    size = fit,
  ): RectAnchor => ({
    fx,
    fy,
    ...rectPoint(visibleRect(t, size.w, size.h, W, H), fx, fy),
  })

  /**
   * The whole contract in one line: pin the (fx, fy) corner of `start`, resize
   * to `next` (any transform, any natural size), and that corner has not moved.
   * Returns the re-pinned transform so a test can assert more about it.
   */
  const repin = (
    start: Transform,
    fx: number,
    fy: number,
    next: Transform,
    size = fit,
  ) => {
    const anchor = corner(start, fx, fy)
    const out = anchorRectAt(next, size.w, size.h, W, H, anchor)
    const after = corner(out, fx, fy, size)
    expect(after.x).toBeCloseTo(anchor.x)
    expect(after.y).toBeCloseTo(anchor.y)
    return out
  }

  it('holds the top-left corner while the bottom-right one is dragged out', () => {
    const start = { ...IDENTITY, tx: 0.1, ty: -0.05 }
    const next = repin(start, 0, 0, applyScale(start, 2))
    // ...and the center genuinely moved, i.e. this is not the old behaviour.
    expect(next.tx).not.toBeCloseTo(start.tx)
    expect(next.ty).not.toBeCloseTo(start.ty)
  })

  it('anchors in the ROTATED frame, not the screen-axis one', () => {
    const start = { ...IDENTITY, rotationDeg: 37 }
    repin(start, 1, 0, applyScale(start, 0.4)) // dragging the bottom-left handle
  })

  it('anchors the visible box, so a cropped rect pins its trimmed corner', () => {
    const start = applyCrop(applyCrop(IDENTITY, 'left', 0.3), 'top', 0.2)
    repin(start, 1, 1, applyScale(start, 1.6))
  })

  it('re-pins exactly when the new size is NOT a multiple of the old one — the text re-wrap case', () => {
    // A bigger font at a fixed wrap width adds a line: width pinned, height +50%.
    // The anchor is read off the OLD box, the re-pin measured against the new.
    const start = { ...IDENTITY, ty: 0.2 }
    const anchor = corner(start, 0, 1, { w: 600, h: 200 })
    const next = anchorRectAt(start, 600, 300, W, H, anchor)
    const after = rectPoint(visibleRect(next, 600, 300, W, H), 0, 1)
    expect(after.x).toBeCloseTo(anchor.x)
    expect(after.y).toBeCloseTo(anchor.y)
  })

  it('keeps the anchor put when the scale clamp refuses the drag', () => {
    const start = { ...IDENTITY, scale: 10 } // already at MAX_SCALE
    const scaled = applyScale(start, 3)
    expect(scaled.scale).toBe(10) // clamped — nothing should move at all
    const next = repin(start, 0, 0, scaled)
    expect(next.tx).toBeCloseTo(start.tx)
    expect(next.ty).toBeCloseTo(start.ty)
  })
})

// ── The preview's pointer-gesture math ──────────────────────────────────────
// Lifted out of PreviewStage so the rules CLAUDE.md spends thirty lines on are
// executable rather than prose. The gestures themselves stay in the component
// (they need live client coords); everything below is the pure half.

describe('toLocalDelta — the ONE rotation inverse', () => {
  it('is the identity at 0°', () => {
    expect(toLocalDelta(3, 4, 0)).toMatchObject({ lx: 3, ly: 4 })
  })

  it('maps a screen-x drag onto the local y axis at 90°', () => {
    const { lx, ly } = toLocalDelta(10, 0, 90)
    expect(lx).toBeCloseTo(0)
    expect(ly).toBeCloseTo(-10)
  })

  it('round-trips through the forward rotation', () => {
    const deg = 37
    const { lx, ly } = toLocalDelta(5, -2, deg)
    const rad = (deg * Math.PI) / 180
    expect(lx * Math.cos(rad) - ly * Math.sin(rad)).toBeCloseTo(5)
    expect(lx * Math.sin(rad) + ly * Math.cos(rad)).toBeCloseTo(-2)
  })
})

describe('hitTestRect', () => {
  const W = 1920
  const H = 1080

  it('accepts the center and rejects a point well outside', () => {
    const r = mediaRect(IDENTITY, 16 / 9, W, H)
    expect(hitTestRect(r, 0, 0)).toBe(true)
    expect(hitTestRect(r, W, H)).toBe(false)
  })

  it('is inclusive exactly at an edge', () => {
    const r = mediaRect(IDENTITY, 16 / 9, W, H)
    expect(hitTestRect(r, r.w / 2, 0)).toBe(true)
    expect(hitTestRect(r, r.w / 2 + 1, 0)).toBe(false)
  })

  it('follows the rect’s rotation, not the screen axes', () => {
    const upright = mediaRect(IDENTITY, 4, W, H) // wide and short
    const turned = mediaRect({ ...IDENTITY, rotationDeg: 90 }, 4, W, H)
    // A point far along screen-x is inside the wide box…
    const x = upright.w / 2 - 1
    expect(hitTestRect(upright, x, 0)).toBe(true)
    // …and outside once the box is stood on end.
    expect(hitTestRect(turned, x, 0)).toBe(false)
  })

  it('hit-tests the VISIBLE box, so a cropped-away region is not grabbable', () => {
    const cropped = applyCrop(IDENTITY, 'left', 0.4)
    const full = mediaRect(cropped, 16 / 9, W, H)
    const visible = croppedRect(full)
    // A point inside the full rect but left of the trimmed edge.
    const dx = -full.w / 2 + 1
    expect(hitTestRect(full, dx, 0)).toBe(true)
    expect(hitTestRect(visible, dx - (visible.cx - full.cx), 0)).toBe(false)
  })
})

describe('wrapWidthForDrag', () => {
  const bounds = { min: 0.05, max: 1 }

  it('dragging the right edge out widens the box', () => {
    const next = wrapWidthForDrag(0.5, 'right', 100, 0, 0, 1000, bounds)
    // ×2 because the CENTER is held: one edge out by 100px adds 200px of box.
    expect(next).toBeCloseTo(0.7)
  })

  it('dragging the left edge out widens it by the same amount', () => {
    expect(wrapWidthForDrag(0.5, 'left', -100, 0, 0, 1000, bounds)).toBeCloseTo(
      0.7,
    )
  })

  it('dragging inward narrows it', () => {
    expect(
      wrapWidthForDrag(0.5, 'right', -100, 0, 0, 1000, bounds),
    ).toBeCloseTo(0.3)
  })

  it('projects onto the block’s own axis when rotated', () => {
    // At 90° the block's local +x points down the screen, so a DOWNWARD drag
    // on the right handle widens it — exactly as a rightward drag does at 0°…
    expect(
      wrapWidthForDrag(0.5, 'right', 0, 100, 90, 1000, bounds),
    ).toBeCloseTo(0.7)
    // …and a sideways drag now does nothing, because it is purely local-y.
    expect(
      wrapWidthForDrag(0.5, 'right', 100, 0, 90, 1000, bounds),
    ).toBeCloseTo(0.5)
  })

  it('clamps to the bounds', () => {
    expect(wrapWidthForDrag(0.9, 'right', 5000, 0, 0, 1000, bounds)).toBe(1)
    expect(wrapWidthForDrag(0.1, 'right', -5000, 0, 0, 1000, bounds)).toBe(0.05)
  })
})

describe('cropValueForDrag', () => {
  it('dragging the left edge inward raises the left inset', () => {
    const value = cropValueForDrag(IDENTITY, 'left', 100, 0, 0, 1000, 500)
    expect(value).toBeCloseTo(0.1)
  })

  it('dragging the right edge inward raises the right inset', () => {
    const value = cropValueForDrag(IDENTITY, 'right', -100, 0, 0, 1000, 500)
    expect(value).toBeCloseTo(0.1)
  })

  it('vertical edges scale against the media HEIGHT', () => {
    expect(cropValueForDrag(IDENTITY, 'top', 0, 50, 0, 1000, 500)).toBeCloseTo(
      0.1,
    )
    expect(
      cropValueForDrag(IDENTITY, 'bottom', 0, -50, 0, 1000, 500),
    ).toBeCloseTo(0.1)
  })

  it('accumulates from the inset the gesture started with', () => {
    const start = applyCrop(IDENTITY, 'left', 0.2)
    const value = cropValueForDrag(start, 'left', 100, 0, 0, 1000, 500)
    expect(value).toBeCloseTo(0.3)
  })

  it('projects onto the media’s own axes when rotated', () => {
    // At 90° the media's local +x is screen +y.
    const value = cropValueForDrag(IDENTITY, 'left', 0, 100, 90, 1000, 500)
    expect(value).toBeCloseTo(0.1)
  })

  it('feeds applyCrop, which is what clamps it', () => {
    const raw = cropValueForDrag(IDENTITY, 'left', 100000, 0, 0, 1000, 500)
    expect(raw).toBeGreaterThan(1)
    expect(cropInsets(applyCrop(IDENTITY, 'left', raw)).left).toBeLessThan(1)
  })
})

describe('rectBounds — the rotated silhouette', () => {
  const W = 1600
  const H = 900

  it('is the plain box at 0°', () => {
    const b = rectBounds(placeRect(IDENTITY, 200, 100, W, H))
    expect(b).toEqual({ left: 700, right: 900, top: 400, bottom: 500 })
  })

  it('swaps the extents at 90°', () => {
    const t = { ...IDENTITY, rotationDeg: 90 }
    const b = rectBounds(placeRect(t, 200, 100, W, H))
    expect(b.right - b.left).toBeCloseTo(100)
    expect(b.bottom - b.top).toBeCloseTo(200)
  })

  it('grows both extents to (w+h)/√2 at 45°', () => {
    const t = { ...IDENTITY, rotationDeg: 45 }
    const b = rectBounds(placeRect(t, 200, 100, W, H))
    const ext = (200 + 100) / Math.SQRT2
    expect(b.right - b.left).toBeCloseTo(ext)
    expect(b.bottom - b.top).toBeCloseTo(ext)
  })

  it('stays symmetric about the rect’s center at any angle', () => {
    const t = { ...IDENTITY, rotationDeg: 37 }
    const r = placeRect(t, 200, 100, W, H)
    const b = rectBounds(r)
    expect((b.left + b.right) / 2).toBeCloseTo(r.cx)
    expect((b.top + b.bottom) / 2).toBeCloseTo(r.cy)
  })
})

describe('snapMove — canvas edges and center lines', () => {
  const W = 1600
  const H = 900
  // A small box, so the edges the test isn't exercising start far from every
  // target and can't snap by accident.
  const NAT = { w: 200, h: 100 }
  /** The transform that puts the box's center at canvas pixel (cx, cy). */
  const at = (cx: number, cy: number): Transform => ({
    ...IDENTITY,
    tx: (cx - W / 2) / W,
    ty: (cy - H / 2) / H,
  })
  const snap = (t: Transform, w = NAT.w, h = NAT.h) =>
    snapMove(t, w, h, W, H, 8)

  it('snaps a centered box to the center lines', () => {
    const s = snap(at(800, 450))
    expect(s.guideX).toBe(0.5)
    expect(s.guideY).toBe(0.5)
    expect(s.transform.tx).toBeCloseTo(0)
    expect(s.transform.ty).toBeCloseTo(0)
  })

  it('snaps the left edge flush to the canvas edge', () => {
    const s = snap(at(105, 200)) // left edge 5px in
    expect(s.guideX).toBe(0)
    expect(s.transform.tx * W + W / 2 - NAT.w / 2).toBeCloseTo(0)
  })

  it('snaps the right edge flush to the canvas edge', () => {
    const s = snap(at(1496, 200)) // right edge 4px short
    expect(s.guideX).toBe(1)
    expect(s.transform.tx * W + W / 2 + NAT.w / 2).toBeCloseTo(W)
  })

  it('mirrors on the Y axis (top, bottom and the center line)', () => {
    expect(snap(at(200, 55)).guideY).toBe(0) // top edge 5px in
    expect(snap(at(200, 845)).guideY).toBe(1) // bottom edge 5px short
    expect(snap(at(200, 450)).guideY).toBe(0.5)
  })

  it('returns tx/ty VERBATIM when nothing is in range', () => {
    const t = at(200, 200)
    const s = snap(t)
    // Strict equality, not closeness: a free move must be byte-identical to an
    // unsnapped one — no float noise from a needless re-derivation.
    expect(s.transform.tx).toBe(t.tx)
    expect(s.transform.ty).toBe(t.ty)
    expect(s.guideX).toBeNull()
    expect(s.guideY).toBeNull()
  })

  it('does not snap exactly AT the threshold (the snapTime convention)', () => {
    const t = at(108, 200) // left edge exactly 8px in
    const s = snap(t)
    expect(s.guideX).toBeNull()
    expect(s.transform.tx).toBe(t.tx)
  })

  it('resolves the axes independently', () => {
    const t = at(105, 200) // x in range, y nowhere near a target
    const s = snap(t)
    expect(s.guideX).toBe(0)
    expect(s.guideY).toBeNull()
    expect(s.transform.ty).toBe(t.ty)
  })

  it('picks the NEAREST candidate, not the first one in range', () => {
    // A 1584-wide box centered at 795: the center line is 5px away and is
    // tested first, but the left edge is only 3px from the canvas edge.
    const s = snap(at(795, 200), 1584, 100)
    expect(s.guideX).toBe(0)
    expect(s.transform.tx * W + W / 2 - 1584 / 2).toBeCloseTo(0)
    // ...and the center wins once it is genuinely the closer of the two.
    expect(snap(at(797, 200), 1584, 100).guideX).toBe(0.5)
  })

  it('breaks a tie in favour of the center guide', () => {
    // A canvas-wide box has all three x candidates at distance 0. It must show
    // the one center line, not both edges.
    expect(snap(at(800, 200), W, 100).guideX).toBe(0.5)
  })

  it('snaps the ROTATED extent, not the unrotated box', () => {
    // A 400×100 box stood on end is 100 wide, so its silhouette's left edge is
    // 4px from the canvas edge. Measured unrotated it would be 146px out — far
    // outside the threshold, and nothing on this axis would snap at all.
    const t = { ...at(54, 450), rotationDeg: 90 }
    const s = snapMove(t, 400, 100, W, H, 8)
    expect(s.guideX).toBe(0)
    expect(s.transform.tx * W + W / 2 - 100 / 2).toBeCloseTo(0)
  })

  it('snaps the VISIBLE edge of a cropped clip', () => {
    // 25% trimmed off the left: the visible edge sits 5px from the canvas edge
    // while every full-rect candidate is 45px+ away.
    const t = applyCrop(at(55, 200), 'left', 0.25)
    const s = snap(t)
    expect(s.guideX).toBe(0)
    const r = visibleRect(s.transform, NAT.w, NAT.h, W, H)
    expect(rectBounds(r).left).toBeCloseTo(0)
  })

  it('measures the threshold in PIXELS, so it feels the same on both axes', () => {
    // A 7px vertical gap is 7/900 of the height — a LARGER fraction than the
    // 8/1600 an x-derived fractional threshold would allow, so a fraction-based
    // implementation refuses this snap.
    const s = snap(at(200, 57)) // top edge 7px in
    expect(s.guideY).toBe(0)
    expect(s.transform.ty * H + H / 2 - NAT.h / 2).toBeCloseTo(0)
  })

  it('passes through a degenerate canvas', () => {
    const t = at(105, 200)
    const s = snapMove(t, NAT.w, NAT.h, 0, 0, 8)
    expect(s.transform).toBe(t)
    expect(s.guideX).toBeNull()
    expect(s.guideY).toBeNull()
  })
})
