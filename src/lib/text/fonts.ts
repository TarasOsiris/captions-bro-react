// The curated font list. Pure + SSR-safe — loading lives in ./fontLoader.
//
// A hand-picked ~24 rather than the whole Google catalogue: every face here is
// checked to read well burned into video at caption size, the picker stays
// scannable, and export font-readiness is a bounded, guaranteeable set. All are
// Google Fonts with a 400 and a 700, so `bold` always has a real face to use
// rather than a synthesized one.

export type FontCategory = 'sans' | 'serif' | 'display' | 'mono' | 'handwriting'

export interface FontDef {
  family: string
  category: FontCategory
}

export const DEFAULT_FONT_FAMILY = 'Inter'

/** Used when a family is missing, blocked or still loading. */
export const FALLBACK_STACK = 'system-ui, -apple-system, sans-serif'

export const TEXT_FONTS: FontDef[] = [
  // Sans — the workhorses.
  { family: 'Inter', category: 'sans' },
  { family: 'Roboto', category: 'sans' },
  { family: 'Open Sans', category: 'sans' },
  { family: 'Montserrat', category: 'sans' },
  { family: 'Poppins', category: 'sans' },
  { family: 'Nunito', category: 'sans' },
  { family: 'Work Sans', category: 'sans' },
  { family: 'DM Sans', category: 'sans' },
  { family: 'Manrope', category: 'sans' },
  { family: 'Instrument Sans', category: 'sans' },
  // Serif.
  { family: 'Playfair Display', category: 'serif' },
  { family: 'Merriweather', category: 'serif' },
  { family: 'Lora', category: 'serif' },
  { family: 'Libre Baskerville', category: 'serif' },
  { family: 'DM Serif Display', category: 'serif' },
  // Display — the ones that carry a title card.
  { family: 'Anton', category: 'display' },
  { family: 'Bebas Neue', category: 'display' },
  { family: 'Oswald', category: 'display' },
  { family: 'Archivo Black', category: 'display' },
  { family: 'Righteous', category: 'display' },
  // Mono.
  { family: 'JetBrains Mono', category: 'mono' },
  { family: 'Space Mono', category: 'mono' },
  // Handwriting.
  { family: 'Caveat', category: 'handwriting' },
  { family: 'Permanent Marker', category: 'handwriting' },
]

const BY_FAMILY = new Map(TEXT_FONTS.map((f) => [f.family, f]))

export function isKnownFont(family: string): boolean {
  return BY_FAMILY.has(family)
}

/** Not every family ships every axis; these only have a 400. */
const SINGLE_WEIGHT = new Set([
  'Anton',
  'Bebas Neue',
  'Archivo Black',
  'Righteous',
  'Permanent Marker',
])

/** Whether a real bold face exists (else the browser synthesizes one). */
export function hasBold(family: string): boolean {
  return !SINGLE_WEIGHT.has(family)
}

/** Whether a real italic face exists. */
export function hasItalic(family: string): boolean {
  return !SINGLE_WEIGHT.has(family) && family !== 'DM Serif Display'
}

export const FONT_CATEGORY_LABEL: Record<FontCategory, string> = {
  sans: 'Sans serif',
  serif: 'Serif',
  display: 'Display',
  mono: 'Monospace',
  handwriting: 'Handwriting',
}
