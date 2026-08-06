// Named looks for the Text tab. Pure + SSR-safe.
//
// A preset is LOOK ONLY. `fontSize`, `boxWidth` and `align` are excluded at the
// TYPE level, so "the preset moved/resized my text" is impossible by
// construction — picking a new look never disturbs a layout you positioned.

import { DEFAULT_TEXT_STYLE } from '@/lib/model/text'
import type { TextStyle } from '@/lib/model/text'

/** The fields a preset may set — everything except placement and size. */
export type PresetStyle = Omit<
  Partial<TextStyle>,
  'fontSize' | 'boxWidth' | 'align'
>

export interface TextPreset {
  id: string
  label: string
  style: PresetStyle
}

const NO_SHADOW = {
  shadowOpacity: 0,
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
} satisfies PresetStyle

export const TEXT_PRESETS: TextPreset[] = [
  {
    id: 'clean',
    label: 'Clean',
    style: {
      fontFamily: 'Inter',
      bold: true,
      color: '#ffffff',
      bgOpacity: 0,
      strokeWidth: 0,
      shadowOpacity: 0.45,
      shadowBlur: 0.12,
      shadowOffsetY: 0.06,
    },
  },
  {
    id: 'subtitle',
    label: 'Subtitle',
    style: {
      fontFamily: 'Inter',
      bold: false,
      color: '#ffffff',
      bgColor: '#000000',
      bgOpacity: 0.65,
      bgPaddingX: 0.45,
      bgPaddingY: 0.22,
      bgRadius: 0.1,
      strokeWidth: 0,
      ...NO_SHADOW,
    },
  },
  {
    id: 'impact',
    label: 'Impact',
    style: {
      fontFamily: 'Anton',
      bold: false,
      case: 'upper',
      letterSpacing: 0.02,
      color: '#ffffff',
      bgOpacity: 0,
      strokeWidth: 0.06,
      strokeColor: '#000000',
      shadowOpacity: 0.5,
      shadowBlur: 0.1,
      shadowOffsetY: 0.05,
    },
  },
  {
    id: 'outline',
    label: 'Outline',
    style: {
      fontFamily: 'Montserrat',
      bold: true,
      color: '#ffffff',
      bgOpacity: 0,
      strokeWidth: 0.08,
      strokeColor: '#111111',
      ...NO_SHADOW,
    },
  },
  {
    id: 'karaoke',
    label: 'Karaoke',
    style: {
      fontFamily: 'Poppins',
      bold: true,
      case: 'upper',
      color: '#ffd203',
      bgOpacity: 0,
      strokeWidth: 0.07,
      strokeColor: '#101010',
      shadowOpacity: 0.55,
      shadowBlur: 0.08,
      shadowOffsetY: 0.05,
    },
  },
  {
    id: 'highlight',
    label: 'Highlight',
    style: {
      fontFamily: 'Work Sans',
      bold: true,
      color: '#111111',
      bgColor: '#ffd203',
      bgOpacity: 1,
      bgPaddingX: 0.35,
      bgPaddingY: 0.16,
      bgRadius: 0.08,
      strokeWidth: 0,
      ...NO_SHADOW,
    },
  },
  {
    id: 'headline',
    label: 'Headline',
    style: {
      fontFamily: 'Playfair Display',
      bold: true,
      italic: false,
      color: '#ffffff',
      letterSpacing: -0.01,
      bgOpacity: 0,
      strokeWidth: 0,
      shadowOpacity: 0.4,
      shadowBlur: 0.16,
      shadowOffsetY: 0.05,
    },
  },
  {
    id: 'tag',
    label: 'Tag',
    style: {
      fontFamily: 'JetBrains Mono',
      bold: true,
      case: 'upper',
      letterSpacing: 0.06,
      color: '#a889ff',
      bgColor: '#12101c',
      bgOpacity: 0.9,
      bgPaddingX: 0.4,
      bgPaddingY: 0.2,
      bgRadius: 0.5,
      strokeWidth: 0,
      ...NO_SHADOW,
    },
  },
  {
    id: 'handwritten',
    label: 'Handwritten',
    style: {
      fontFamily: 'Caveat',
      bold: true,
      color: '#ffffff',
      bgOpacity: 0,
      strokeWidth: 0,
      shadowOpacity: 0.5,
      shadowBlur: 0.14,
      shadowOffsetY: 0.06,
    },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    style: {
      fontFamily: 'DM Sans',
      bold: false,
      case: 'upper',
      letterSpacing: 0.18,
      color: '#ffffff',
      bgOpacity: 0,
      strokeWidth: 0,
      shadowOpacity: 0.35,
      shadowBlur: 0.1,
      shadowOffsetY: 0.04,
    },
  },
]

/** Merge a preset's look onto an existing style, keeping size and placement. */
function applyPreset(style: TextStyle, preset: TextPreset): TextStyle {
  return { ...style, ...preset.style }
}

/** The full style a preset describes, for previews and for a fresh insert. */
export function presetStyle(preset: TextPreset): TextStyle {
  return applyPreset({ ...DEFAULT_TEXT_STYLE }, preset)
}
