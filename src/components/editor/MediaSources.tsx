// The hidden decode + audio sources the preview compositor draws from: one
// <video> per video clip, one shared <img> per referenced image asset. They
// live behind the opaque canvas (videos full-size + opacity-0 so browsers keep
// decoding their frames).
//
// MEMOIZED, and that is the point. PreviewStage subscribes to `project`
// wholesale and therefore re-renders at POINTER RATE during a transform
// gesture; without this boundary the element list re-renders with it. Only
// React's keyed reconciliation stops the elements themselves being recreated —
// and recreating a <video> mid-playback drops its decode state and its audio.
//
// It must stay UNCONDITIONALLY mounted, in this DOM position, keyed by clip /
// asset id: it is a plain child of the frame's inner box (see the one-DOM-tree
// rule in CLAUDE.md), not a breakpoint-forked subtree.

import { memo } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { allClips, assetOf } from '@/lib/model/selectors'
import type { MediaAsset, Project } from '@/lib/model/types'
import type { MediaPool } from '@/lib/render/mediaPool'

/** The distinct sources a project needs mounted. Derived rather than stored, so
 *  adding a clip that reuses an asset adds no second <img>. */
function poolInventory(project: Project) {
  const videos: Array<{ clipId: string; url: string }> = []
  const images: Array<{ id: string; url: string }> = []
  const seenImages = new Set<string>()
  for (const clip of allClips(project)) {
    const asset = assetOf(project, clip)
    if (!asset) continue
    if (clip.type === 'video') {
      videos.push({ clipId: clip.id, url: asset.url })
    } else if (clip.type === 'image' && !seenImages.has(asset.id)) {
      seenImages.add(asset.id)
      images.push({ id: asset.id, url: asset.url })
    }
  }
  return { videos, images }
}

/** A video reporting its real dimensions/duration for the first time. The
 *  duration also corrects the clip's placeholder length, which is what makes
 *  the magnetic track re-pack (see documentSlice.updateClip). */
function learnVideoMeta(clipId: string, el: HTMLVideoElement) {
  const st = useEditorStore.getState()
  const clip = allClips(st.project).find((c) => c.id === clipId)
  if (!clip) return
  const asset = assetOf(st.project, clip)
  if (!asset) return
  const patch: Partial<MediaAsset> = {}
  if (el.videoWidth > 0 && el.videoHeight > 0) {
    patch.naturalWidth = el.videoWidth
    patch.naturalHeight = el.videoHeight
  }
  const learnDuration =
    asset.durationSec == null && Number.isFinite(el.duration)
  if (Number.isFinite(el.duration)) patch.durationSec = el.duration
  st.updateAsset(asset.id, patch)
  if (learnDuration) st.updateClip(clip.id, { duration: el.duration })
}

function learnImageMeta(assetId: string, el: HTMLImageElement) {
  if (el.naturalWidth <= 0 || el.naturalHeight <= 0) return
  useEditorStore.getState().updateAsset(assetId, {
    naturalWidth: el.naturalWidth,
    naturalHeight: el.naturalHeight,
  })
}

export const MediaSources = memo(function MediaSources({
  project,
  poolRef,
}: {
  project: Project
  poolRef: React.RefObject<MediaPool>
}) {
  const { videos, images } = poolInventory(project)
  return (
    <>
      {videos.map(({ clipId, url }) => (
        <video
          key={clipId}
          ref={(el) => {
            if (el) poolRef.current.videos.set(clipId, el)
            else poolRef.current.videos.delete(clipId)
          }}
          src={url}
          playsInline
          // Without this iOS may fetch metadata only; readyState stays < 2, the
          // pool source resolves to null and the canvas draws nothing at all.
          preload="auto"
          onLoadedMetadata={(e) => {
            learnVideoMeta(clipId, e.currentTarget)
          }}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
      ))}
      {images.map(({ id, url }) => (
        <img
          key={id}
          ref={(el) => {
            if (el) poolRef.current.images.set(id, el)
            else poolRef.current.images.delete(id)
          }}
          src={url}
          alt=""
          draggable={false}
          onLoad={(e) => {
            learnImageMeta(id, e.currentTarget)
          }}
          className="hidden"
        />
      ))}
    </>
  )
})
