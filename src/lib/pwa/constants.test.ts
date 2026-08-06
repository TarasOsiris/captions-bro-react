// The PWA contract spans three files that CANNOT import each other:
//
//   src/lib/pwa/constants.ts  — TS, bundled
//   public/sw.js              — plain JS, served verbatim (no build step, by design)
//   public/site.webmanifest   — JSON, read by the browser
//
// So the share-target path, cache name, inbox prefix and theme colour exist as
// literals in more than one place, synced by comments. That is exactly the
// `19rem` failure mode CLAUDE.md calls out — a number that silently drifts from
// the thing it is supposed to match. This file is the enforcement: it reads the
// other two as TEXT and asserts they still agree.
//
// Drift here is otherwise invisible until a real share-to-app or an installed
// launch goes wrong on someone's phone.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SHARE_CACHE,
  SHARE_FLAG,
  SHARE_INBOX_PREFIX,
  SHARE_TARGET_PATH,
  SW_URL,
} from './constants'
import { SHARE_TTL_MS } from './shareTarget'
import { THEME_COLOR } from '@/lib/theme'
import { defaultDescription } from '@/lib/seo'

const publicDir = resolve(import.meta.dirname, '../../../public')
const swSource = readFileSync(resolve(publicDir, 'sw.js'), 'utf8')
const manifest = JSON.parse(
  readFileSync(resolve(publicDir, 'site.webmanifest'), 'utf8'),
) as {
  theme_color: string
  start_url: string
  description: string
  icons: Array<{ src: string; purpose?: string }>
  share_target: { action: string; params: { files: Array<{ name: string }> } }
}

/** The string literals inside sw.js's STATIC_PRECACHE_URLS array. */
function precachedPaths(): string[] {
  const urls = /const STATIC_PRECACHE_URLS = \[([^\]]*)\]/.exec(swSource)?.[1]
  return [...(urls ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** The value `sw.js` assigns to a top-level `const`. */
function swConst(name: string): string | undefined {
  return new RegExp(`^const ${name} = '([^']*)'`, 'm').exec(swSource)?.[1]
}

describe('service worker constants', () => {
  it('is registered at the path the worker is served from', () => {
    expect(SW_URL).toBe('/sw.js')
  })

  it.each([
    ['SHARE_TARGET_PATH', SHARE_TARGET_PATH],
    ['SHARE_CACHE', SHARE_CACHE],
    ['SHARE_INBOX_PREFIX', SHARE_INBOX_PREFIX],
    ['SHARE_FLAG', SHARE_FLAG],
  ])('public/sw.js declares %s with the same value', (name, expected) => {
    expect(swConst(name)).toBe(expected)
  })

  // Both sides drop expired shares. If the page's window were the longer one it
  // would hand the importer files the worker had already collected.
  it('agrees with the page on how long a parked share stays claimable', () => {
    const swTtl = /^const SHARE_TTL_MS = ([\d *]+)$/m.exec(swSource)?.[1]
    expect(swTtl).toBeDefined()
    expect(evalProduct(swTtl!)).toBe(SHARE_TTL_MS)
  })

  // The precached static files must land in the cache the fetch handler READS
  // for them, or they are dead bytes — `isStaticAsset` routes to STATIC_CACHE.
  it('precaches icons and the manifest into STATIC_CACHE', () => {
    expect(swSource).toMatch(/const cache = await caches\.open\(STATIC_CACHE\)/)
    expect(swSource).toContain('STATIC_PRECACHE_URLS.map')
    // Every precached path must actually match the static-asset predicate.
    const paths = precachedPaths()
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      expect(
        /\.(png|jpg|jpeg|webp|gif|svg|ico|webmanifest|woff2?)$/.test(
          path.split('?')[0],
        ),
      ).toBe(true)
    }
  })

  // The install dialog and the home-screen icon come from the MANIFEST's list;
  // anything on it that the worker doesn't precache is missing on a
  // first-visit-then-offline launch. The maskable pair was exactly that.
  it('precaches every icon the manifest declares', () => {
    const paths = new Set(precachedPaths())
    for (const icon of manifest.icons) {
      expect(paths.has(icon.src)).toBe(true)
    }
  })

  // `Cache.match` keys on the FULL url including the query, so a precached
  // '/x.png' never serves a document's request for '/x.png?v=2'.
  it('precaches each icon with the exact query the manifest requests', () => {
    const byFile = new Map(
      precachedPaths().map((p) => [p.split('?')[0], p] as const),
    )
    for (const icon of manifest.icons) {
      expect(byFile.get(icon.src.split('?')[0])).toBe(icon.src)
    }
  })
})

/** Evaluate a `10 * 60 * 1000`-shaped literal without running the worker. */
function evalProduct(expr: string): number {
  return expr.split('*').reduce((acc, n) => acc * Number(n.trim()), 1)
}

describe('web app manifest', () => {
  it('posts shares to the path the worker intercepts', () => {
    expect(manifest.share_target.action).toBe(SHARE_TARGET_PATH)
  })

  it('names the share file field `media`, which the worker reads', () => {
    expect(manifest.share_target.params.files[0].name).toBe('media')
    expect(swSource).toContain("form.getAll('media')")
  })

  // The manifest colour paints the splash/status bar before any JS runs; if it
  // disagrees with the dark theme the app launches with a visible flash.
  it('theme_color matches the dark theme', () => {
    expect(manifest.theme_color).toBe(THEME_COLOR.dark)
  })

  // The same product claim is written three times — here, in seo.ts's
  // `defaultDescription`, and as sr-only copy in routes/index.tsx — because the
  // manifest is JSON and can't import. They are worded for their own medium
  // (the install dialog truncates), so this pins the CLAIMS rather than the
  // prose: a positioning change in one place must not leave the others
  // advertising something else.
  it('describes the app with the same positioning as the SEO copy', () => {
    for (const claim of ['free', 'no account', 'no watermark']) {
      expect(manifest.description.toLowerCase()).toContain(claim)
      expect(defaultDescription.toLowerCase()).toContain(claim)
    }
  })
})
