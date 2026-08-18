// The preview's rAF render loop: the SAME `drawScene` + `sceneDrawItems` the
// export uses, fed by the live pool elements.
//
// It mounts ONCE and reads every document value through `getState()`, so it
// neither depends on nor causes a React render — which is exactly why it lifts
// cleanly out of PreviewStage.

import { useEffect } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { resolveScene } from '@/lib/model/scene'
import { drawScene } from '@/lib/render/compositor'
import { sceneDrawItems } from '@/lib/render/sceneItems'
import type { RenderSource } from '@/lib/render/compositor'
import type { MediaPool } from '@/lib/render/mediaPool'
import type { Clip } from '@/lib/model/types'

/** Ceiling on the preview's backing store, as a multiple of the project's
 *  OUTPUT width. Windowed, `clientWidth × DPR` is modest; fullscreen on a 5K
 *  display it asks for ~5120×2880 — roughly 10× the pixels, every frame, with
 *  the device-space shadow scaling `layout.ts` does per text layer. Since
 *  `drawScene` is resolution-independent (all geometry is fractional), detail
 *  above the export's own resolution is invisible; 2× keeps the crisp-text
 *  argument below intact with room to spare. */
const MAX_PREVIEW_SCALE = 2

/** How the PREVIEW gets a clip's pixels: the live pool elements, with the
 *  readiness predicates only it needs (an export's frames are always decoded).
 *  The clip-TYPE branch lives in `sceneDrawItems`, shared with the export. */
function poolSource(pool: MediaPool, clip: Clip): RenderSource | null {
  if (clip.type === 'video') {
    const v = pool.videos.get(clip.id)
    if (!v || v.readyState < 2 || v.videoWidth === 0) return null
    return {
      aspect: v.videoWidth / v.videoHeight,
      paint: (c, dx, dy, dw, dh) => {
        c.drawImage(v, dx, dy, dw, dh)
      },
    }
  }
  if (clip.type === 'image' && clip.assetId != null) {
    const img = pool.images.get(clip.assetId)
    if (!img || !img.complete || img.naturalWidth === 0) return null
    return {
      aspect: img.naturalWidth / img.naturalHeight,
      paint: (c, dx, dy, dw, dh) => {
        c.drawImage(img, dx, dy, dw, dh)
      },
    }
  }
  return null
}

export function usePreviewCompositor(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  poolRef: React.RefObject<MediaPool>,
) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'

    let raf = 0
    const render = () => {
      const { project, currentTime } = useEditorStore.getState()
      const scene = resolveScene(project, currentTime)
      // A live video mid-seek has no decodable frame (readyState drops below
      // HAVE_CURRENT_DATA until the seek lands), so drawing the scene now would
      // paint background where the clip is — a black flash on every scrub step.
      // Hold the previous composite instead and try again next frame. Seeking
      // alone isn't enough to skip: with a frame still available the element
      // paints its old frame, which is exactly the hold we want. `error` guards
      // a seek that can never land from freezing the preview forever.
      const midSeek = scene.some(({ clip }) => {
        if (clip.type !== 'video') return false
        const v = poolRef.current.videos.get(clip.id)
        return v != null && v.seeking && v.readyState < 2 && v.error == null
      })
      if (midSeek) {
        raf = requestAnimationFrame(render)
        return
      }
      // Size the backing store to the DISPLAYED pixels (× DPR), not the export
      // resolution — so the preview is crisp at native density on any screen
      // instead of being up/down-scaled from a fixed 1920×1080. Geometry is
      // resolution-independent (mediaRect works off fractions), so the image is
      // identical; only the pixel density differs from the export path.
      // Capped by MAX_PREVIEW_SCALE, and by ONE shared factor across both axes
      // so the aspect the geometry resolves against never changes.
      const dpr = window.devicePixelRatio || 1
      const rawW = Math.max(1, canvas.clientWidth * dpr)
      const rawH = Math.max(1, canvas.clientHeight * dpr)
      const k = Math.min(1, (project.canvas.width * MAX_PREVIEW_SCALE) / rawW)
      const cw = Math.max(1, Math.round(rawW * k))
      const ch = Math.max(1, Math.round(rawH * k))
      if (canvas.width !== cw) canvas.width = cw
      if (canvas.height !== ch) canvas.height = ch
      drawScene(
        ctx,
        { width: cw, height: ch, background: project.canvas.background },
        sceneDrawItems(scene, cw, ch, (item) =>
          poolSource(poolRef.current, item.clip),
        ),
      )
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [canvasRef, poolRef])
}
