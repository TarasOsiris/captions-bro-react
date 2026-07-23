import { useEffect, useSyncExternalStore } from 'react'
import {
  getAppliedTheme,
  setTheme,
  subscribe,
  syncSystem,
  toggleTheme,
} from '@/lib/theme'
import type { Theme } from '@/lib/theme'

/**
 * Reactive access to the applied theme. `useSyncExternalStore` renders the
 * server snapshot ('dark') during hydration and immediately reconciles to the
 * real applied class on the client — hydration-safe, no warning. Also follows
 * OS appearance changes while no explicit choice is stored.
 */
export function useTheme(): {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggle: () => void
} {
  const theme = useSyncExternalStore(
    subscribe,
    getAppliedTheme,
    () => 'dark' as const,
  )

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => syncSystem(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return { theme, setTheme, toggle: toggleTheme }
}
