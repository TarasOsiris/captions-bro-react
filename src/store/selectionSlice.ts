// What the user has selected on the canvas/timeline. Session state — not undone.

import type { ImmerSlice } from './editorStore'

export interface SelectionSlice {
  selectedClipId: string | null
  selectClip: (id: string | null) => void
}

export const createSelectionSlice: ImmerSlice<SelectionSlice> = (set) => ({
  selectedClipId: null,
  selectClip: (id) =>
    set((s) => {
      s.selectedClipId = id
      // Deselecting closes the inspector, which has nothing left to show. Done
      // here as one atomic write rather than in an effect, because the mobile
      // inspector lives in a `display:none` subtree at lg+ and an effect there
      // would be unreliable.
      if (id == null && s.panel === 'inspector') s.panel = null
    }),
})
