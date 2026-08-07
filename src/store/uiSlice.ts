// Which side panel is showing. Session state, like the selection — never
// captured in an undo snapshot (`replaceProject` only writes `s.project`).
//
// It lives in the store rather than in a component because BOTH always-mounted
// panel containers need it and so do PreviewStage and Timeline, which set it
// imperatively from pointer handlers via `getState()`. Prop-drilling it through
// routes/index.tsx to four consumers would be worse.
//
// ONE value, read differently by the two containers — this is what lets the
// mobile and desktop layouts diverge without a JS breakpoint fork (see the
// CSS-only breakpoints rule in CLAUDE.md):
//   MediaPanel (lg+)   reads `panel ?? 'media'` — the desktop bin is never closed
//   MobileDock (< lg)  reads `panel` raw — null means the sheet is down

import { DEFAULT_PX_PER_SEC, clampZoom } from '@/lib/timeline/zoom'
import type { ImmerSlice } from './editorStore'

export type Panel = 'media' | 'text' | 'canvas' | 'inspector'

export interface UiSlice {
  panel: Panel | null
  setPanel: (panel: Panel | null) => void
  /** Timeline scale, px per second.
   *
   *  HERE and not in `Project`: zoom is chrome. In the document it would be
   *  captured by every undo snapshot (so Cmd+Z would un-zoom), saved into the
   *  file, and would dirty the autosave on every wheel tick. */
  pxPerSec: number
  /** Set the timeline scale, clamped to the legal range. */
  setZoom: (pxPerSec: number) => void
  /** Open `panel`, or close it if it is already the active one. */
  togglePanel: (panel: Panel) => void
  /** The asset id of an in-flight bin→timeline HTML5 drag, or null. Mirrored
   *  here by the bin tile's dragstart because `dragover` cannot read
   *  `dataTransfer` data (the browser withholds it until drop) — and the
   *  Timeline's drop preview needs the asset's duration to pick a lane. */
  draggingAssetId: string | null
  setDraggingAssetId: (id: string | null) => void
}

export const createUiSlice: ImmerSlice<UiSlice> = (set) => ({
  panel: null,

  setPanel: (panel) =>
    set((s) => {
      s.panel = panel
    }),

  togglePanel: (panel) =>
    set((s) => {
      s.panel = s.panel === panel ? null : panel
    }),

  pxPerSec: DEFAULT_PX_PER_SEC,

  setZoom: (pxPerSec) =>
    set((s) => {
      s.pxPerSec = clampZoom(pxPerSec)
    }),

  draggingAssetId: null,

  setDraggingAssetId: (id) =>
    set((s) => {
      s.draggingAssetId = id
    }),
})
