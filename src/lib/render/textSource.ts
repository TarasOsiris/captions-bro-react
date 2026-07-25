// THE text renderer. Like `drawScene` for pixels, this is the single place a
// text clip becomes something drawable — the preview's rAF loop, `exportTimeline`'s
// per-frame composite and `exportVideo`'s `process` hook all call it and nothing
// else. That is what makes text WYSIWYG structural rather than hand-maintained
// (see "Preview must always match export" in CLAUDE.md).
//
// SSR-safe: `canvasMeasurer` creates its canvas lazily, so importing this module
// on the server is inert.

import { canvasMeasurer, fontsVersion } from '@/lib/text/measure'
import { layoutTextCached, paintText } from '@/lib/text/layout'
import { withTextDefaults } from '@/lib/model/text'
import { assetOf, clipAspect } from '@/lib/model/selectors'
import { containFit } from '@/lib/transform'
import type { RenderSource } from './compositor'
import type { Clip, Project } from '@/lib/model/types'

/**
 * A drawable source for a text clip, sized in the pixel units of the canvas it
 * will be drawn into. Returns null for anything that isn't a text clip.
 *
 * Cheap enough to call every frame: the layout behind it is memoized on
 * (fonts version, canvas size, style, content), so a steady frame is one Map hit.
 */
export function textSourceForClip(
  clip: Clip,
  canvasW: number,
  canvasH: number,
): RenderSource | null {
  if (clip.type !== 'text') return null
  const style = withTextDefaults(clip.textStyle)
  const layout = layoutTextCached(
    style,
    clip.text,
    canvasW,
    canvasH,
    canvasMeasurer(),
    fontsVersion(),
  )
  return {
    size: { w: layout.width, h: layout.height },
    paint: (ctx, dx, dy, dw) => {
      paintText(ctx, layout, style, dx, dy, dw)
    },
  }
}

/** The laid-out block size at `scale === 1`, or null for a non-text clip. Shares
 *  the memoized layout with the renderer, so the selection chrome and the drawn
 *  pixels can never disagree about where the box is. */
export function textNaturalSize(
  clip: Clip,
  canvasW: number,
  canvasH: number,
): { w: number; h: number } | null {
  if (clip.type !== 'text') return null
  const layout = layoutTextCached(
    withTextDefaults(clip.textStyle),
    clip.text,
    canvasW,
    canvasH,
    canvasMeasurer(),
    fontsVersion(),
  )
  return { w: layout.width, h: layout.height }
}

/**
 * A clip's natural size at `scale === 1`: the contain-fit box for media, the
 * laid-out block for text. Null while an asset's dimensions are still unknown.
 *
 * This is the size-aware replacement for `clipAspect` at every PreviewStage call
 * site. Text must NOT go through `clipAspect` + `mediaRect`: that path
 * contain-fits, which would stretch a text box to fill the canvas.
 */
export function clipNaturalSize(
  project: Project,
  clip: Clip | null,
  canvasW: number,
  canvasH: number,
): { w: number; h: number } | null {
  if (!clip) return null
  if (clip.type === 'text') return textNaturalSize(clip, canvasW, canvasH)
  const aspect = clipAspect(project, clip)
  if (aspect == null) return null
  return containFit(aspect, canvasW, canvasH)
}

/** Whether a clip has a decodable asset — the guard both export paths use to
 *  tell "media that isn't ready" from "a clip that never had an asset". */
export function hasAsset(project: Project, clip: Clip): boolean {
  return assetOf(project, clip) != null
}
