// Web Share Target: the page half of the hand-off.
//
// An installed app can be a target of the OS share sheet ("share this video to
// Captions Bro"). The manifest declares a POST/multipart endpoint; there is no
// server behind it, so `public/sw.js` intercepts the POST, parks the files in a
// Cache and redirects here with `?share-target=1`. The Cache is the only
// storage a service worker and a page can both reach without agreeing on an
// IndexedDB schema.
//
// This is a hand-off, not storage: the inbox is drained and emptied on read, so
// a reload can't re-import the same files.

import { SHARE_CACHE, SHARE_FLAG, SHARE_INBOX_PREFIX } from './constants'

/** True when the current URL is the redirect the worker sent us to. */
export function hasSharedFiles(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has(SHARE_FLAG)
}

/** Strip the flag so a reload (or a bookmark) isn't a second import. */
export function clearShareFlag(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete(SHARE_FLAG)
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
}

/** Read and empty the inbox. Returns [] on any failure — a share that can't be
 *  read must still land the user in a working editor. */
export async function takeSharedFiles(): Promise<File[]> {
  if (typeof caches === 'undefined') return []
  try {
    const cache = await caches.open(SHARE_CACHE)
    const keys = (await cache.keys()).filter((req) =>
      new URL(req.url).pathname.startsWith(SHARE_INBOX_PREFIX),
    )
    const files: File[] = []
    for (const key of keys) {
      const res = await cache.match(key)
      if (!res) continue
      const blob = await res.blob()
      const name = decodeURIComponent(
        res.headers.get('X-Filename') ?? 'shared-media',
      )
      files.push(
        new File([blob], name, {
          type: res.headers.get('Content-Type') ?? blob.type,
        }),
      )
    }
    await Promise.all(keys.map((k) => cache.delete(k)))
    return files
  } catch {
    return []
  }
}
