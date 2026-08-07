// The output canvas: its size, its aspect, and the presets the UI offers.
//
// The aspect used to be the module constant `CANVAS_ASPECT = 16/9` in
// transform.ts. It is now DERIVED from `project.canvas`, because the ratio is a
// per-project choice (9:16 and 1:1 are the whole point of a social video
// editor). A global constant with that name surviving alongside a per-project
// value is exactly the drift failure mode CLAUDE.md warns about, so it's gone.

import type { CanvasSettings } from './types'

export type RatioId = '16:9' | '9:16' | '1:1' | '4:5'

export interface CanvasPreset {
  id: RatioId
  label: string
  /** What the ratio is FOR, in the UI. */
  hint: string
  width: number
  height: number
}

/**
 * Every preset's dimensions are EVEN INTEGERS, written out rather than derived.
 *
 * H.264 requires even dimensions, and `outputCanvas` rounds to satisfy that —
 * but rounding a derived size silently changes the ratio: `1080 * 9/16` is
 * 607.5, which rounds to 606 and leaves the export 0.25% off the aspect the
 * preview was composed at. Spelled out, the preview and the encoder agree by
 * construction. `canvas.test.ts` pins both properties.
 */
export const CANVAS_PRESETS: readonly CanvasPreset[] = [
  { id: '16:9', label: '16:9', hint: 'Landscape', width: 1920, height: 1080 },
  {
    id: '9:16',
    label: '9:16',
    hint: 'Reels, Shorts',
    width: 1080,
    height: 1920,
  },
  { id: '1:1', label: '1:1', hint: 'Square', width: 1080, height: 1080 },
  { id: '4:5', label: '4:5', hint: 'Feed', width: 1080, height: 1350 },
]

/** The output aspect ratio of a project's canvas — and of the preview frame,
 *  which derives its two-axis contain fit from exactly this number. */
export function canvasAspect(
  canvas: Pick<CanvasSettings, 'width' | 'height'>,
): number {
  return canvas.width / canvas.height
}

/** The shipped default, spelled here rather than imported from `factories` —
 *  that module imports THIS one, and a cycle for one constant is not worth it.
 *  `factories.ts` re-exports it as `DEFAULT_CANVAS`, and `support.test.ts` pins
 *  that they agree. */
const DEFAULT_CANVAS: CanvasSettings = {
  width: 1920,
  height: 1080,
  background: '#000000',
}

export function canvasForRatio(
  id: RatioId,
  background: string,
): CanvasSettings {
  const preset = CANVAS_PRESETS.find((p) => p.id === id) ?? CANVAS_PRESETS[0]
  return { width: preset.width, height: preset.height, background }
}

/** Which preset a canvas IS, within a hair — or null for a size no preset
 *  describes (a hand-edited document, or a ratio added and later removed). The
 *  UI shows no selection rather than lying about one. */
export function ratioIdFor(
  canvas: Pick<CanvasSettings, 'width' | 'height'>,
): RatioId | null {
  const aspect = canvasAspect(canvas)
  if (!Number.isFinite(aspect)) return null
  const match = CANVAS_PRESETS.find(
    (p) => Math.abs(canvasAspect(p) - aspect) < 0.001,
  )
  return match?.id ?? null
}

/**
 * Repair a canvas read off disk.
 *
 * The persisted shape has not changed — `CanvasSettings` was always serialized
 * verbatim and the aspect is DERIVED from it — so there is no migration here
 * (see the rule at the top of persistence/migrations.ts: per-load defaulting
 * belongs in hydrate). What this does close is an older hole: `projectStore`
 * validated `tracks` and `assets` but never the canvas, so a corrupt or absent
 * one reached `drawScene` and produced NaN geometry with no error.
 */
export function normalizeCanvas(canvas: unknown): CanvasSettings {
  if (typeof canvas !== 'object' || canvas === null)
    return { ...DEFAULT_CANVAS }
  const c = canvas as Partial<CanvasSettings>
  const width = Number(c.width)
  const height = Number(c.height)
  if (!(width > 0) || !(height > 0)) return { ...DEFAULT_CANVAS }
  return {
    width,
    height,
    background:
      typeof c.background === 'string' && c.background
        ? c.background
        : DEFAULT_CANVAS.background,
  }
}
