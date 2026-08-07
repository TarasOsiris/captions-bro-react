// Editor keyboard shortcuts, ONE window listener:
// Space = play/pause · ←/→ = nudge 1s · Home/End = jump · Escape = deselect ·
// Delete/Backspace = remove the selected clip · Cmd/Ctrl+Z (+Shift) = undo/redo ·
// Cmd/Ctrl +/−/0 = timeline zoom · S or Cmd+B = split · Q/W = trim head/tail to
// the playhead · Cmd+C/X/V = copy/cut/paste · Cmd+D = duplicate.
//
// Every clip command comes in as `useClipCommands` — the toolbar button and the
// shortcut are then literally the same function.
//
// Undo/redo lives HERE (not a second listener) so it shares the textarea guard
// and the `enabled` gate: while ExportScreen covers the editor, Cmd+Z is inert
// — the old separate useUndoRedo listener could mutate the document BEHIND the
// done-screen and leave a stale download on show.

import { useEffect } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { projectDuration } from '@/lib/model/selectors'
import { DEFAULT_PX_PER_SEC, ZOOM_STEP, zoomBy } from '@/lib/timeline/zoom'
import type { ClipCommands } from './useClipCommands'

/** Playhead step (s) for ←/→ and the Timeline's nudge buttons. Exported so the
 *  keyboard and the on-screen controls can't drift apart — the buttons are the
 *  only precise-seek path on a phone, where there is no keyboard. */
export const NUDGE_SEC = 1

/**
 * The UNMODIFIED keys this listener acts on — `KeyboardEvent.code` values.
 *
 * Exported because this listener is on WINDOW and only skips INPUT/TEXTAREA, so
 * any other focusable widget that wants to keep its own keys has to consume
 * these explicitly (see `usePanelResize`'s separator). ONE list, in ONE key
 * namespace: the separator used to restate them as `e.key` characters, which
 * silently disagreed on every non-QWERTY layout — on Dvorak the physical
 * `KeyS` reports `key: 'o'`, so resizing a panel split the clip.
 */
export const EDITOR_BARE_KEY_CODES: readonly string[] = [
  'Space',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'Escape',
  'Delete',
  'Backspace',
  'KeyS',
  'KeyQ',
  'KeyW',
]

export function useEditorKeyboard({
  togglePlay,
  seek,
  commands,
  enabled = true,
}: {
  togglePlay: () => void
  seek: (t: number) => void
  /** The clip commands, passed IN rather than obtained by calling
   *  `useClipCommands()` here: this hook's whole shape is one window listener
   *  and one effect, and taking them as a parameter keeps it that way. The
   *  object must be referentially stable (it is — `useClipCommands` memoizes
   *  it), or this effect re-registers the listener on every render. */
  commands: ClipCommands
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
      // Zoom, also before the hasClips gate: the ruler is visible and zoomable
      // on an empty timeline, so gating it there would be a dead shortcut.
      if (e.metaKey || e.ctrlKey) {
        // `code`, not `key`: with a modifier held, `key` for the +/− keys
        // varies by layout ('=' vs '+', 'Dead' on some), while the physical
        // code does not.
        if (e.code === 'Equal' || e.code === 'NumpadAdd') {
          e.preventDefault()
          st.setZoom(zoomBy(st.pxPerSec, ZOOM_STEP))
          return
        }
        if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
          e.preventDefault()
          st.setZoom(zoomBy(st.pxPerSec, 1 / ZOOM_STEP))
          return
        }
        if (e.code === 'Digit0' || e.code === 'Numpad0') {
          e.preventDefault()
          st.setZoom(DEFAULT_PX_PER_SEC)
          return
        }
        // Clipboard. `preventDefault` only when we actually act, so a real text
        // copy elsewhere on the page still reaches the browser.
        if (e.code === 'KeyC' && st.selectedClipId) {
          e.preventDefault()
          commands.copy()
          return
        }
        if (e.code === 'KeyX' && st.selectedClipId) {
          e.preventDefault()
          commands.cut()
          return
        }
        if (e.code === 'KeyV' && st.clipboard) {
          e.preventDefault()
          commands.paste()
          return
        }
        if (e.code === 'KeyD') {
          e.preventDefault()
          commands.duplicate()
          return
        }
        if (e.code === 'KeyB') {
          e.preventDefault()
          commands.split()
          return
        }
      }
      const hasClips = projectDuration(st.project) > 0
      if (e.code === 'Delete' || e.code === 'Backspace') {
        // The command owns its own precondition (see `targetClip`); guarding
        // again here is how Delete and Cmd+X drifted apart in the first place.
        e.preventDefault()
        commands.remove()
        return
      }
      if (!hasClips) return
      // Bare-key editing shortcuts (Premiere's bindings). These are why
      // `usePanelResize`'s separator has to consume the keys it does — an
      // unconsumed `S` on a focused splitter would split a clip.
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.code === 'KeyS') {
          e.preventDefault()
          commands.split()
          return
        }
        if (e.code === 'KeyQ') {
          e.preventDefault()
          commands.trimToPlayhead('left')
          return
        }
        if (e.code === 'KeyW') {
          e.preventDefault()
          commands.trimToPlayhead('right')
          return
        }
      }
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
  }, [togglePlay, seek, commands, enabled])
}
