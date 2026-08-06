// Editor keyboard shortcuts, ONE window listener:
// Space = play/pause · ←/→ = nudge 1s · Home/End = jump · Escape = deselect ·
// Delete/Backspace = remove the selected clip · Cmd/Ctrl+Z (+Shift) = undo/redo.
//
// Undo/redo lives HERE (not a second listener) so it shares the textarea guard
// and the `enabled` gate: while ExportScreen covers the editor, Cmd+Z is inert
// — the old separate useUndoRedo listener could mutate the document BEHIND the
// done-screen and leave a stale download on show.

import { useEffect } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { projectDuration } from '@/lib/model/selectors'

/** Playhead step (s) for ←/→ and the Timeline's nudge buttons. Exported so the
 *  keyboard and the on-screen controls can't drift apart — the buttons are the
 *  only precise-seek path on a phone, where there is no keyboard. */
export const NUDGE_SEC = 1

export function useEditorKeyboard({
  togglePlay,
  seek,
  enabled = true,
}: {
  togglePlay: () => void
  seek: (t: number) => void
  /** When false, shortcuts are inert (e.g. the export overlay is covering the editor). */
  enabled?: boolean
}) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target
      // `isContentEditable` too: a rich-text surface owns Cmd+Z for its own
      // text history, and stealing it would undo a whole document edit instead
      // of the last few characters.
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      const st = useEditorStore.getState()
      // Before the hasClips gate: undo must still work when the last clip was
      // just deleted (the project is empty precisely BECAUSE of the edit).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) st.redo()
        else st.undo()
        return
      }
      const hasClips = projectDuration(st.project) > 0
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (st.selectedClipId) {
          e.preventDefault()
          st.beginEdit()
          st.removeClip(st.selectedClipId)
          st.selectClip(null)
        }
        return
      }
      if (!hasClips) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) togglePlay()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        seek(st.currentTime - NUDGE_SEC)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        seek(st.currentTime + NUDGE_SEC)
      } else if (e.code === 'Home') {
        e.preventDefault()
        seek(0)
      } else if (e.code === 'End') {
        e.preventDefault()
        seek(Number.POSITIVE_INFINITY)
      } else if (e.code === 'Escape') {
        st.selectClip(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [togglePlay, seek, enabled])
}
