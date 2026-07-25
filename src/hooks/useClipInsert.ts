// Asset → a NEW clip on the video track, at the packed-track slot for a given
// time. This is the ONE place bin→timeline insertion lives: the desktop
// drag-and-drop target and the touch tap-to-add affordance both route through
// it, so the two can never diverge.
//
// Mirrors useMediaImport's shape — imperative `getState()`, no re-renders, and
// no undo snapshot of its own. The CALLER snapshots first, exactly as
// routes/index.tsx wraps importFile.
//
// Deliberately a hook rather than a store action: `resetExport` lives in
// exportSlice while `addClipAtIndex`/`selectClip` live in the document and
// selection slices, and src/hooks/ is this codebase's home for cross-slice
// orchestration.

import { useCallback } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { insertionIndex, videoTrack } from '@/lib/model/selectors'
import { clipFromAsset } from '@/lib/model/factories'

export function useClipInsert() {
  /** Insert a copy of `assetId` at the boundary nearest `time` (seconds).
   *  Returns the new clip's id, or null if the asset is unknown. */
  const insertAssetAtTime = useCallback(
    (assetId: string, time: number): string | null => {
      const st = useEditorStore.getState()
      if (!Object.hasOwn(st.project.assets, assetId)) return null
      const asset = st.project.assets[assetId]
      const track = videoTrack(st.project)
      const index = insertionIndex(track.clips, time)
      const clip = clipFromAsset(asset)
      st.addClipAtIndex(clip, track.id, index)
      st.selectClip(clip.id)
      st.resetExport()
      return clip.id
    },
    [],
  )

  return { insertAssetAtTime }
}
