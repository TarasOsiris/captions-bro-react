// One continuously-editable field of the document, without re-render storms or
// undo spam. THE implementation of that pattern — `useTextStyleField` and
// `useClipFields` are both thin wrappers, so there is exactly one copy of the
// tricky part (the flush-inside-the-session rule in `commit`).
//
// Two problems this solves, both real rather than theoretical:
//
// 1. RE-RENDERS. immer hands out a new `project` object on every mutation, and
//    both Timeline and PreviewStage subscribe to `s.project` wholesale — so a
//    naive slider drag re-renders the whole editor 60+ times a second. A caller
//    passes an ATOMIC selector, so moving one slider re-renders one row.
//
// 2. UNDO SPAM. The undo stack holds 50 whole-project snapshots. One per slider
//    frame would bury every real edit within half a second. `beginEditSession()`
//    on every live write (free while the session is open) and `endEditSession()`
//    on commit — one session, one undo entry.

import { useCallback, useEffect, useMemo } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { rafThrottle } from '@/lib/raf'
import type { EditorState } from '@/store/editorStore'

export interface LiveField<T> {
  value: T
  /** Live write — throttled to one store update per frame. */
  set: (value: T) => void
  /** End the editing session (optionally writing a final value first), so the
   *  next `set` starts a fresh undo entry. */
  commit: (value?: T) => void
}

/**
 * `select` must be atomic (read only the one field) and BOTH callbacks must be
 * referentially stable — a `useCallback`/module-level function. An inline arrow
 * re-creates the rAF throttle every render, which drops pending frames.
 *
 * `write` must read the live state via `useEditorStore.getState()` rather than
 * closing over a value captured at render: a throttled write can land a frame
 * after a concurrent gesture (a canvas drag) has already moved the same clip,
 * and a stale closure would clobber it.
 */
export function useLiveField<T>(
  select: (s: EditorState) => T,
  write: (value: T) => void,
): LiveField<T> {
  const value = useEditorStore(select)

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
    (next: T) => {
      // Free while the session is open; the first call arms the ONE snapshot.
      useEditorStore.getState().beginEditSession()
      throttled(next)
    },
    [throttled],
  )

  const commit = useCallback(
    (next?: T) => {
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
