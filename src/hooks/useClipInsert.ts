// Asset/preset → a NEW clip on the timeline: the packed slot on the video
// track, a free spot on an overlay lane, or a fresh lane in a seam. This is the
// ONE place bin→timeline insertion lives: the desktop drag-and-drop target and
// the touch tap-to-add affordance both route through it, so they can never
// diverge.
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
import { pickOverlayLane, resolveLaneStart } from '@/lib/model/lanes'
import {
  DEFAULT_TEXT_DURATION_SEC,
  clipFromAsset,
  createTextClip,
} from '@/lib/model/factories'
import { presetStyle } from '@/lib/text/presets'
import { ensureFontsForClips } from '@/lib/text/fontLoader'
import type { Clip } from '@/lib/model/types'
import type { TextPreset } from '@/lib/text/presets'

export function useClipInsert() {
  /** Shared tail of every insert: select the newcomer and drop a stale export. */
  const finishInsert = useCallback((clip: Clip) => {
    const st = useEditorStore.getState()
    st.selectClip(clip.id)
    st.resetExport()
  }, [])

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
      finishInsert(clip)
      return clip.id
    },
    [finishInsert],
  )

  /** Insert a new text clip at `time`, on the lowest overlay lane with room
   *  there — or a fresh lane on top when every lane is occupied (the CapCut
   *  model: clips stack into lanes instead of overlapping). Free-positioned, so
   *  no insertion slot to compute. Returns the new id. */
  const insertTextAtTime = useCallback(
    (preset: TextPreset, time: number, content?: string): string => {
      const st = useEditorStore.getState()
      // Duration passed explicitly so the lane picked and the clip created
      // cannot disagree about the window being claimed.
      const duration = DEFAULT_TEXT_DURATION_SEC
      const start = Math.max(0, time)
      const trackId =
        pickOverlayLane(st.project, start, duration) ?? st.addOverlayTrack()
      const clip = createTextClip({
        start,
        duration,
        content,
        style: presetStyle(preset),
      })
      st.addClip(clip, trackId)
      finishInsert(clip)
      // Fire-and-forget: the preview redraws every frame, so the text simply
      // sharpens from the fallback stack to the real face when it lands.
      void ensureFontsForClips([clip])
      return clip.id
    },
    [finishInsert],
  )

  /** Shared bin→lane insert: build the clip, let `place` set its start and
   *  name (or create) the destination lane, then land it. */
  const insertAssetVia = useCallback(
    (
      assetId: string,
      place: (
        st: ReturnType<typeof useEditorStore.getState>,
        clip: Clip,
      ) => string | null,
    ): string | null => {
      const st = useEditorStore.getState()
      if (!Object.hasOwn(st.project.assets, assetId)) return null
      const clip = clipFromAsset(st.project.assets[assetId])
      const trackId = place(st, clip)
      if (trackId == null) return null
      st.addClip(clip, trackId)
      finishInsert(clip)
      return clip.id
    },
    [finishInsert],
  )

  /** Drop `assetId` onto an existing overlay lane at `start` (clamped into a
   *  free gap by the same geometry the drop preview used). Returns the id. */
  const insertAssetOnLane = useCallback(
    (assetId: string, trackId: string, start: number): string | null =>
      insertAssetVia(assetId, (st, clip) => {
        const lane = st.project.tracks.find((t) => t.id === trackId)
        if (!lane || lane.type !== 'overlay') return null
        clip.start = resolveLaneStart(lane.clips, start, clip.duration)
        return trackId
      }),
    [insertAssetVia],
  )

  /** Drop `assetId` into a lane seam: a brand-new overlay lane directly above
   *  `belowTrackId`, clip at `start`. Returns the new clip's id. */
  const insertAssetOnNewLane = useCallback(
    (assetId: string, belowTrackId: string, start: number): string | null =>
      insertAssetVia(assetId, (st, clip) => {
        clip.start = Math.max(0, start)
        return st.addOverlayTrack(belowTrackId)
      }),
    [insertAssetVia],
  )

  return {
    insertAssetAtTime,
    insertTextAtTime,
    insertAssetOnLane,
    insertAssetOnNewLane,
  }
}
