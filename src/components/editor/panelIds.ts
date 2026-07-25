// Both layouts are mounted at once (one is `display:none`), so each needs its
// own tabpanel id — `aria-controls` must point at an element that actually
// exists in that subtree. Shared constants rather than `useId`, because the
// rail and the panel it controls live in different components.

export const DESKTOP_PANEL_ID = 'cb-panel-desktop'
export const MOBILE_PANEL_ID = 'cb-panel-mobile'
