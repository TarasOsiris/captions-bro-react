// Desktop chrome preferences — the widths of the two resizable side columns,
// plus the pure geometry that fits them into the row.
//
// Deliberately NOT in the document (they are not part of the project, and an
// undo must not resize the UI) and NOT in the Zustand store (nothing outside
// each panel reads its width, and a store write per pointermove would re-render
// the editor at 60fps). Same shape as projectStore: guarded localStorage,
// SSR-safe, best-effort — a blocked or full storage just means the default.

/** Bounds and storage key for one resizable column, in CSS px.
 *
 *  `initial` is the SINGLE source of truth for the default width: the panel
 *  renders `style={{ width: spec.initial }}`, so there is no Tailwind `w-*`
 *  class mirroring this number. Restating it in the markup is the `19rem`
 *  drift from CLAUDE.md — the two would disagree and the column would jump one
 *  frame after hydration. */
export interface PanelWidthSpec {
  key: string
  min: number
  max: number
  initial: number
}

/** The minimum is what the controls were laid out for; the maximum keeps a
 *  resize from turning the editor into a properties browser. */
export const INSPECTOR_WIDTH: PanelWidthSpec = {
  key: 'cb-inspector-width',
  min: 224,
  max: 480,
  initial: 256,
}

/** Includes the 64px nav rail, since the width is set on the whole <aside>:
 *  272 leaves the bin two tile columns, 352 leaves it three. */
export const MEDIA_WIDTH: PanelWidthSpec = {
  key: 'cb-media-width',
  min: 272,
  max: 560,
  initial: 352,
}

/** The narrowest the preview may be squeezed to (px). The side columns grow out
 *  of the preview's width, and a 16:9 frame below this stops being workable. */
export const MIN_PREVIEW_W = 320

/** The collapsed inspector's edge tab, in CSS px — the only way back once the
 *  column is hidden.
 *
 *  A real `shrink-0` flex sibling, never an absolutely-positioned strip: an
 *  overlay overhanging PreviewStage sits OUTSIDE its dragover/drop subtree, so a
 *  file dropped there navigates the tab away from the editor. Same hazard the
 *  resize handle's inward-only `::after` avoids.
 *
 *  Deliberately invisible to `fitPanels` — adding a third entry to the budget
 *  for 20px is not worth it, and it is provably safe at `lg+`: collapsing
 *  removes at least `INSPECTOR_WIDTH.min`, so the preview is always far wider
 *  than in the expanded case. `layoutPrefs.test.ts` pins that.
 *
 *  A TS constant rather than a `w-5` in the markup, for exactly the reason
 *  `spec.initial` is one: two copies of a number drift. */
export const INSPECTOR_TAB_W = 20

export function clampPanelWidth(spec: PanelWidthSpec, px: number): number {
  return Math.min(spec.max, Math.max(spec.min, Math.round(px)))
}

/**
 * Fit the side columns into a row of `rowWidth`, in one place, for BOTH the
 * live drag bound and the after-the-fact re-fit on window resize.
 *
 * The floor has to be enforced on the PAIR, not per panel: two widths chosen on
 * a wide monitor are each legal on their own and still starve the preview once
 * the window narrows. When they don't fit, every panel gives up the same
 * FRACTION of the space it has above its own minimum, so a re-fit is stable and
 * reversible — widening the window restores the preferred widths exactly.
 *
 * Returns the rendered widths, in the order given. Preferences are never
 * rewritten by this: the caller keeps `preferred` and persists that, so a
 * cramped window can't quietly shrink what the user picked on a big one.
 */
export function fitPanels(
  panels: { min: number; max: number; preferred: number }[],
  rowWidth: number,
): number[] {
  const want = panels.map((p) =>
    Math.min(p.max, Math.max(p.min, Math.round(p.preferred))),
  )
  const budget = Math.max(0, rowWidth - MIN_PREVIEW_W)
  const total = want.reduce((a, b) => a + b, 0)
  if (total <= budget) return want

  const minTotal = panels.reduce((a, p) => a + p.min, 0)
  // Nothing left to give: the row is too narrow for the minimums plus a usable
  // preview. Minimums win — a squeezed preview beats an unusable panel.
  if (budget <= minTotal) return panels.map((p) => p.min)

  const slack = total - minTotal
  const keep = (budget - minTotal) / slack
  return panels.map((p, i) => Math.round(p.min + (want[i] - p.min) * keep))
}

/** The stored width, or null if there is none (or it is unusable). */
export function loadPanelWidth(spec: PanelWidthSpec): number | null {
  try {
    const raw = localStorage.getItem(spec.key)
    if (!raw) return null
    const px = Number(raw)
    return Number.isFinite(px) ? clampPanelWidth(spec, px) : null
  } catch {
    return null
  }
}

export function savePanelWidth(spec: PanelWidthSpec, px: number): void {
  try {
    localStorage.setItem(spec.key, String(clampPanelWidth(spec, px)))
  } catch {
    // Best-effort.
  }
}
