// Reading and writing one text-style field. The atomic-selector + rAF-throttle +
// one-snapshot-per-session machinery lives in `useLiveField`; this file is the
// TextStyle-shaped wrapper around it (see that file for why it works this way).

import { useCallback } from 'react'
import { useLiveField } from './useLiveField'
import { useEditorStore } from '@/store/editorStore'
import { clipById } from '@/lib/model/selectors'
import { withTextDefaults } from '@/lib/model/text'
import { ensureFont } from '@/lib/text/fontLoader'
import type { LiveField } from './useLiveField'
import type { EditorState } from '@/store/editorStore'
import type { TextStyle } from '@/lib/model/text'

/** One field of a clip's text style, as a live-editable value. */
export function useTextStyleField<TKey extends keyof TextStyle>(
  clipId: string,
  key: TKey,
): LiveField<TextStyle[TKey]> {
  // Atomic selector: this component only re-renders when THIS field changes.
  const select = useCallback(
    (s: EditorState) =>
      withTextDefaults(clipById(s.project, clipId)?.textStyle)[key],
    [clipId, key],
  )

  const write = useCallback(
    (next: TextStyle[TKey]) => {
      const st = useEditorStore.getState()
      // Re-read the LIVE style: a throttled frame can land after the canvas
      // gesture (or another field) has already rewritten the style object.
      const clip = clipById(st.project, clipId)
      if (!clip) return
      st.updateClip(clipId, {
        textStyle: { ...withTextDefaults(clip.textStyle), [key]: next },
      })
    },
    [clipId, key],
  )

  return useLiveField(select, write)
}

/** Patch several style fields at once (presets, background on/off). Always one
 *  mutation, so it takes exactly one undo snapshot. */
export function useTextStylePatch(clipId: string) {
  return useCallback(
    (patch: Partial<TextStyle>) => {
      const st = useEditorStore.getState()
      const clip = clipById(st.project, clipId)
      if (!clip) return
      const next = { ...withTextDefaults(clip.textStyle), ...patch }
      st.beginEdit()
      st.updateClip(clipId, { textStyle: next })
      // A preset can change the family/weight — make sure the face is on its way.
      void ensureFont(
        next.fontFamily,
        { bold: next.bold, italic: next.italic },
        clip.text || 'AaGg',
      )
    },
    [clipId],
  )
}
