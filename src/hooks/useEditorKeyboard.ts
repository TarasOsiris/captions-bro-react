// Editor transport/selection keyboard shortcuts. (Undo/redo lives in useUndoRedo.)
// Space = play/pause · ←/→ = nudge 1s · Home/End = jump · Escape = deselect ·
// Delete/Backspace = remove the selected clip (undoable via `saveUndo`).

import { useEffect } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { projectDuration } from '@/lib/model/selectors'

export function useEditorKeyboard({
  togglePlay,
  seek,
  saveUndo,
  enabled = true,
}: {
  togglePlay: () => void
  seek: (t: number) => void
  saveUndo: () => void
  /** When false, shortcuts are inert (e.g. the export overlay is covering the editor). */
  enabled?: boolean
}) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      const st = useEditorStore.getState()
      const hasClips = projectDuration(st.project) > 0
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (st.selectedClipId) {
          e.preventDefault()
          saveUndo()
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
        seek(st.currentTime - 1)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        seek(st.currentTime + 1)
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
  }, [togglePlay, seek, saveUndo, enabled])
}
