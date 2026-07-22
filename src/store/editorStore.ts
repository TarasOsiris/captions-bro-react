// The single editor store: Zustand (as in fakechat) + immer for clean nested
// document updates. Composed from four slices. Read with atomic selectors
// (`useEditorStore(s => s.currentTime)`); read imperatively in async/rAF code with
// `useEditorStore.getState()` — this replaces the old manual ref-mirroring.

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { StateCreator } from 'zustand'
import { createDocumentSlice } from './documentSlice'
import { createPlaybackSlice } from './playbackSlice'
import { createSelectionSlice } from './selectionSlice'
import { createExportSlice } from './exportSlice'
import type { DocumentSlice } from './documentSlice'
import type { PlaybackSlice } from './playbackSlice'
import type { SelectionSlice } from './selectionSlice'
import type { ExportSlice } from './exportSlice'

export type EditorState = DocumentSlice &
  PlaybackSlice &
  SelectionSlice &
  ExportSlice

/** Slice-creator type bound to the immer middleware. Each slice is `(set,get)=>{…}`. */
export type ImmerSlice<T> = StateCreator<
  EditorState,
  [['zustand/immer', never]],
  [],
  T
>

export const useEditorStore = create<EditorState>()(
  immer((...a) => ({
    ...createDocumentSlice(...a),
    ...createPlaybackSlice(...a),
    ...createSelectionSlice(...a),
    ...createExportSlice(...a),
  })),
)
