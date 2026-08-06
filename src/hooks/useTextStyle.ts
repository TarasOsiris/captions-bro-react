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
//    frame would bury every real edit within half a second. The store's history
//    slice owns this now: `beginEditSession()` on every live write (free while
//    the session is open) and `endEditSession()` on commit — one session, one
//    undo entry.

import { useCallback, useEffect, useMemo } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { clipById } from '@/lib/model/selectors'
import { withTextDefaults } from '@/lib/model/text'
import { rafThrottle } from '@/lib/raf'
import { ensureFont } from '@/lib/text/fontLoader'
import type { TextStyle } from '@/lib/model/text'

/** One field of a clip's text style, as a live-editable value. */
export function useTextStyleField<TKey extends keyof TextStyle>(
  clipId: string,
  key: TKey,
): {
  value: TextStyle[TKey]
  /** Live write — throttled to one store update per frame. */
  set: (value: TextStyle[TKey]) => void
  /** End the editing session (optionally writing a final value first), so the
   *  next `set` starts a fresh undo entry. */
  commit: (value?: TextStyle[TKey]) => void
} {
  // Atomic selector: this component only re-renders when THIS field changes.
  const value = useEditorStore((s) => {
    const clip = clipById(s.project, clipId)
    return withTextDefaults(clip?.textStyle)[key]
  })

  const write = useCallback(
    (next: TextStyle[TKey]) => {
      const st = useEditorStore.getState()
      const clip = clipById(st.project, clipId)
      if (!clip) return
      st.updateClip(clipId, {
        textStyle: { ...withTextDefaults(clip.textStyle), [key]: next },
      })
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
      // Free while the session is open; the first call arms the ONE snapshot.
      useEditorStore.getState().beginEditSession()
      throttled(next)
    },
    [throttled],
  )

  const commit = useCallback(
    (next?: TextStyle[TKey]) => {
      const st = useEditorStore.getState()
      if (next !== undefined) {
        // Click-type commit (toggle, font pick): its own one-write session.
        st.beginEditSession()
        throttled.cancel()
        write(next)
      } else {
        // End of a drag: the last set() may still be waiting on its frame —
        // land it INSIDE the session, or it would mutate after the session
        // closed and escape undo entirely.
        throttled.flush()
      }
      st.endEditSession()
    },
    [throttled, write],
  )

  return { value, set, commit }
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
