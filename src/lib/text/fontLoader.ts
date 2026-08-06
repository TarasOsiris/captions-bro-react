// On-demand Google Fonts loading. Client-only: every entry point guards
// `typeof document` and nothing here runs at module scope (SSR rule, CLAUDE.md).
//
// This is the first runtime third-party fetch besides GA4 — a deliberate
// exception to "no backend". It degrades cleanly: a blocked, offline or
// CSP-refused load resolves anyway and the family falls back to the system
// stack, so text still renders and export still works.
//
// WHY THIS MATTERS FOR EXPORT: `exportVideo`'s `video.process(sample)` hook is
// SYNCHRONOUS and cannot await. Fonts must therefore be resolved before
// `Conversion.init`, not lazily at draw time — otherwise the first frames encode
// in the fallback face. `ensureProjectFonts` is that gate.

import { hasBold, hasItalic, isKnownFont } from './fonts'
import { bumpFontsVersion, clearMeasureCache } from './measure'
import { clearLayoutCache } from './layout'
import { withTextDefaults } from '@/lib/model/text'
import { allClips } from '@/lib/model/selectors'
import type { Clip, Project } from '@/lib/model/types'

/** How long to wait for a face before exporting in the fallback anyway. */
const EXPORT_FONT_TIMEOUT_MS = 8000

/** family|weight|style → the in-flight or settled load. Never rejects. */
const inFlight = new Map<string, Promise<void>>()
/** Families whose stylesheet <link> is already in the document. */
const linked = new Set<string>()

function cssUrl(family: string): string {
  const name = family.replace(/ /g, '+')
  const bold = hasBold(family)
  const italic = hasItalic(family)
  let axis: string
  if (italic && bold) axis = ':ital,wght@0,400;0,700;1,400;1,700'
  else if (bold) axis = ':wght@400;700'
  else if (italic) axis = ':ital@0;1'
  else axis = ''
  return `https://fonts.googleapis.com/css2?family=${name}${axis}&display=swap`
}

function linkStylesheet(href: string): void {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

/**
 * Make `family` available at the given weight/style. Idempotent and memoized, so
 * a rAF loop may call it freely.
 *
 * `sample` matters: the CSS2 API serves unicode-range-subsetted faces, so
 * `document.fonts.load` must be asked about the actual glyphs in play or it can
 * report ready while the subset carrying them is still missing.
 */
export function ensureFont(
  family: string,
  opts: { bold?: boolean; italic?: boolean } = {},
  sample?: string,
): Promise<void> {
  if (typeof document === 'undefined' || !isKnownFont(family)) {
    return Promise.resolve()
  }
  const weight = opts.bold && hasBold(family) ? 700 : 400
  const style = opts.italic && hasItalic(family) ? 'italic' : 'normal'
  const key = `${family}|${weight}|${style}|${sample ? hash(sample) : ''}`
  const existing = inFlight.get(key)
  if (existing) return existing

  const promise = (async () => {
    try {
      if (!linked.has(family)) {
        linked.add(family)
        linkStylesheet(cssUrl(family))
      }
      const shorthand = `${style === 'italic' ? 'italic ' : ''}${weight} 64px "${family}"`
      await document.fonts.load(shorthand, sample || 'AaGg')
      // Metrics just changed from the fallback's to the real face's — every
      // cached measurement and layout is now stale.
      bumpFontsVersion()
      clearMeasureCache()
      clearLayoutCache()
    } catch {
      // Offline / blocked / CSP — the family falls back to the system stack.
    }
  })()

  inFlight.set(key, promise)
  return promise
}

/** Every distinct face a set of text clips needs, loaded in parallel. */
export function ensureFontsForClips(clips: Clip[]): Promise<void> {
  const jobs: Promise<void>[] = []
  for (const clip of clips) {
    if (clip.type !== 'text') continue
    const style = withTextDefaults(clip.textStyle)
    jobs.push(
      ensureFont(
        style.fontFamily,
        { bold: style.bold, italic: style.italic },
        clip.text || 'AaGg',
      ),
    )
  }
  return Promise.all(jobs).then(() => undefined)
}

/**
 * THE export-readiness gate — await this before any encode begins, on EVERY
 * path (the fast path used to await `ensureFontsForClips` directly and so had
 * no cap at all). Capped, so a hung CDN delays an export by seconds rather
 * than forever; past the cap we export in the fallback face, which is strictly
 * better than not exporting.
 */
export function ensureExportFonts(clips: Clip[]): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve()
  const text = clips.filter((c) => c.type === 'text')
  if (text.length === 0) return Promise.resolve()
  return Promise.race([
    ensureFontsForClips(text),
    new Promise<void>((resolve) => {
      setTimeout(resolve, EXPORT_FONT_TIMEOUT_MS)
    }),
  ])
}

/** `ensureExportFonts` over a whole project's text clips. */
export function ensureProjectFonts(project: Project): Promise<void> {
  return ensureExportFonts(allClips(project))
}

/** All picker preview faces in ONE request, fired when the picker first opens. */
let previewFacesLoaded = false
export async function loadPreviewFaces(families: string[]): Promise<void> {
  if (typeof document === 'undefined' || previewFacesLoaded) return
  previewFacesLoaded = true
  try {
    const params = families
      .map((f) => `family=${f.replace(/ /g, '+')}`)
      .join('&')
    linkStylesheet(`https://fonts.googleapis.com/css2?${params}&display=swap`)
    for (const f of families) linked.add(f)
    await document.fonts.ready
    bumpFontsVersion()
    clearMeasureCache()
    clearLayoutCache()
  } catch {
    // Best-effort: the list still renders in the fallback stack.
  }
}

/** Small stable hash so a long sample string doesn't become the map key. */
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}
