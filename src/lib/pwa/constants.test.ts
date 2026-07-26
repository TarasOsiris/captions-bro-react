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
import { THEME_COLOR } from '@/lib/theme'

const publicDir = resolve(import.meta.dirname, '../../../public')
const swSource = readFileSync(resolve(publicDir, 'sw.js'), 'utf8')
const manifest = JSON.parse(
  readFileSync(resolve(publicDir, 'site.webmanifest'), 'utf8'),
) as {
  theme_color: string
  start_url: string
  share_target: { action: string; params: { files: Array<{ name: string }> } }
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
})

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
})
