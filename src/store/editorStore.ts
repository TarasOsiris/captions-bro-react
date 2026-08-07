// The single editor store: Zustand (as in fakechat) + immer for clean nested
// document updates. Composed from seven slices. Read with atomic selectors
// (`useEditorStore(s => s.currentTime)`); read imperatively in async/rAF code with
// `useEditorStore.getState()` — this replaces the old manual ref-mirroring.

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { StateCreator } from 'zustand'
import { createDocumentSlice } from './documentSlice'
import { createHistorySlice } from './historySlice'
import { createPlaybackSlice } from './playbackSlice'
import { createSelectionSlice } from './selectionSlice'
import { createExportSlice } from './exportSlice'
import { createUiSlice } from './uiSlice'
import { createClipboardSlice } from './clipboardSlice'
import type { DocumentSlice } from './documentSlice'
import type { HistorySlice } from './historySlice'
import type { PlaybackSlice } from './playbackSlice'
import type { SelectionSlice } from './selectionSlice'
import type { ExportSlice } from './exportSlice'
import type { UiSlice } from './uiSlice'
import type { ClipboardSlice } from './clipboardSlice'

export type EditorState = DocumentSlice &
  HistorySlice &
  PlaybackSlice &
  SelectionSlice &
  ExportSlice &
  UiSlice &
  ClipboardSlice

/** Slice-creator type bound to the middleware stack. Each slice is `(set,get)=>{…}`. */
export type ImmerSlice<T> = StateCreator<
  EditorState,
  [['zustand/subscribeWithSelector', never], ['zustand/immer', never]],
  [],
  T
>

export const useEditorStore = create<EditorState>()(
  // subscribeWithSelector: imperative subscribers pick a slice of state and
  // only hear when IT changes — without it, useServiceWorker had to hand-diff
  // exportPhase on every store write (every frame of a slider drag).
  subscribeWithSelector(
    immer((...a) => ({
      ...createDocumentSlice(...a),
      ...createHistorySlice(...a),
      ...createPlaybackSlice(...a),
      ...createSelectionSlice(...a),
      ...createExportSlice(...a),
      ...createUiSlice(...a),
      ...createClipboardSlice(...a),
    })),
  ),
)
