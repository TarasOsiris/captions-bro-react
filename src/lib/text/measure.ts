// The DOM half of text layout: a shared 2D context used ONLY for `measureText`,
// plus the caches that make measuring affordable at 60fps.
//
// SSR: the canvas is created on FIRST CALL, never at module scope — importing
// this file on the server must be inert (see the SSR rule in CLAUDE.md).
//
// Measuring on a different context than the one being painted is safe: text
// metrics depend on the font shorthand, not on the canvas it came from. That is
// what lets the preview (a DPR-sized canvas) and the export (1920×1080) share a
// single measurement cache — see REF_FONT_PX in ./layout.

/** What ./layout needs from the platform. Injected, so layout stays pure and
 *  unit-testable in the node vitest env with a fake. */
export interface TextMeasurer {
  /** Advance width of `text` in `font` (a canvas font shorthand), including
   *  `letterSpacingPx` of tracking. */
  width: (text: string, font: string, letterSpacingPx: number) => number
  /** Font box metrics for `font`, in px. */
  metrics: (font: string) => { ascent: number; descent: number }
}

let ctx: CanvasRenderingContext2D | null = null
let ctxTried = false

/** The shared measuring context, created lazily. Null under SSR / no canvas. */
function measuringCtx(): CanvasRenderingContext2D | null {
  if (ctxTried) return ctx
  ctxTried = true
  if (typeof document === 'undefined') return null
  try {
    ctx = document.createElement('canvas').getContext('2d')
  } catch {
    ctx = null
  }
  return ctx
}

/**
 * Bumped whenever a webfont finishes loading. It is part of every cache key, so
 * text re-lays-out against the REAL metrics once the face arrives instead of
 * staying on the fallback's forever.
 */
let version = 0
export function fontsVersion(): number {
  return version
}
export function bumpFontsVersion(): void {
  version++
}

let spacingSupport: boolean | null = null
/** `ctx.letterSpacing` — Chrome 99+, Safari 17.4+, Firefox 126+. */
export function supportsLetterSpacing(): boolean {
  if (spacingSupport != null) return spacingSupport
  const c = measuringCtx()
  spacingSupport = c != null && 'letterSpacing' in c
  return spacingSupport
}

// The rAF preview loop re-measures the same strings ~60×/s, so without a cache
// this is the hot path. Cleared wholesale rather than LRU-evicted: the working
// set is tiny (one project's worth of lines) and a full clear is O(1).
const CACHE_LIMIT = 4000
const widthCache = new Map<string, number>()
const metricsCache = new Map<string, { ascent: number; descent: number }>()

/** Drop every cached measurement. Exported for tests and font reloads. */
export function clearMeasureCache(): void {
  widthCache.clear()
  metricsCache.clear()
}

/** Fallback metrics when there is no canvas (SSR) or the browser reports none. */
function approximateMetrics(font: string): {
  ascent: number
  descent: number
} {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16)
  return { ascent: px * 0.8, descent: px * 0.2 }
}

/** Rough advance width used only when there is no canvas at all (SSR). */
function approximateWidth(
  text: string,
  font: string,
  letterSpacingPx: number,
): number {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16)
  return text.length * px * 0.5 + letterSpacingPx * text.length
}

/** The real measurer. Cheap to call — everything behind it is memoized. */
export function canvasMeasurer(): TextMeasurer {
  return {
    width(text, font, letterSpacingPx) {
      if (text === '') return 0
      const key = `${version}|${font}|${letterSpacingPx}|${text}`
      const hit = widthCache.get(key)
      if (hit != null) return hit
      const c = measuringCtx()
      let w: number
      if (!c) {
        w = approximateWidth(text, font, letterSpacingPx)
      } else {
        c.font = font
        // The context is shared state — always set AND reset tracking, or the
        // next caller measures with someone else's spacing.
        if (supportsLetterSpacing()) {
          c.letterSpacing = `${letterSpacingPx}px`
          w = c.measureText(text).width
          c.letterSpacing = '0px'
        } else {
          // No native tracking: add it per grapheme cluster, matching what
          // `drawSpacedText` paints (including the trailing gap, which is what
          // ctx.letterSpacing does) so wrapping and painting can't disagree.
          w = c.measureText(text).width + letterSpacingPx * clusterCount(text)
        }
      }
      if (widthCache.size >= CACHE_LIMIT) widthCache.clear()
      widthCache.set(key, w)
      return w
    },

    metrics(font) {
      const key = `${version}|${font}`
      const hit = metricsCache.get(key)
      if (hit) return hit
      const c = measuringCtx()
      let m: { ascent: number; descent: number }
      if (!c) {
        m = approximateMetrics(font)
      } else {
        c.font = font
        const tm = c.measureText('Hxlp')
        const ascent = tm.fontBoundingBoxAscent
        const descent = tm.fontBoundingBoxDescent
        m =
          Number.isFinite(ascent) && ascent > 0
            ? { ascent, descent: descent || 0 }
            : approximateMetrics(font)
      }
      if (metricsCache.size >= CACHE_LIMIT) metricsCache.clear()
      metricsCache.set(key, m)
      return m
    },
  }
}

let segmenter: Intl.Segmenter | null | undefined

/** Split into user-perceived characters, so a ZWJ emoji or a combining mark is
 *  never cut in half by the long-word breaker or the tracking fallback. */
export function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl !== 'undefined' && 'Segmenter' in Intl
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null
  }
  if (!segmenter) return Array.from(text)
  return Array.from(segmenter.segment(text), (s) => s.segment)
}

function clusterCount(text: string): number {
  return graphemes(text).length
}
