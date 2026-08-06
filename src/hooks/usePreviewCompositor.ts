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
      const dpr = window.devicePixelRatio || 1
      const cw = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const ch = Math.max(1, Math.round(canvas.clientHeight * dpr))
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
