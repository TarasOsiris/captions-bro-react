// Light/dark theme: a tiny external store, deliberately outside the Zustand
// editor store (theme is orthogonal UI chrome, applied imperatively to the DOM
// and initialized from the anti-FOUC <head> script — it must not entangle with
// document undo/persistence). The class on <html> is the source of truth.

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'cb-theme'

// Meta `theme-color` values (mobile browser chrome), matching --bg per theme.
const THEME_COLOR: Record<Theme, string> = {
  dark: '#0b0d10',
  light: '#f4f5f7',
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
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[theme])
  listeners.forEach((l) => l())
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
