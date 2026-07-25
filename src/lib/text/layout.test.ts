import { describe, expect, it } from 'vitest'
import { REF_FONT_PX, clearLayoutCache, layoutText } from './layout'
import { DEFAULT_TEXT_STYLE } from '@/lib/model/text'
import type { TextMeasurer } from './measure'
import type { TextStyle } from '@/lib/model/text'

/**
 * A deterministic stand-in for the browser. Deliberately LINEAR in font size —
 * the real `measureText` is not, which is exactly why layout measures at
 * REF_FONT_PX and scales. Because layout only ever asks at the reference size,
 * a linear fake is a faithful model of the code path under test.
 */
const fake: TextMeasurer = {
  width: (text, font, letterSpacing) => {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16)
    return text.length * 0.5 * px + letterSpacing * text.length
  },
  metrics: (font) => {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16)
    return { ascent: px * 0.8, descent: px * 0.2 }
  },
}

function style(patch: Partial<TextStyle> = {}): TextStyle {
  return { ...DEFAULT_TEXT_STYLE, ...patch }
}

const lay = (s: TextStyle, text = 'sample', w = 1920, h = 1080) =>
  layoutText(s, text, w, h, fake)

describe('layoutText — resolution independence (THE WYSIWYG guarantee)', () => {
  const s = style({ fontSize: 0.08, boxWidth: 0.7 })
  const text =
    'The quick brown fox jumps over the lazy dog and keeps on running'

  it('produces identical LINE BREAKS at every canvas size', () => {
    // If this ever fails, preview and export are wrapping differently and the
    // exported video does not match what the user positioned.
    const at1080 = lay(s, text, 1920, 1080)
    const at540 = lay(s, text, 960, 540)
    const at270 = lay(s, text, 480, 270)
    expect(at540.lines.map((l) => l.text)).toEqual(
      at1080.lines.map((l) => l.text),
    )
    expect(at270.lines.map((l) => l.text)).toEqual(
      at1080.lines.map((l) => l.text),
    )
    expect(at1080.lines.length).toBeGreaterThan(1) // the case is real
  })

  it('scales every dimension exactly with the canvas', () => {
    const big = lay(s, text, 1920, 1080)
    const small = lay(s, text, 960, 540)
    expect(big.width / small.width).toBeCloseTo(2)
    expect(big.height / small.height).toBeCloseTo(2)
    expect(big.fontPx / small.fontPx).toBeCloseTo(2)
    expect(big.lineHeightPx / small.lineHeightPx).toBeCloseTo(2)
    expect(big.padX / small.padX).toBeCloseTo(2)
    expect(big.strokePx / small.strokePx || 1).toBeCloseTo(1) // 0/0 guard
    expect(big.baselineOffset / small.baselineOffset).toBeCloseTo(2)
  })

  it('measures at the reference size regardless of the final size', () => {
    const seen: string[] = []
    const spy: TextMeasurer = {
      width: (t, font, ls) => {
        seen.push(font)
        return fake.width(t, font, ls)
      },
      metrics: fake.metrics,
    }
    layoutText(style(), 'hello world', 1920, 1080, spy)
    expect(seen.length).toBeGreaterThan(0)
    for (const font of seen) expect(font).toContain(`${REF_FONT_PX}px`)
  })
})

describe('layoutText — units', () => {
  it('fontSize is a fraction of canvas HEIGHT', () => {
    expect(lay(style({ fontSize: 0.1 }), 'x', 1920, 1080).fontPx).toBeCloseTo(
      108,
    )
    expect(lay(style({ fontSize: 0.1 }), 'x', 800, 600).fontPx).toBeCloseTo(60)
  })

  it('em fields resolve against the font size, not the canvas', () => {
    const L = lay(style({ fontSize: 0.1, bgPaddingX: 0.5, lineHeight: 1.5 }))
    expect(L.padX).toBeCloseTo(0.5 * 108)
    expect(L.lineHeightPx).toBeCloseTo(1.5 * 108)
  })
})

describe('layoutText — wrapping', () => {
  it('never lets a line exceed the wrap width', () => {
    const s = style({ fontSize: 0.06, boxWidth: 0.5 })
    const L = lay(s, 'alpha beta gamma delta epsilon zeta eta theta iota')
    const wrapPx = s.boxWidth * 1920 - 2 * L.padX
    expect(L.lines.length).toBeGreaterThan(1)
    for (const line of L.lines) expect(line.width).toBeLessThanOrEqual(wrapPx)
  })

  it('keeps short text on one line', () => {
    expect(lay(style({ boxWidth: 0.9 }), 'hi').lines).toHaveLength(1)
  })

  it('always breaks on a hard newline', () => {
    const L = lay(style({ boxWidth: 0.9 }), 'one\ntwo')
    expect(L.lines.map((l) => l.text)).toEqual(['one', 'two'])
  })

  it('preserves an empty paragraph as a full-height empty line', () => {
    const L = lay(style({ boxWidth: 0.9 }), 'a\n\nb')
    expect(L.lines).toHaveLength(3)
    expect(L.lines[1].text).toBe('')
    expect(L.height).toBeCloseTo(3 * L.lineHeightPx + 2 * L.padY)
  })

  it('breaks a single over-long token instead of overflowing', () => {
    const s = style({ fontSize: 0.06, boxWidth: 0.4 })
    const L = lay(
      s,
      'https://example.com/an/extremely/long/path/that/never/ends',
    )
    const wrapPx = s.boxWidth * 1920 - 2 * L.padX
    expect(L.lines.length).toBeGreaterThan(1)
    for (const line of L.lines) expect(line.width).toBeLessThanOrEqual(wrapPx)
  })

  it('never splits a ZWJ emoji cluster', () => {
    const family = '👨‍👩‍👧‍👦'
    const L = lay(style({ fontSize: 0.09, boxWidth: 0.2 }), family.repeat(6))
    for (const line of L.lines) {
      // A split cluster would leave a bare ZWJ at an edge.
      expect(line.text.startsWith('‍')).toBe(false)
      expect(line.text.endsWith('‍')).toBe(false)
    }
  })
})

describe('layoutText — alignment', () => {
  const text = 'a longer first line\nshort'

  it('left-aligns at x=0', () => {
    const L = lay(style({ align: 'left', boxWidth: 0.9 }), text)
    expect(L.lines[0].x).toBeCloseTo(0)
    expect(L.lines[1].x).toBeCloseTo(0)
  })

  it('centers and right-aligns relative to the longest line', () => {
    const c = lay(style({ align: 'center', boxWidth: 0.9 }), text)
    const contentWidth = c.width - 2 * c.padX
    expect(c.lines[0].x).toBeCloseTo(0) // longest line always anchors at 0
    expect(c.lines[1].x).toBeCloseTo((contentWidth - c.lines[1].width) / 2)

    const r = lay(style({ align: 'right', boxWidth: 0.9 }), text)
    expect(r.lines[1].x).toBeCloseTo(contentWidth - r.lines[1].width)
  })
})

describe('layoutText — case is a style, not a mutation', () => {
  it('uppercases the laid-out copy', () => {
    expect(lay(style({ case: 'upper' }), 'hello').lines[0].text).toBe('HELLO')
  })

  it('capitalizes each word', () => {
    expect(
      lay(style({ case: 'capitalize' }), 'hello big world').lines[0].text,
    ).toBe('Hello Big World')
  })

  it('leaves the input style object untouched', () => {
    const s = style({ case: 'upper' })
    lay(s, 'hello')
    expect(s.case).toBe('upper')
  })
})

describe('layoutText — natural size', () => {
  it('includes background padding even when the box is invisible', () => {
    const off = lay(style({ bgOpacity: 0 }), 'hello')
    const on = lay(style({ bgOpacity: 1 }), 'hello')
    // Turning the background on must not move or resize anything.
    expect(off.width).toBeCloseTo(on.width)
    expect(off.height).toBeCloseTo(on.height)
    expect(off.width).toBeGreaterThan(off.lines[0].width)
  })

  it('excludes outline and shadow bleed, so they never resize the block', () => {
    const plain = lay(style(), 'hello')
    const decorated = lay(
      style({ strokeWidth: 0.2, shadowBlur: 0.5, shadowOffsetX: 0.3 }),
      'hello',
    )
    expect(decorated.width).toBeCloseTo(plain.width)
    expect(decorated.height).toBeCloseTo(plain.height)
  })

  it('gives empty content a grabbable box so the clip stays selectable', () => {
    const L = lay(style(), '')
    expect(L.width).toBeGreaterThan(0)
    expect(L.height).toBeGreaterThan(0)
  })

  it('survives a clip whose optional `text` was never set', () => {
    const L = layoutText(style(), undefined, 1920, 1080, fake)
    expect(L.width).toBeGreaterThan(0)
    expect(L.lines).toHaveLength(1)
  })

  it('height is lines × lineHeight + vertical padding', () => {
    const L = lay(style({ boxWidth: 0.9 }), 'a\nb\nc')
    expect(L.height).toBeCloseTo(3 * L.lineHeightPx + 2 * L.padY)
  })
})

describe('layoutText — letter spacing', () => {
  it('widens a line and can force an extra wrap', () => {
    const text = 'wide tracking pushes this over the edge'
    const tight = lay(style({ fontSize: 0.05, boxWidth: 0.5 }), text)
    const loose = lay(
      style({ fontSize: 0.05, boxWidth: 0.5, letterSpacing: 0.3 }),
      text,
    )
    expect(loose.letterSpacingPx).toBeGreaterThan(0)
    expect(loose.lines.length).toBeGreaterThanOrEqual(tight.lines.length)
  })

  it('resolves tracking in em against the font size', () => {
    const L = lay(style({ fontSize: 0.1, letterSpacing: 0.05 }), 'x')
    expect(L.letterSpacingPx).toBeCloseTo(0.05 * 108)
  })
})

describe('fontShorthand', () => {
  it('carries weight, style, size and a fallback stack', () => {
    const L = lay(style({ bold: true, italic: true, fontFamily: 'Anton' }))
    expect(L.font).toContain('italic')
    expect(L.font).toContain('700')
    expect(L.font).toContain('"Anton"')
    expect(L.font).toContain('sans-serif')
  })
})

describe('layout cache', () => {
  it('clears without throwing', () => {
    lay(style(), 'hello')
    expect(() => {
      clearLayoutCache()
    }).not.toThrow()
  })
})
