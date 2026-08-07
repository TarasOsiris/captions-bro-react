// The clip clipboard. SESSION state, deliberately:
//
//  - not in `Project`, so a copy is not an undoable document change and does
//    not dirty the autosave;
//  - not persisted, because the clip may reference an asset whose blob is gone
//    by the next session (paste guards for that anyway — see useClipInsert);
//  - NOT cleared by `replaceProject`, so a copy survives an undo/redo or a
//    document reload and can still be pasted afterwards.
//
// Not `navigator.clipboard`: a custom MIME round-trip is unreliable across
// browsers and buys nothing — nothing else can read a Captions Bro clip.

import type { Clip } from '@/lib/model/types'
import type { ImmerSlice } from './editorStore'

export interface ClipboardSlice {
  /** A DETACHED copy of the clip, already cloned at copy time so deleting the
   *  source cannot corrupt it. Its id is stale by design — paste mints a fresh
   *  one, so pasting twice yields two clips rather than one duplicate id. */
  clipboard: Clip | null
  setClipboard: (clip: Clip | null) => void
}

export const createClipboardSlice: ImmerSlice<ClipboardSlice> = (set) => ({
  clipboard: null,

  setClipboard: (clip) =>
    set((s) => {
      s.clipboard = clip
    }),
})
