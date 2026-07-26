// Web Share Target: the page half of the hand-off.
//
// An installed app can be a target of the OS share sheet ("share this video to
// Captions Bro"). The manifest declares a POST/multipart endpoint; there is no
// server behind it, so `public/sw.js` intercepts the POST, parks the files in a
// Cache and redirects here with `?share-target=1`. The Cache is the only
// storage a service worker and a page can both reach without agreeing on an
// IndexedDB schema.
//
// READ AND DELETE ARE SEPARATE ON PURPOSE. `peekSharedFiles` does not mutate
// the inbox; the caller calls `discardSharedFiles` only once the files have
// actually reached the importer. A single take-and-delete would destroy the
// share before anything consumed it — and since the import can be deferred
// (mid-export, or before the saved project has finished hydrating), that window
// is real, not theoretical.

import { SHARE_CACHE, SHARE_FLAG, SHARE_INBOX_PREFIX } from './constants'

/** Must match `SHARE_TTL_MS` in public/sw.js — see constants.test.ts. */
export const SHARE_TTL_MS = 10 * 60 * 1000

/** True when the current URL is the redirect the worker sent us to. This is a
 *  HINT, not the trigger: a share into an already-running app focuses the
 *  window without navigating, so there is no flag to read. The inbox itself is
 *  the source of truth — see `useLaunchFiles`. */
export function hasShareFlag(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has(SHARE_FLAG)
}

/** Strip the flag so a reload (or a bookmark) isn't a second import. */
export function clearShareFlag(): void {
  if (!hasShareFlag()) return
  const url = new URL(window.location.href)
  url.searchParams.delete(SHARE_FLAG)
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
}

/**
 * Read the inbox WITHOUT emptying it. Rejects if the Cache can't be read, so
 * the caller can say so — a share that silently vanishes is indistinguishable
 * from a broken app.
 *
 * Entries past `SHARE_TTL_MS` are dropped rather than imported: a share is
 * meant for the launch that triggered it, and the blob is a whole video file.
 */
export async function peekSharedFiles(): Promise<File[]> {
  if (typeof caches === 'undefined') return []
  const cache = await caches.open(SHARE_CACHE)
  const keys = (await cache.keys()).filter((req) =>
    new URL(req.url).pathname.startsWith(SHARE_INBOX_PREFIX),
  )
  if (keys.length === 0) return []
  const now = Date.now()
  // Concurrently: a multi-file share otherwise serializes N cache reads on the
  // boot path, before the importer sees the first one.
  const files = await Promise.all(
    keys.map(async (key) => {
      const res = await cache.match(key)
      if (!res) return null
      const sharedAt = Number(res.headers.get('X-Shared-At') ?? 0)
      if (!sharedAt || now - sharedAt > SHARE_TTL_MS) return null
      const blob = await res.blob()
      const name = decodeURIComponent(
        res.headers.get('X-Filename') ?? 'shared-media',
      )
      return new File([blob], name, {
        type: res.headers.get('Content-Type') ?? blob.type,
      })
    }),
  )
  return files.filter((f) => f !== null)
}

/** Empty the inbox. Call once the files are in the editor, never before. */
export async function discardSharedFiles(): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const cache = await caches.open(SHARE_CACHE)
    await Promise.all((await cache.keys()).map((k) => cache.delete(k)))
  } catch {
    // Best-effort: the worker's TTL sweep collects whatever is left.
  }
}
