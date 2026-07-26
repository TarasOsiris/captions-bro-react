// Service worker registration + the update handshake.
//
// Client-only: every entry point guards `navigator`, and nothing here runs at
// module scope (SSR rule, CLAUDE.md).
//
// The worker never calls `skipWaiting()` on its own. A new build that took over
// mid-session would swap the asset set under a running export, so an update sits
// in the `waiting` state until the user accepts it — see `useServiceWorker`.

import { SW_URL } from './constants'

/** Re-check for a new worker at most this often when the tab regains focus. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

let registration: ServiceWorkerRegistration | null = null
let lastUpdateCheck = 0

function supported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

/**
 * Register the worker and call `onUpdate` whenever a newer one is installed and
 * waiting. Returns a cleanup that detaches the listeners (the worker itself
 * stays registered — that's the point of it).
 *
 * `onUpdate` fires ONLY when a controller already exists. On the very first
 * visit the worker installs with nothing to replace, which is an install, not
 * an update, and must not prompt a reload.
 */
export function registerServiceWorker(onUpdate: () => void): () => void {
  if (!supported()) return () => {}

  let disposed = false
  const cleanups: Array<() => void> = []

  const watch = (reg: ServiceWorkerRegistration) => {
    if (reg.waiting && navigator.serviceWorker.controller) onUpdate()

    const onUpdateFound = () => {
      const installing = reg.installing
      if (!installing) return
      const onStateChange = () => {
        if (
          installing.state === 'installed' &&
          navigator.serviceWorker.controller
        ) {
          onUpdate()
        }
      }
      installing.addEventListener('statechange', onStateChange)
      cleanups.push(() => {
        installing.removeEventListener('statechange', onStateChange)
      })
    }
    reg.addEventListener('updatefound', onUpdateFound)
    cleanups.push(() => {
      reg.removeEventListener('updatefound', onUpdateFound)
    })
  }

  // `updateViaCache: 'none'` keeps the HTTP cache out of the update check, so a
  // long-lived `Cache-Control` on /sw.js can't freeze the app on an old build.
  navigator.serviceWorker
    .register(SW_URL, { scope: '/', updateViaCache: 'none' })
    .then((reg) => {
      registration = reg
      if (!disposed) watch(reg)
    })
    .catch(() => {
      // Unsupported, blocked by policy, or a private-mode profile: the app is
      // fully functional online without a worker, so this is not an error.
    })

  // Long-lived editor sessions would otherwise never learn about a deploy.
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return
    const now = Date.now()
    if (now - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return
    lastUpdateCheck = now
    registration?.update().catch(() => {})
  }
  document.addEventListener('visibilitychange', onVisible)
  cleanups.push(() => {
    document.removeEventListener('visibilitychange', onVisible)
  })

  return () => {
    disposed = true
    for (const fn of cleanups) fn()
  }
}

/**
 * Accept a waiting update: tell it to take over, then reload once it has.
 * Reloading before `controllerchange` would just re-boot the old build.
 */
export function applyUpdate(): void {
  const waiting = registration?.waiting
  if (!waiting) {
    window.location.reload()
    return
  }
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
  waiting.postMessage({ type: 'SKIP_WAITING' })
}

/**
 * Tear down any worker registered on this origin, and its caches.
 *
 * `npm run dev`, `npm run preview` and `npm run start` all share
 * `localhost:3000`, so a worker installed by a production build would otherwise
 * keep serving cached prod assets over the dev server.
 */
export function unregisterServiceWorker(): void {
  if (!supported()) return
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => {
      for (const reg of regs) void reg.unregister()
    })
    .catch(() => {})
  if (typeof caches !== 'undefined') {
    caches
      .keys()
      .then((names) => {
        for (const name of names) {
          if (name.startsWith('cb-')) void caches.delete(name)
        }
      })
      .catch(() => {})
  }
}
