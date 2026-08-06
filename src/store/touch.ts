// The ONE "document changed" seam. Every content mutation in documentSlice
// (via its `mutate` wrapper) and every undo/redo routes through touchDocument,
// so "a finished export no longer matches the document" is a store guarantee
// rather than a call-site convention — the pre-reform code enforced it with
// scattered resetExport() calls that missed every Timeline mutation.
//
// Lives in its own module so documentSlice and historySlice can both import it
// without a cycle: it imports nothing from the store but types.

import type { WritableDraft } from 'immer'
import type { EditorState } from './editorStore'

/** A finished export no longer matches the document — drop it. Only 'done':
 *  a mutation mid-'exporting' must never unmount the progress/cancel UI (the
 *  resetExport-during-encode hazard CLAUDE.md documents). The object URL is
 *  not revoked here — useExport owns URL lifecycle, exactly as it did when
 *  resetExport cleared these fields. */
export function clearStaleExport(s: WritableDraft<EditorState>): void {
  if (s.exportPhase !== 'done') return
  s.exportPhase = 'idle'
  s.exportProgress = 0
  s.downloadUrl = null
  s.downloadName = null
  s.exportSilent = false
}

/** The document changed: bump the revision and drop a stale finished export.
 *  The revision lives OUTSIDE `project` on purpose — bumping it must not
 *  dirty usePersistence's `s.project` subscription. */
export function touchDocument(s: WritableDraft<EditorState>): void {
  s.documentRevision += 1
  clearStaleExport(s)
}

const UNDO_LIMIT = 50

/** History bookkeeping for a content mutation (documentSlice's `mutate` calls
 *  this; undo/redo must NOT). Two things happen at the moment a mutation is
 *  about to land:
 *
 *  1. LAZY SNAPSHOT — beginEdit/beginEditSession only ARM `snapshotPending`;
 *     the pre-mutation project is pushed here, at the first real mutation. A
 *     gesture that arms but never moves therefore stacks nothing — and cannot
 *     eat a pending redo, which snapshot-at-arm did.
 *  2. FORK — any content mutation makes the redo branch stale (replaying it
 *     would resurrect a document that no longer includes this change), so it
 *     is cleared — armed or not.
 *
 *  `pre` is the FROZEN pre-set state (get()), never the draft: pushing a
 *  draft proxy would defeat the identity dedup and leak proxies. */
export function forkHistory(
  s: WritableDraft<EditorState>,
  pre: EditorState,
): void {
  if (pre.snapshotPending) {
    const top = pre.undoStack[pre.undoStack.length - 1]
    // Identity dedup: a previous armed mutation that no-op'd (unknown id) can
    // leave the top === current; don't stack the same state twice.
    if (top !== pre.project) {
      s.undoStack = [...pre.undoStack.slice(-(UNDO_LIMIT - 1)), pre.project]
    }
    s.snapshotPending = false
  }
  if (pre.redoStack.length > 0) s.redoStack = []
}
