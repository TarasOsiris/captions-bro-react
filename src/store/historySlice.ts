// Snapshot-based undo/redo over the document, IN the store — mutation sites
// call `beginEdit`/`beginEditSession` through `getState()` instead of a
// callback prop-drilled from the route (the old useUndoRedo hook). The
// undoable unit is the whole `Project`; session state (playhead / selection /
// export) is deliberately not captured.
//
// Convention (unchanged for callers): announce the edit BEFORE mutating —
// `beginEdit()` for a discrete edit, `beginEditSession()`…`endEditSession()`
// around a continuous one (a drag, a focus run). Internally the snapshot is
// LAZY: begin* only arms `snapshotPending`; the first content mutation pushes
// the pre-mutation state (see forkHistory in store/touch.ts). One session =
// one undo entry no matter how many writes land — replacing the
// per-component `snapshotted` refs.
//
// Memory: immer freezes every project state, so a snapshot is a REFERENCE —
// structural sharing across the 50-entry stack, and the assets inside are the
// same File objects the live project holds, never copies. `replaceProject`
// clears history atomically (old snapshots would point at a dead document
// and, post-hydration, at revoked object URLs), so a snapshot can never be
// the sole owner of a dead File.
//
// THE SHARP EDGE: read `project` and the stacks via `get()` (frozen, pre-set
// state), NEVER via the draft — a draft proxy would defeat the identity dedup
// and leak proxies into the stack. Write via the draft, read via get().

import { touchDocument } from './touch'
import type { Project } from '@/lib/model/types'
import type { EditorState, ImmerSlice } from './editorStore'

export interface HistorySlice {
  /** Past `project` states, oldest first. Frozen references — see header. */
  undoStack: Project[]
  redoStack: Project[]
  /** Armed by begin*; consumed by the next content mutation (forkHistory). */
  snapshotPending: boolean
  /** True while a continuous editing session (drag / focus run) is open. */
  editSessionOpen: boolean
  /** Discrete edit (button, drop commit, delete key): the next mutation will
   *  snapshot. Also closes any leaked session (self-healing). */
  beginEdit: () => void
  /** Continuous edit: the FIRST call arms the one snapshot of the session;
   *  further calls no-op until endEditSession(). */
  beginEditSession: () => void
  /** Close the session so the next edit snapshots again. Disarms a snapshot
   *  the gesture never used, so a later background write can't claim it.
   *  Idempotent — safe from blur/commit/pointerup/pointercancel. */
  endEditSession: () => void
  undo: () => void
  redo: () => void
}

export const selectCanUndo = (s: EditorState) => s.undoStack.length > 0
export const selectCanRedo = (s: EditorState) => s.redoStack.length > 0

export const createHistorySlice: ImmerSlice<HistorySlice> = (set, get) => ({
  undoStack: [],
  redoStack: [],
  snapshotPending: false,
  editSessionOpen: false,

  beginEdit: () => {
    const st = get()
    if (st.snapshotPending && !st.editSessionOpen) return
    set((s) => {
      s.snapshotPending = true
      s.editSessionOpen = false
    })
  },

  beginEditSession: () => {
    if (get().editSessionOpen) return
    set((s) => {
      s.snapshotPending = true
      s.editSessionOpen = true
    })
  },

  endEditSession: () => {
    const st = get()
    if (!st.editSessionOpen && !st.snapshotPending) return
    set((s) => {
      s.editSessionOpen = false
      s.snapshotPending = false
    })
  },

  undo: () => {
    const st = get()
    if (st.undoStack.length === 0) return
    const prev = st.undoStack[st.undoStack.length - 1]
    const current = st.project
    set((s) => {
      s.undoStack = st.undoStack.slice(0, -1)
      s.redoStack = [...st.redoStack, current]
      s.project = prev
      s.editSessionOpen = false
      s.snapshotPending = false
      // Undo changes the document, so it invalidates a finished export too.
      touchDocument(s)
    })
  },

  redo: () => {
    const st = get()
    if (st.redoStack.length === 0) return
    const next = st.redoStack[st.redoStack.length - 1]
    const current = st.project
    set((s) => {
      s.redoStack = st.redoStack.slice(0, -1)
      s.undoStack = [...st.undoStack, current]
      s.project = next
      s.editSessionOpen = false
      s.snapshotPending = false
      touchDocument(s)
    })
  },
})
