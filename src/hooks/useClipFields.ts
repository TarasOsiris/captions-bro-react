// Live-editable CLIP fields, for the media inspector — the sibling of
// useTextStyle.ts, over the same `useLiveField` machinery. See that file for
// why the atomic selector, the rAF throttle and the one-snapshot session are
// all load-bearing.

import { useCallback } from 'react'
import { useLiveField } from './useLiveField'
import { useEditorStore } from '@/store/editorStore'
import { clipById } from '@/lib/model/selectors'
import type { LiveField } from './useLiveField'
import type { EditorState } from '@/store/editorStore'
import type { Clip } from '@/lib/model/types'
import type { Transform } from '@/lib/transform'

/** The numeric placement fields. `crop` is edited by the preview's edge
 *  handles, so it is deliberately not addressable here. */
type TransformNumberKey = 'scale' | 'tx' | 'ty' | 'rotationDeg'

/** The optional numeric clip fields, each with a documented default. */
type ClipNumberKey = 'volume' | 'opacity'

/** One placement field of a clip's transform, as a live-editable value. */
export function useClipTransformField(
  clipId: string,
  key: TransformNumberKey,
  fallback: number,
): LiveField<number> {
  const select = useCallback(
    (s: EditorState) => clipById(s.project, clipId)?.transform[key] ?? fallback,
    [clipId, key, fallback],
  )

  const write = useCallback(
    (next: number) => {
      const st = useEditorStore.getState()
      // Re-read the LIVE transform and spread it. Closing over one captured at
      // render would let a throttled frame land AFTER a concurrent canvas
      // gesture and undo that gesture's writes to the other fields.
      const clip = clipById(st.project, clipId)
      if (!clip) return
      st.setClipTransform(clipId, { ...clip.transform, [key]: next })
    },
    [clipId, key],
  )

  return useLiveField(select, write)
}

/** One optional numeric field of the clip itself (volume today). */
export function useClipNumberField(
  clipId: string,
  key: ClipNumberKey,
  fallback: number,
): LiveField<number> {
  const select = useCallback(
    (s: EditorState) => clipById(s.project, clipId)?.[key] ?? fallback,
    [clipId, key, fallback],
  )

  const write = useCallback(
    (next: number) => {
      useEditorStore.getState().updateClip(clipId, { [key]: next })
    },
    [clipId, key],
  )

  return useLiveField(select, write)
}

/** Replace a clip's whole transform in ONE edit — the Reset / Fit / Fill
 *  buttons. Discrete, so `beginEdit` rather than a session. */
export function useClipTransformPatch(clipId: string) {
  return useCallback(
    (next: Transform | ((current: Transform) => Transform)) => {
      const st = useEditorStore.getState()
      const clip = clipById(st.project, clipId)
      if (!clip) return
      const value = typeof next === 'function' ? next(clip.transform) : next
      st.beginEdit()
      st.setClipTransform(clipId, value)
    },
    [clipId],
  )
}

/** Patch plain clip fields in ONE edit (the mute toggle). */
export function useClipPatch(clipId: string) {
  return useCallback(
    (patch: Partial<Clip>) => {
      const st = useEditorStore.getState()
      st.beginEdit()
      st.updateClip(clipId, patch)
    },
    [clipId],
  )
}
