// Reading and writing one text-style field, without re-render storms or undo spam.
//
// Two problems this solves, both real rather than theoretical:
//
// 1. RE-RENDERS. immer hands out a new `project` object on every `updateClip`,
//    and both Timeline and PreviewStage subscribe to `s.project` wholesale — so
//    a naive slider drag re-renders the whole editor 60+ times a second. Each
//    control here subscribes to ITS OWN FIELD only, so moving the letter-spacing
//    slider re-renders the letter-spacing row and nothing else.
//
// 2. UNDO SPAM. The undo stack holds 50 whole-project snapshots. One per slider
//    frame would bury every real edit within half a second. So a snapshot is
//    taken on the FIRST write of a drag and not again until it commits — the
//    same `snapshotted` idiom the Timeline's trim gesture already uses.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { clipById } from '@/lib/model/selectors'
import { withTextDefaults } from '@/lib/model/text'
import { rafThrottle } from '@/lib/raf'
import { ensureFont } from '@/lib/text/fontLoader'
import type { TextStyle } from '@/lib/model/text'

/** The resolved style of a text clip, or null if it isn't one. */
export function useTextStyle(clipId: string | null): TextStyle | null {
  return useEditorStore((s) => {
    const clip = clipById(s.project, clipId)
    if (!clip || clip.type !== 'text') return null
    return clip.textStyle ?? null
  })
}

/** One field of a clip's text style, as a live-editable value. */
export function useTextStyleField<TKey extends keyof TextStyle>(
  clipId: string,
  key: TKey,
  onEditStart: () => void,
): {
  value: TextStyle[TKey]
  /** Live write — throttled to one store update per frame. */
  set: (value: TextStyle[TKey]) => void
  /** End the editing session, so the next `set` snapshots again. */
  commit: (value?: TextStyle[TKey]) => void
} {
  // Atomic selector: this component only re-renders when THIS field changes.
  const value = useEditorStore((s) => {
    const clip = clipById(s.project, clipId)
    return withTextDefaults(clip?.textStyle)[key]
  })

  const snapshotted = useRef(false)

  const write = useCallback(
    (next: TextStyle[TKey]) => {
      const st = useEditorStore.getState()
      const clip = clipById(st.project, clipId)
      if (!clip) return
      st.updateClip(clipId, {
        textStyle: { ...withTextDefaults(clip.textStyle), [key]: next },
      })
      st.resetExport()
    },
    [clipId, key],
  )

  // One throttle instance per field, cancelled on unmount so a pending frame
  // can't write into a clip that no longer exists.
  const throttled = useMemo(() => rafThrottle(write), [write])
  useEffect(
    () => () => {
      throttled.cancel()
    },
    [throttled],
  )

  const set = useCallback(
    (next: TextStyle[TKey]) => {
      if (!snapshotted.current) {
        snapshotted.current = true
        onEditStart()
      }
      throttled(next)
    },
    [throttled, onEditStart],
  )

  const commit = useCallback(
    (next?: TextStyle[TKey]) => {
      if (next !== undefined) {
        if (!snapshotted.current) onEditStart()
        // Bypass the throttle so the final value can't be dropped by a
        // cancelled frame.
        throttled.cancel()
        write(next)
      }
      snapshotted.current = false
    },
    [throttled, write, onEditStart],
  )

  return { value, set, commit }
}

/** Patch several style fields at once (presets, background on/off). Always one
 *  mutation, so it takes exactly one undo snapshot. */
export function useTextStylePatch(clipId: string, onEditStart: () => void) {
  return useCallback(
    (patch: Partial<TextStyle>) => {
      const st = useEditorStore.getState()
      const clip = clipById(st.project, clipId)
      if (!clip) return
      const next = { ...withTextDefaults(clip.textStyle), ...patch }
      onEditStart()
      st.updateClip(clipId, { textStyle: next })
      st.resetExport()
      // A preset can change the family/weight — make sure the face is on its way.
      void ensureFont(
        next.fontFamily,
        { bold: next.bold, italic: next.italic },
        clip.text || 'AaGg',
      )
    },
    [clipId, onEditStart],
  )
}
