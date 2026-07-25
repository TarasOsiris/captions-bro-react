// The formatting of a text clip — the `Transform` of typography. Like
// `lib/transform.ts` it is a nested value object on `Clip` with its own module,
// constants and pure helpers, because ~24 flat `text*` fields would swamp an
// interface that mostly describes video. (types.ts forbids a discriminated
// *union*, not nested objects.)
//
// THE UNIT RULE — everything here is resolution-independent, because the preview
// canvas is `clientWidth × devicePixelRatio` while the export canvas is 1920×1080
// and both must produce identical pixels:
//
//   fontSize  — a fraction of canvas HEIGHT
//   boxWidth  — a fraction of canvas WIDTH
//   everything else — `em`, i.e. a multiple of the resolved font size
//
// So padding, outline and shadow all scale with the type the way a CSS author
// expects, and a text block is one uniformly-scalable unit. Never store a px
// value in here.
//
// Pure + SSR-safe: no DOM, no measurement (that lives in src/lib/text/).

export type TextAlign = 'left' | 'center' | 'right'
/** Letter case applied at LAYOUT time; `clip.text` always keeps what was typed. */
export type TextCase = 'none' | 'upper' | 'capitalize'

export interface TextStyle {
  /** A family from src/lib/text/fonts.ts; falls back to the system stack. */
  fontFamily: string
  /** Fraction of canvas HEIGHT (0.09 ≈ 97px at 1080p). */
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  case: TextCase
  /** Tracking, in em. Clideo's -20…100 slider maps as `em = units / 200`. */
  letterSpacing: number
  /** Baseline-to-baseline distance, in em. */
  lineHeight: number
  align: TextAlign
  /** Glyph fill, '#rrggbb'. Kept separate from `opacity` because
   *  `<input type="color">` can only round-trip a hex value. */
  color: string
  /** 0…1, applied to the glyphs (fill + outline) but NOT the background box. */
  opacity: number
  /** Fraction of canvas WIDTH — the wrap width, not the drawn box width. The
   *  background box hugs the longest line; this only decides where text wraps. */
  boxWidth: number
  bgColor: string
  /** 0 = no background box at all. */
  bgOpacity: number
  /** Background box padding / corner radius, in em. */
  bgPaddingX: number
  bgPaddingY: number
  bgRadius: number
  /** Outline width in em; 0 = no outline. */
  strokeWidth: number
  strokeColor: string
  shadowColor: string
  /** 0 = no shadow. */
  shadowOpacity: number
  /** Shadow blur / offsets, in em. */
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
}

/** What a brand-new text clip says. */
export const DEFAULT_TEXT_CONTENT = 'Your text here'

/**
 * The out-of-the-box look. A soft drop shadow is ON by default on purpose:
 * untreated white text over bright footage is unreadable, and every caption tool
 * ships some form of scrim.
 */
export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 0.09,
  bold: true,
  italic: false,
  underline: false,
  case: 'none',
  letterSpacing: 0,
  lineHeight: 1.2,
  align: 'center',
  color: '#ffffff',
  opacity: 1,
  boxWidth: 0.8,
  bgColor: '#000000',
  bgOpacity: 0,
  bgPaddingX: 0.4,
  bgPaddingY: 0.2,
  bgRadius: 0.15,
  strokeWidth: 0,
  strokeColor: '#000000',
  shadowColor: '#000000',
  shadowOpacity: 0.45,
  shadowBlur: 0.12,
  shadowOffsetX: 0,
  shadowOffsetY: 0.06,
}

/**
 * Fill in every missing field. THE migration seam: documents saved by an older
 * build (and hand-edited localStorage) come back with fields missing, and this is
 * the one place that is tolerated. Every field of `TextStyle` is required, so the
 * layout hot path and the UI controls never see `undefined`.
 */
export function withTextDefaults(style?: Partial<TextStyle> | null): TextStyle {
  if (!style) return { ...DEFAULT_TEXT_STYLE }
  return { ...DEFAULT_TEXT_STYLE, ...style }
}

/** '#rrggbb' (or '#rgb') + alpha → an `rgba()` string for canvas / CSS. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha))
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return `rgba(255,255,255,${a})`
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
