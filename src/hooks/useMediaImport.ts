// File → timeline clip. Classifies the file, registers a MediaAsset, and appends
// a Clip to the end of the video track (multi-clip: importing adds to the
// timeline, it does not replace it). Kicks off filmstrip generation. Takes its
// own undo snapshot — callers don't wrap it.

import { useCallback } from 'react'
import { toast } from 'sonner'
import { useEditorStore } from '@/store/editorStore'
import { mediaKind } from '@/lib/media'
import { assetFromFile, clipFromAsset } from '@/lib/model/factories'
import { videoTrack } from '@/lib/model/selectors'
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

    // Append after the last clip on the video track.
    const track = videoTrack(st.project)
    const start = track.clips.reduce(
      (end, c) => Math.max(end, c.start + c.duration),
      0,
    )
    const clip = clipFromAsset(asset, start)

    st.beginEdit() // importing is undoable; snapshot before the mutations
    st.addAsset(asset)
    st.addClip(clip, track.id)
    st.selectClip(clip.id)

    // Persist the blob for reload. Editing continues fine without it, but the
    // clip will be MISSING after a reload — say so instead of failing silently.
    putAssetBlob(asset.id, file).catch(() => {
      toast.warning(
        `"${file.name}" couldn't be saved for reload — it will be missing next time you open the editor.`,
      )
    })

    // Filmstrip thumbnails (video only; stills reuse their own frame).
    if (kind === 'video') {
      generateFilmstrip(url).then(
        (frames) => {
          if (frames.length === 0) return
          // Ignore if this asset was removed before generation finished.
          const assets = useEditorStore.getState().project.assets
          if (
            !Object.hasOwn(assets, asset.id) ||
            assets[asset.id].url !== url
          ) {
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
