// Light/dark theme: a tiny external store, deliberately outside the Zustand
// editor store (theme is orthogonal UI chrome, applied imperatively to the DOM
// and initialized from the anti-FOUC <head> script — it must not entangle with
// document undo/persistence). The class on <html> is the source of truth.

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'cb-theme'

// Meta `theme-color` values, matching --surface per theme — NOT --bg. This
// colours the mobile browser chrome and, in an installed PWA, the strip behind
// the status bar; both sit directly above the TopBar, which is `bg-surface`.
//
// THE source of truth: `lib/seo.ts` imports these for the SSR default rather
// than repeating the hex, so the server-rendered tag and the value this module
// writes on mount cannot drift (the `19rem` lesson in CLAUDE.md). The one copy
// that must stay a literal is `theme_color` in public/site.webmanifest — JSON
// can't import TS — and it has to equal the dark value or the launch flashes.
export const THEME_COLOR: Record<Theme, string> = {
  dark: '#1d222a',
  light: '#ffffff',
}

/** The theme currently applied to the document — read from the class the
 *  <head> script (or setTheme) set, so React never drifts from the DOM. */
export function getAppliedTheme(): Theme {
  if (typeof document === 'undefined') return 'dark' // stable SSR snapshot
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/** The user's explicit choice, or null when they've never toggled. */
export function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

const listeners = new Set<() => void>()

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Apply a theme to the DOM and notify subscribers. Does NOT persist —
 *  used both by setTheme (which persists first) and the system-pref path. */
function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
  setMetaThemeColor(theme)
  listeners.forEach((l) => l())
}

function setMetaThemeColor(theme: Theme) {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[theme])
}

/**
 * Point the `theme-color` meta at the theme the document is ACTUALLY showing.
 *
 * The anti-FOUC script in `__root.tsx` picks the theme before first paint, but
 * it only sets the class and `colorScheme` — the meta keeps its server-rendered
 * dark value. Nothing else corrected it: `applyTheme` runs only from an explicit
 * toggle or an OS appearance CHANGE, so a light-appearance user who never
 * touched the toggle kept a dark bar all session. In an installed PWA that is a
 * dark band across the top of a white TopBar on every launch, because
 * `apple-mobile-web-app-status-bar-style: default` tints the status bar from
 * exactly this tag. Called once on mount by `useTheme`.
 */
export function syncMetaThemeColor(): void {
  if (typeof document === 'undefined') return
  setMetaThemeColor(getAppliedTheme())
}

/** Set the theme as an explicit user choice (persisted, overrides system). */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // ignore (private mode / storage disabled)
  }
  applyTheme(theme)
}

export function toggleTheme() {
  setTheme(getAppliedTheme() === 'dark' ? 'light' : 'dark')
}

/** Follow an OS appearance change — only while the user has made no explicit
 *  choice (a stored preference always wins). */
export function syncSystem(isDark: boolean) {
  if (getStoredTheme() === null) applyTheme(isDark ? 'dark' : 'light')
}
