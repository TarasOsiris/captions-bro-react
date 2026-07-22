// File → timeline clip. Classifies the file, registers a MediaAsset, and appends
// a Clip to the end of the video track (multi-clip: importing adds to the
// timeline, it does not replace it). Kicks off filmstrip generation.

import { useCallback } from 'react'
import { toast } from 'sonner'
import { useEditorStore } from '@/store/editorStore'
import { mediaKind } from '@/lib/media'
import { assetFromFile, clipFromAsset } from '@/lib/model/factories'
import { putAssetBlob } from '@/lib/persistence/assetStore'
import { generateFilmstrip } from '@/lib/thumbs'

export function useMediaImport() {
  const importFile = useCallback((file: File) => {
    const kind = mediaKind(file)
    if (kind == null) {
      toast.error("That doesn't look like a video or image file.")
      return
    }

    const st = useEditorStore.getState()
    const url = URL.createObjectURL(file)
    const asset = assetFromFile(file, kind, url)

    // Append after the last clip on the (first) video track.
    const track =
      st.project.tracks.find((t) => t.type === 'video') ?? st.project.tracks[0]
    const start = track.clips.reduce(
      (end, c) => Math.max(end, c.start + c.duration),
      0,
    )
    const clip = clipFromAsset(asset, start)

    st.addAsset(asset)
    st.addClip(clip, track.id)
    st.selectClip(clip.id)
    st.resetExport()

    // Persist the blob for reload (best-effort).
    putAssetBlob(asset.id, file).catch(() => {})

    // Filmstrip thumbnails (video only; stills reuse their own frame).
    if (kind === 'video') {
      generateFilmstrip(url).then(
        (frames) => {
          if (frames.length === 0) return
          // Ignore if this asset was removed before generation finished.
          const assets = useEditorStore.getState().project.assets
          if (!Object.hasOwn(assets, asset.id) || assets[asset.id].url !== url) {
            return
          }
          useEditorStore.getState().updateAsset(asset.id, { thumbs: frames })
        },
        () => {},
      )
    }
  }, [])

  return { importFile }
}
