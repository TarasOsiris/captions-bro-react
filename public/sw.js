/* Captions Bro service worker — offline shell + runtime caching + Web Share Target.
 *
 * Served verbatim from `public/`, so it is PLAIN JS with no build step and no
 * imports. It is registered by `src/lib/pwa/register.ts` (production only).
 *
 * DESIGN NOTE — this file does not change per deploy, so it must not be the
 * thing that goes stale. Two rules make that true without a build-time hash:
 *
 *  1. Documents are NETWORK-FIRST. Online you always boot the current HTML;
 *     the cache is a fallback for offline/slow, never the primary source. A
 *     stale-while-revalidate shell would be faster but would hand out HTML
 *     pointing at a previous build's asset hashes for one load after a deploy.
 *  2. Build assets are CONTENT-HASHED (`/assets/name-<hash>.js`), so they are
 *     immutable: cache-first can never serve a wrong version, and the cache is
 *     never purged on version bump — it is trimmed by entry count instead, so
 *     a previously cached build still boots offline.
 *
 * `CACHE_VERSION` therefore only exists to force a clean sweep when the caching
 * STRATEGY changes. Bump it then; you do not need to bump it per release.
 */

const CACHE_VERSION = 'v1'

const SHELL_CACHE = `cb-shell-${CACHE_VERSION}` // the SSR document
const ASSET_CACHE = `cb-assets-${CACHE_VERSION}` // hashed /assets/* (immutable)
const STATIC_CACHE = `cb-static-${CACHE_VERSION}` // icons, manifest, favicons
const FONT_CACHE = `cb-fonts-${CACHE_VERSION}` // Google Fonts CSS + woff2
const SHARE_CACHE = 'cb-share-inbox' // Web Share Target hand-off (unversioned)

const CURRENT_CACHES = [
  SHELL_CACHE,
  ASSET_CACHE,
  STATIC_CACHE,
  FONT_CACHE,
  SHARE_CACHE,
]

/** Keep two or three builds' worth of chunks, then evict oldest-first. */
const MAX_ASSET_ENTRIES = 60
const MAX_FONT_ENTRIES = 80

/** How long to wait for the network before falling back to the cached shell. */
const NAV_TIMEOUT_MS = 3500

/** The document. Precached into SHELL_CACHE, which is where the navigation
 *  handler looks for it. */
const SHELL_URL = '/'

/**
 * Static files to precache. These go into STATIC_CACHE, NOT SHELL_CACHE —
 * `isStaticAsset` routes their runtime requests to STATIC_CACHE, so a copy
 * parked anywhere else is dead bytes that no fetch will ever read. (It was
 * SHELL_CACHE, which is exactly that bug: the icons looked precached and the
 * TopBar logo still broke on a first-visit-then-offline reload.)
 *
 * The `?v=2` suffixes are load-bearing — Cache.match keys on the full URL
 * including the query, and that is the form the document requests.
 */
const STATIC_PRECACHE_URLS = [
  '/site.webmanifest',
  '/app-icon-192.png?v=2',
  '/app-icon-512.png?v=2',
  '/apple-touch-icon.png?v=2',
  '/favicon-32.png?v=2',
  '/favicon.ico?v=2',
]

// --- install / activate ----------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // `cache: 'reload'` bypasses the HTTP cache so a reinstall genuinely
      // refetches rather than re-storing a stale copy.
      const [shellHtml] = await Promise.all([precacheShell(), precacheStatic()])
      await precacheShellAssets(shellHtml)
      // Note: no skipWaiting() here. A waiting worker is surfaced to the user
      // as an "Update available" toast; taking over mid-session would swap the
      // asset set under a running export.
    })(),
  )
})

/** Cache the document and hand its HTML back for asset scraping. */
async function precacheShell() {
  try {
    const res = await fetch(new Request(SHELL_URL, { cache: 'reload' }))
    if (!res.ok) return ''
    const html = await res.clone().text()
    await (await caches.open(SHELL_CACHE)).put(SHELL_URL, res)
    return html
  } catch {
    return ''
  }
}

async function precacheStatic() {
  const cache = await caches.open(STATIC_CACHE)
  await Promise.allSettled(
    STATIC_PRECACHE_URLS.map(async (url) => {
      const res = await fetch(new Request(url, { cache: 'reload' }))
      if (res.ok) await cache.put(url, res)
    }),
  )
}

/**
 * Pull the build's entry chunks out of the shell HTML and cache them now.
 *
 * Without this, offline only works from the SECOND visit: the first page load
 * happens before this worker controls the client, so its `/assets/*` requests
 * never reach the fetch handler and never land in the cache. Scraping the
 * `<script>`/`<link>` URLs out of the HTML we just fetched closes that gap —
 * one visit is enough to be installed and offline-capable.
 *
 * Only the entry chunks appear in the HTML; lazily-imported ones (mediabunny,
 * loaded inside `export.ts`) are picked up by the runtime cache-first rule the
 * first time an export runs while online.
 */
async function precacheShellAssets(html) {
  if (!html) return
  const urls = [
    ...new Set(html.match(/\/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g)),
  ]
  if (urls.length === 0) return
  const cache = await caches.open(ASSET_CACHE)
  await Promise.allSettled(
    urls.map(async (url) => {
      if (await cache.match(url)) return
      const res = await fetch(new Request(url, { cache: 'reload' }))
      if (res.ok) await cache.put(url, res)
    }),
  )
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((n) => n.startsWith('cb-') && !CURRENT_CACHES.includes(n))
          .map((n) => caches.delete(n)),
      )
      // Independent caches — nothing gained by serializing them ahead of claim().
      await Promise.all([
        caches.open(ASSET_CACHE).then((c) => trim(c, MAX_ASSET_ENTRIES)),
        caches.open(FONT_CACHE).then((c) => trim(c, MAX_FONT_ENTRIES)),
        sweepShareInbox(),
      ])
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

// --- fetch -----------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  // Web Share Target: an installed app receiving a video/image from the OS
  // share sheet. Handled before every other rule because it is a POST.
  if (req.method === 'POST' && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(handleShareTarget(req))
    return
  }

  if (req.method !== 'GET') return
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return
  // Media elements issue Range requests; a cached 200 would break seeking.
  if (req.headers.has('range')) return

  if (req.mode === 'navigate') {
    event.respondWith(networkFirstDocument(req))
    return
  }

  if (url.origin === self.location.origin) {
    // Vite emits content-hashed filenames here, so these are immutable.
    if (url.pathname.startsWith('/assets/')) {
      event.respondWith(cacheFirst(req, ASSET_CACHE, MAX_ASSET_ENTRIES))
      return
    }
    if (isStaticAsset(url.pathname)) {
      event.respondWith(staleWhileRevalidate(req, STATIC_CACHE, 0))
      return
    }
    return
  }

  // Google Fonts: the stylesheet varies by UA (SWR keeps it fresh), the woff2
  // files it points at are immutable and versioned in their URL.
  if (url.origin === 'https://fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE, MAX_FONT_ENTRIES))
    return
  }
  if (url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONT_CACHE, MAX_FONT_ENTRIES))
    return
  }

  // Anything else (GA4) goes straight to the network and fails offline, which
  // is exactly what analytics should do.
})

function isStaticAsset(pathname) {
  return /\.(png|jpg|jpeg|webp|gif|svg|ico|webmanifest|woff2?)$/.test(pathname)
}

// --- strategies ------------------------------------------------------------

async function networkFirstDocument(req) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const res = await withTimeout(fetch(req), NAV_TIMEOUT_MS)
    // Only 200s are worth storing; a redirect cached as the shell is a trap
    // (a redirected Response cannot be returned for a navigation).
    if (res.ok && res.type === 'basic' && !res.redirected) {
      cache.put(SHELL_URL, res.clone()).catch(() => {})
    }
    // A 5xx means the ORIGIN is unwell, not that the app is — and the app is
    // entirely client-side. Serving the cached shell through a deploy blip or
    // an edge hiccup is strictly better than showing the host's error page.
    // Client errors (404/410) are left alone: those are answers, not outages.
    if (res.status >= 500) {
      const cached = await cache.match(SHELL_URL)
      if (cached) return cached
    }
    return res
  } catch {
    const cached = (await cache.match(req)) || (await cache.match('/'))
    if (cached) return cached
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}

async function cacheFirst(req, cacheName, max) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(req)
  if (cached) return cached
  const res = await fetch(req)
  // `opaque` (no-cors) responses have status 0 but are still worth caching for
  // fonts; everything else must be a real 200.
  if (res.ok || res.type === 'opaque') {
    cache.put(req, res.clone()).catch(() => {})
    if (max) trim(cache, max)
  }
  return res
}

async function staleWhileRevalidate(req, cacheName, max) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(req)
  const network = fetch(req)
    .then((res) => {
      if (res.ok || res.type === 'opaque') {
        cache.put(req, res.clone()).catch(() => {})
        if (max) trim(cache, max)
      }
      return res
    })
    .catch(() => undefined)
  const fresh = cached ? undefined : await network
  return cached || fresh || Response.error()
}

/** Evict oldest-first. `cache.keys()` preserves insertion order. Takes an open
 *  handle, not a name — every caller already has one. */
async function trim(cache, max) {
  try {
    const keys = await cache.keys()
    if (keys.length <= max) return
    await Promise.all(
      keys.slice(0, keys.length - max).map((k) => cache.delete(k)),
    )
  } catch {
    // A quota or storage error here must never fail an install/activate.
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timeout'))
    }, ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// --- Web Share Target ------------------------------------------------------
//
// The manifest declares a POST/multipart share target. There is no server route
// behind it: this handler drains the form, parks the files in a Cache (the only
// storage a service worker and a page can both reach without a schema) and
// redirects to the editor, which drains the inbox on boot.
// See `src/lib/pwa/shareTarget.ts` — the two must agree on these constants.

const SHARE_TARGET_PATH = '/share-target'
const SHARE_INBOX_PREFIX = '/__shared-media/'
const SHARE_FLAG = 'share-target'

/**
 * How long a parked share stays claimable. A share is meant to be consumed by
 * the launch it triggers, so this is generous, not permissive.
 *
 * It exists because the inbox holds WHOLE VIDEO FILES. Share a 1.5 GB clip,
 * then kill the app before the editor drains it, and without an expiry that
 * blob sits in Cache storage forever — eating the origin quota until IndexedDB
 * asset persistence starts failing. The page enforces the same window on read
 * (`lib/pwa/shareTarget.ts`), and `sweepShareInbox` collects the rest.
 */
const SHARE_TTL_MS = 10 * 60 * 1000

async function handleShareTarget(req) {
  try {
    const form = await req.formData()
    const files = form.getAll('media').filter((f) => f instanceof File)
    if (files.length) {
      const cache = await caches.open(SHARE_CACHE)
      // Drop anything a previous, abandoned share left behind.
      for (const key of await cache.keys()) await cache.delete(key)
      const sharedAt = String(Date.now())
      await Promise.all(
        files.map((file, i) =>
          cache.put(
            `${SHARE_INBOX_PREFIX}${i}`,
            new Response(file, {
              headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'X-Filename': encodeURIComponent(file.name || `shared-${i}`),
                'X-Shared-At': sharedAt,
              },
            }),
          ),
        ),
      )
    }
  } catch {
    // A malformed share must still land the user in the editor.
  }
  return Response.redirect(`/?${SHARE_FLAG}=1`, 303)
}

/**
 * Delete expired inbox entries. The page drains the inbox on every launch, so
 * this is the backstop for the case where it never gets one — shared, then the
 * app was never opened. Runs on activate.
 */
async function sweepShareInbox() {
  try {
    const cache = await caches.open(SHARE_CACHE)
    const now = Date.now()
    await Promise.all(
      (await cache.keys()).map(async (key) => {
        const res = await cache.match(key)
        const at = Number(res?.headers.get('X-Shared-At') ?? 0)
        // A missing/garbage timestamp predates this scheme — collect it.
        if (!at || now - at > SHARE_TTL_MS) await cache.delete(key)
      }),
    )
  } catch {
    // Storage trouble here must never fail activate.
  }
}

// --- offline fallback ------------------------------------------------------
//
// Only ever seen by someone whose very first visit is offline (the shell was
// never cached). Deliberately dependency-free and inline.

const OFFLINE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Captions Bro — offline</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100dvh; display:grid; place-items:center;
         background:#15181d; color:#dce0e6; font:16px/1.5 system-ui, sans-serif;
         text-align:center; padding:2rem }
  h1 { font-size:1.125rem; margin:0 0 .5rem }
  p { margin:0; color:#8b94a0; font-size:.875rem; max-width:32ch }
</style></head>
<body><div>
  <h1>You're offline</h1>
  <p>Captions Bro hasn't finished installing yet. Reconnect once and it will work offline from then on.</p>
</div></body></html>`
