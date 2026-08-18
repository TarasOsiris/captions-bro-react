// The browser Fullscreen API, wrapped so the rest of the app can treat it as a
// best-effort ENHANCEMENT. The editor's own `previewFullscreen` flag is what
// actually lays the preview out (a `fixed` promotion in PreviewStage); this
// module only removes the browser/OS chrome around it where that is possible.
//
// Three rules, all load-bearing:
//
//  - **Detect INSIDE the functions, never at module scope.** The route is
//    server-rendered, so a top-level `'requestFullscreen' in Element.prototype`
//    is a ReferenceError in the Nitro bundle that takes the whole page down.
//    Same shape as the "mediabunny is imported inside functions only" rule.
//
//  - **Always `document.documentElement`, never the preview section.**
//    `requestFullscreen` does not reparent anything — the DOM tree is untouched
//    — but it promotes the element to the TOP LAYER, and everything outside it
//    stops rendering. Radix popovers/tooltips and sonner toasts portal into
//    `<body>`, so fullscreening the section would make all of them invisible.
//    Fullscreening `<html>` puts the entire document in the top layer instead.
//
//  - **Never `HTMLVideoElement.webkitEnterFullscreen` on a pool `<video>`.**
//    It is the tempting fix for iPhone Safari, and it hands the RAW decoded
//    source to the native player: no compositor, no text overlays, no WYSIWYG —
//    the exact opposite of the one-renderer rule in CLAUDE.md. iPhone gets the
//    CSS overlay alone, which is correct and complete.
//
// Every entry point is a no-op where the API is missing or refuses; callers
// never branch on support, and no UI is ever gated on it (platform detection
// picks the copy, never the capability).

// Structural shapes, NOT `Document & {…}` intersections: lib.dom declares
// `requestFullscreen`/`exitFullscreen` as always present, so an intersection
// makes every feature test look statically dead (`no-unnecessary-condition`
// flags it) while the methods are genuinely missing on iPhone Safari. The
// standard names are optional here for exactly that reason; the `webkit*` ones
// are the Safari < 16.4 spellings, absent from lib.dom entirely.
interface FsDocument {
  fullscreenElement?: Element | null
  exitFullscreen?: () => Promise<void>
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => void
}
interface FsElement {
  requestFullscreen?: () => Promise<void>
  webkitRequestFullscreen?: () => void
}

function fsDocument(): FsDocument {
  return document
}

/** The element the browser currently has in fullscreen, or null — including
 *  when the API doesn't exist at all. */
export function nativeFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null
  const doc = fsDocument()
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null
}

/**
 * Ask for real fullscreen on the document.
 *
 * MUST be called synchronously inside the gesture's own task: fullscreen needs
 * transient activation, the same constraint `primeAndPlay` has for `play()`.
 * Awaiting anything first (or scheduling it from an effect) can lose it.
 *
 * Failure is expected and silent — no API (iPhone), a refusing embedder, or a
 * user-agent policy. The CSS overlay has already covered the viewport.
 */
export function enterNativeFullscreen(): void {
  if (typeof document === 'undefined') return
  if (nativeFullscreenElement()) return
  const el = document.documentElement as unknown as FsElement
  try {
    if (el.requestFullscreen) void el.requestFullscreen().catch(() => {})
    else el.webkitRequestFullscreen?.()
  } catch {
    // ignore — see above
  }
}

/** Leave native fullscreen if we are in it. Safe to call unconditionally. */
export function exitNativeFullscreen(): void {
  if (typeof document === 'undefined') return
  if (!nativeFullscreenElement()) return
  const doc = fsDocument()
  try {
    if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {})
    else doc.webkitExitFullscreen?.()
  } catch {
    // ignore
  }
}

/** Subscribe to fullscreen enter/exit, both event spellings. Returns an
 *  unsubscribe. Used to notice a BROWSER-initiated exit (Esc, F11, the OS). */
export function onFullscreenChange(cb: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  document.addEventListener('fullscreenchange', cb)
  document.addEventListener('webkitfullscreenchange', cb)
  return () => {
    document.removeEventListener('fullscreenchange', cb)
    document.removeEventListener('webkitfullscreenchange', cb)
  }
}
