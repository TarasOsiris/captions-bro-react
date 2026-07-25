// Text layout + painting. The pure half of the text renderer: it takes an
// injected `TextMeasurer` rather than touching a canvas itself, which is what
// keeps it unit-testable in the node vitest env (vitest.config.ts sets
// `environment: 'node'`). Do NOT inline `ctx.measureText` in here.
//
// ── The two traps this file exists to get right ──────────────────────────────
//
// 1. MEASURE AT A REFERENCE SIZE. Font hinting makes `measureText` non-linear in
//    size, so measuring at the final pixel size can produce DIFFERENT LINE
//    BREAKS in a 400px-tall preview and a 1080px export. We therefore always
//    measure at REF_FONT_PX and scale the result by `fontPx / REF_FONT_PX`:
//    wrapping is then bit-identical at every canvas size, and both paths share
//    one measurement cache. This is the WYSIWYG guarantee, and `layout.test.ts`
//    asserts it.
//
// 2. CANVAS SHADOWS ARE DEVICE-SPACE. `ctx.scale(k)` does NOT scale
//    `shadowBlur` / `shadowOffsetX` / `shadowOffsetY` — they must be multiplied
//    by `k` by hand. Miss it and the shadow is right in the preview and wrong in
//    the export. `ctx.lineWidth` IS user-space and needs no compensation.

import { withAlpha } from '@/lib/model/text'
import { graphemes, supportsLetterSpacing } from './measure'
import type { TextMeasurer } from './measure'
import type { TextStyle } from '@/lib/model/text'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Every width is measured at this size and scaled — see trap 1 above. */
export const REF_FONT_PX = 100

/** Fraction of the font size used for the underline's offset and thickness. */
const UNDERLINE_OFFSET_EM = 0.18
const UNDERLINE_THICKNESS_EM = 0.06

export interface TextLine {
  text: string
  width: number
  /** Left edge within the content box, from `align`. */
  x: number
}

export interface TextLayout {
  /** Natural size at `scale === 1`, in canvas px: content + background padding.
   *  Outline and shadow bleed are deliberately EXCLUDED, so adding either never
   *  resizes or shifts the block. Legal because text never sets `crop`, so
   *  `drawScene` never clips it. */
  width: number
  height: number
  lines: TextLine[]
  /** The canvas font shorthand — used to measure AND to paint, so the two can
   *  never disagree about which face is in play. */
  font: string
  fontPx: number
  lineHeightPx: number
  letterSpacingPx: number
  /** Baseline of line i = padY + i * lineHeightPx + baselineOffset. */
  baselineOffset: number
  padX: number
  padY: number
  radius: number
  strokePx: number
  shadowBlurPx: number
  shadowDx: number
  shadowDy: number
  underlineOffset: number
  underlineThickness: number
}

/** The ONE canvas font shorthand builder — measurement, painting and font
 *  loading all go through it. */
export function fontShorthand(style: TextStyle, fontPx: number): string {
  const italic = style.italic ? 'italic ' : ''
  const weight = style.bold ? '700 ' : '400 '
  // Quoted family + a fallback stack, so a family that failed to load still
  // renders something rather than the browser's default serif.
  return `${italic}${weight}${fontPx}px "${style.fontFamily}", system-ui, -apple-system, sans-serif`
}

/** Apply the case style. Only ever applied to the laid-out COPY — `clip.text`
 *  keeps whatever was typed, so toggling the style back is lossless. */
function applyCase(text: string, mode: TextStyle['case']): string {
  if (mode === 'upper') return text.toLocaleUpperCase()
  if (mode === 'capitalize') {
    // `(^|\s)` always captures (possibly as ''), so `lead` is never undefined.
    return text.replace(
      /(^|\s)(\p{L})/gu,
      (_m, lead: string, ch: string) => lead + ch.toLocaleUpperCase(),
    )
  }
  return text
}

/** Break a single token that is wider than the box, by grapheme cluster — so a
 *  long URL or a wall of emoji can't overflow, and never mid-character. */
function breakToken(
  token: string,
  maxWidth: number,
  measureAt: (t: string) => number,
): string[] {
  const out: string[] = []
  let current = ''
  for (const g of graphemes(token)) {
    const next = current + g
    if (current !== '' && measureAt(next) > maxWidth) {
      out.push(current)
      current = g
    } else {
      current = next
    }
  }
  if (current !== '') out.push(current)
  return out
}

/**
 * Lay `content` out inside `style`'s box on a `canvasW × canvasH` canvas.
 * Everything in `style` is canvas-relative or em-relative, so this is fully
 * resolution-independent — halving the canvas halves every returned dimension.
 */
export function layoutText(
  style: TextStyle,
  content: string | undefined,
  canvasW: number,
  canvasH: number,
  measure: TextMeasurer,
): TextLayout {
  const fontPx = Math.max(1, style.fontSize * canvasH)
  const font = fontShorthand(style, fontPx)
  const refFont = fontShorthand(style, REF_FONT_PX)
  const k = fontPx / REF_FONT_PX

  const letterSpacingPx = style.letterSpacing * fontPx
  const refSpacing = style.letterSpacing * REF_FONT_PX
  // Measure at the reference size, scale down — trap 1.
  const measureAt = (t: string) => measure.width(t, refFont, refSpacing) * k

  const lineHeightPx = style.lineHeight * fontPx
  const padX = style.bgPaddingX * fontPx
  const padY = style.bgPaddingY * fontPx
  const wrapPx = Math.max(1, style.boxWidth * canvasW - 2 * padX)

  // `Clip.text` is optional, so a clip that has never been typed into arrives
  // here as undefined — treat it as empty rather than throwing in the renderer.
  const cased = applyCase(content ?? '', style.case)

  // Hard breaks first — an empty paragraph must survive as an empty line of full
  // line height, which is what a text editor does.
  const lines: TextLine[] = []
  for (const paragraph of cased.split('\n')) {
    if (paragraph === '') {
      lines.push({ text: '', width: 0, x: 0 })
      continue
    }
    // Split keeping the separators so we can rebuild lines with their spaces.
    const parts = paragraph.split(/(\s+)/)
    let current = ''
    const push = (text: string) => {
      const trimmed = text.replace(/\s+$/, '')
      lines.push({ text: trimmed, width: measureAt(trimmed), x: 0 })
    }
    for (const part of parts) {
      if (part === '') continue
      const candidate = current + part
      if (current !== '' && measureAt(candidate.replace(/\s+$/, '')) > wrapPx) {
        push(current)
        current = /^\s+$/.test(part) ? '' : part
      } else {
        current = candidate
      }
      // A single token still too wide for the box: break it by cluster.
      if (current !== '' && measureAt(current) > wrapPx) {
        const pieces = breakToken(current, wrapPx, measureAt)
        for (let i = 0; i < pieces.length - 1; i++) push(pieces[i])
        current = pieces[pieces.length - 1] ?? ''
      }
    }
    if (current !== '' || parts.length === 0) push(current)
  }
  if (lines.length === 0) lines.push({ text: '', width: 0, x: 0 })

  // Empty content still needs a grabbable box, or the clip can't be selected.
  const longest = Math.max(...lines.map((l) => l.width))
  const contentWidth =
    longest > 0 ? Math.min(longest, wrapPx) : Math.min(fontPx * 4, wrapPx)

  for (const line of lines) {
    line.x =
      style.align === 'left'
        ? 0
        : style.align === 'right'
          ? contentWidth - line.width
          : (contentWidth - line.width) / 2
  }

  const { ascent } = measure.metrics(font)
  return {
    width: contentWidth + 2 * padX,
    height: lines.length * lineHeightPx + 2 * padY,
    lines,
    font,
    fontPx,
    lineHeightPx,
    letterSpacingPx,
    baselineOffset: (lineHeightPx - fontPx) / 2 + ascent,
    padX,
    padY,
    radius: style.bgRadius * fontPx,
    strokePx: style.strokeWidth * fontPx,
    shadowBlurPx: style.shadowBlur * fontPx,
    shadowDx: style.shadowOffsetX * fontPx,
    shadowDy: style.shadowOffsetY * fontPx,
    underlineOffset: UNDERLINE_OFFSET_EM * fontPx,
    underlineThickness: Math.max(1, UNDERLINE_THICKNESS_EM * fontPx),
  }
}

// A layout is rebuilt for every frame of the preview AND every frame of the
// export, so memoize it. The key includes the canvas size and the fonts version,
// so a resize or a newly-arrived webfont invalidates correctly.
const LAYOUT_CACHE_LIMIT = 64
const layoutCache = new Map<string, TextLayout>()

export function clearLayoutCache(): void {
  layoutCache.clear()
}

/** `layoutText`, memoized. `version` must be the caller's `fontsVersion()`. */
export function layoutTextCached(
  style: TextStyle,
  content: string | undefined,
  canvasW: number,
  canvasH: number,
  measure: TextMeasurer,
  version: number,
): TextLayout {
  const key = `${version}|${Math.round(canvasW)}x${Math.round(canvasH)}|${JSON.stringify(style)}|${content}`
  const hit = layoutCache.get(key)
  if (hit) return hit
  const laid = layoutText(style, content, canvasW, canvasH, measure)
  if (layoutCache.size >= LAYOUT_CACHE_LIMIT) layoutCache.clear()
  layoutCache.set(key, laid)
  return laid
}

/** Draw text one grapheme at a time, adding tracking manually. Only used where
 *  `ctx.letterSpacing` is unsupported; loses kerning, which is an acceptable
 *  degradation on an old browser. Mirrors `measure`'s fallback exactly. */
function drawSpacedText(
  ctx: Ctx,
  mode: 'fill' | 'stroke',
  text: string,
  x: number,
  y: number,
  spacing: number,
): void {
  let cursor = x
  for (const g of graphemes(text)) {
    if (mode === 'fill') ctx.fillText(g, cursor, y)
    else ctx.strokeText(g, cursor, y)
    cursor += ctx.measureText(g).width + spacing
  }
}

/**
 * Paint a laid-out block into the destination rect `drawScene` computed. The
 * canvas is already translated to the block's center and rotated; `dx/dy` is the
 * top-left corner and `dw` the width (natural width × `transform.scale`).
 *
 * The height is not a parameter because the scale is uniform by construction:
 * `drawScene` sizes a natural-extent source as `{w,h} × scale`, so `dw / width`
 * and `dh / height` are the same number.
 */
export function paintText(
  ctx: Ctx,
  L: TextLayout,
  style: TextStyle,
  dx: number,
  dy: number,
  dw: number,
): void {
  if (L.width <= 0 || L.height <= 0) return
  const k = dw / L.width

  ctx.save()
  ctx.translate(dx, dy)
  ctx.scale(k, k)
  // Everything below is in NATURAL units, from (0,0) at the block's top-left.

  const spacingSupported = supportsLetterSpacing()

  // 1. Background box — hugs the content, never the full wrap width (a
  //    full-width box behind left-aligned text reads as a banner). Drawn with
  //    no shadow of its own, so the glyph shadow doesn't double up on it.
  if (style.bgOpacity > 0) {
    ctx.save()
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = withAlpha(style.bgColor, style.bgOpacity)
    ctx.beginPath()
    const r = Math.min(L.radius, L.width / 2, L.height / 2)
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(0, 0, L.width, L.height, r)
    } else {
      roundRectPath(ctx, 0, 0, L.width, L.height, r)
    }
    ctx.fill()
    ctx.restore()
  }

  ctx.font = L.font
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  if (spacingSupported) ctx.letterSpacing = `${L.letterSpacingPx}px`

  const fill = withAlpha(style.color, style.opacity)
  const hasStroke = style.strokeWidth > 0 && style.opacity > 0
  const hasShadow = style.shadowOpacity > 0

  for (let i = 0; i < L.lines.length; i++) {
    const line = L.lines[i]
    if (line.text === '') continue
    const x = L.padX + line.x
    const y = L.padY + i * L.lineHeightPx + L.baselineOffset

    // 2. The shadow rides whichever pass is OUTERMOST — the outline if there is
    //    one, otherwise the fill — so it is never drawn twice.
    if (hasShadow) {
      // Device-space, so undo the ctx.scale(k) by hand. See trap 2.
      ctx.shadowColor = withAlpha(style.shadowColor, style.shadowOpacity)
      ctx.shadowBlur = L.shadowBlurPx * k
      ctx.shadowOffsetX = L.shadowDx * k
      ctx.shadowOffsetY = L.shadowDy * k
    }

    if (hasStroke) {
      ctx.strokeStyle = withAlpha(style.strokeColor, style.opacity)
      // lineWidth IS user-space — no k compensation. Round joins keep sharp
      // corners on display faces from spiking.
      ctx.lineWidth = L.strokePx
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      if (spacingSupported) ctx.strokeText(line.text, x, y)
      else drawSpacedText(ctx, 'stroke', line.text, x, y, L.letterSpacingPx)
      // The outline already carries the shadow; the fill must not repeat it.
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
    }

    ctx.fillStyle = fill
    if (spacingSupported) ctx.fillText(line.text, x, y)
    else drawSpacedText(ctx, 'fill', line.text, x, y, L.letterSpacingPx)

    // 3. Underline — in the shadow-off pass, matching the fill colour.
    if (style.underline) {
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
      ctx.fillRect(x, y + L.underlineOffset, line.width, L.underlineThickness)
    }

    // Reset for the next line, which re-arms its own shadow.
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  }

  if (spacingSupported) ctx.letterSpacing = '0px'
  ctx.restore()
}

/** `roundRect` fallback for browsers that predate it (older Safari). */
function roundRectPath(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
