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

import type { ImmerSlice } from './editorStore'

export type Panel = 'media' | 'text' | 'inspector'

export interface UiSlice {
  panel: Panel | null
  setPanel: (panel: Panel | null) => void
  /** Open `panel`, or close it if it is already the active one. */
  togglePanel: (panel: Panel) => void
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
})
