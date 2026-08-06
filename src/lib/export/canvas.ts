// Output-canvas sizing + allocation. The pure half (even/outputCanvas) is
// node-testable; makeOutputSurface is the one DOM touch.

import { ExportInvalidFileError } from './errors'
import type { CanvasSettings } from '@/lib/model/types'

/** Rounds down to an even number ≥2 (H.264 requires even dimensions). */
export function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2)
}

/** The output canvas, with even dimensions for the encoder. */
export function outputCanvas(canvas: CanvasSettings): CanvasSettings {
  return {
    width: even(canvas.width),
    height: even(canvas.height),
    background: canvas.background,
  }
}

export interface OutputSurface {
  el: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  /** The evened settings every `drawScene` call must be given. */
  out: CanvasSettings
}

/** Allocate the canvas the frames are composited onto. */
export function makeOutputSurface(canvas: CanvasSettings): OutputSurface {
  const out = outputCanvas(canvas)
  const el = document.createElement('canvas')
  el.width = out.width
  el.height = out.height
  const ctx = el.getContext('2d')
  if (!ctx) {
    throw new ExportInvalidFileError('Canvas is unavailable in this browser.')
  }
  return { el, ctx, out }
}
