// Which side panel is showing. Session state, like the selection — never
// captured in an undo snapshot (`replaceProject` only writes `s.project`).
//
// It lives in the store rather than in a component because BOTH always-mounted
// panel containers need it and so do PreviewStage and Timeline, which set it
// imperatively from pointer handlers via `getState()`. Prop-drilling it through
// routes/index.tsx to four consumers would be worse.
//
// ONE value — `panel` — read differently by the two containers, which is what
// lets the mobile and desktop layouts diverge without a JS breakpoint fork (see
// the CSS-only breakpoints rule in CLAUDE.md):
//   MediaPanel (lg+)   reads `panel ?? 'media'` — the desktop bin is never closed
//   MobileDock (< lg)  reads `panel` raw — null means the sheet is down
//
// The inspector's desktop collapse is deliberately NOT folded into that trick —
// see `inspectorCollapsed` below.

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
  /** Desktop only: the inspector column is collapsed to its edge tab.
   *
   *  SESSION state, for the same reasons as `pxPerSec` above — never in
   *  `Project` (undo must not reopen a panel, and it would dirty the autosave)
   *  — and deliberately NOT persisted either: the route is SSR'd and this
   *  drives a className, so a value restored from localStorage would be a
   *  hydration mismatch on first paint.
   *
   *  Read only at `lg+`: the column and its tab are both `display:none` below
   *  it, so this cannot reach the mobile layout. The sheet's dismiss stays
   *  `setPanel(null)` — two affordances, two values, deliberately NOT one value
   *  read two ways the way `panel` is. The column is not a `panel`, and the two
   *  states have to survive each other. */
  inspectorCollapsed: boolean
  /** A setter, not a toggle: the collapse and expand controls are never both
   *  visible, so neither can honestly observe the other's state. */
  setInspectorCollapsed: (collapsed: boolean) => void
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

  inspectorCollapsed: false,

  setInspectorCollapsed: (collapsed) =>
    set((s) => {
      s.inspectorCollapsed = collapsed
    }),

  draggingAssetId: null,

  setDraggingAssetId: (id) =>
    set((s) => {
      s.draggingAssetId = id
    }),
})
