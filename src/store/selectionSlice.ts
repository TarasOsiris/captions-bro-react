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
    }),
})
