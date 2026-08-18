// Fullscreen preview: the ONE toggle, plus the effects that keep the store, the
// browser and the screen in agreement.
//
// The store flag (`uiSlice.previewFullscreen`) is the authority — PreviewStage
// promotes its existing `<section>` to a `fixed` viewport-sized box off it,
// IN PLACE, so the canvas, the compositor's captured 2D context and the pool's
// `<video>` elements are never remounted (see CLAUDE.md). Native fullscreen is
// layered on top by `lib/fullscreen.ts` and is allowed to be missing.

import { useEffect, useRef } from 'react'
import { useEditorStore } from '@/store/editorStore'
import {
  enterNativeFullscreen,
  exitNativeFullscreen,
  nativeFullscreenElement,
  onFullscreenChange,
} from '@/lib/fullscreen'

/** Class on <html>, so `styles.css` can move the toast offset off the video.
 *  On the documentElement rather than the shell div because sonner's Toaster is
 *  mounted in `__root.tsx`, outside the route (precedent: `lib/theme.ts`). */
const FULLSCREEN_CLASS = 'preview-fullscreen'

/** Where focus goes when fullscreen ends. Module-level because the toggle is a
 *  plain function (see below), and there is exactly one editor per document.
 *  Without the handoff, focus lands on `<body>` — where `useEditorKeyboard`'s
 *  window listener is live and a stray Backspace deletes the selected clip. */
let returnFocusTo: HTMLElement | null = null

function rememberFocus() {
  const el = document.activeElement
  returnFocusTo = el instanceof HTMLElement && el !== document.body ? el : null
}

function restoreFocus() {
  const el = returnFocusTo
  returnFocusTo = null
  // Only if it is still in the document — the control may have unmounted.
  if (el?.isConnected) el.focus()
}

/**
 * Enter or leave the fullscreen preview.
 *
 * A plain function, not a hook result: nothing here needs the pool, a ref or a
 * render, so the Timeline button and `useEditorKeyboard` can both import it
 * directly and be literally the same code path — no props threaded through
 * `routes/index.tsx`, and nothing to destabilise `ZoomControls`' memo.
 *
 * MUST be called synchronously from the gesture's own handler: the native
 * request needs transient activation (the same constraint `primeAndPlay` has).
 */
export function togglePreviewFullscreen(): void {
  const st = useEditorStore.getState()
  const next = !st.previewFullscreen
  if (next) {
    rememberFocus()
    // The mobile sheet would otherwise sit mounted-but-invisible under the
    // cover, and its scrim would eat the first tap on exit.
    st.setPanel(null)
    enterNativeFullscreen()
  } else {
    exitNativeFullscreen()
  }
  st.setPreviewFullscreen(next)
  if (!next) restoreFocus()
}

/**
 * The three things that have to follow the flag, mounted once by the route.
 *
 * Deliberately NOT a `setPreviewFullscreen(document.fullscreenElement != null)`
 * mirror: that would let an unrelated fullscreen request switch our overlay ON,
 * and would make the iPhone CSS-only path cancellable by a stray event. The
 * listener can only ever turn the flag OFF, and only when we were the ones who
 * went native.
 */
export function usePreviewFullscreenSync(): void {
  const fullscreen = useEditorStore((s) => s.previewFullscreen)
  const exportPhase = useEditorStore((s) => s.exportPhase)
  const wentNativeRef = useRef(false)

  // The <html> class + a wake lock. Fullscreen playback is exactly when the
  // screen must not sleep; same `in navigator` + swallow shape as useExport.
  useEffect(() => {
    if (!fullscreen) return
    document.documentElement.classList.add(FULLSCREEN_CLASS)
    wentNativeRef.current = nativeFullscreenElement() != null

    let lock: WakeLockSentinel | null = null
    let released = false
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(
        (l) => {
          if (released) l.release().catch(() => {})
          else lock = l
        },
        () => {},
      )
    }
    return () => {
      released = true
      lock?.release().catch(() => {})
      document.documentElement.classList.remove(FULLSCREEN_CLASS)
    }
  }, [fullscreen])

  // A browser-initiated exit (Esc, F11, the OS) leaves the flag stale, and the
  // overlay would stay up with the page no longer fullscreen.
  useEffect(
    () =>
      onFullscreenChange(() => {
        if (nativeFullscreenElement() != null) {
          wentNativeRef.current = true
          return
        }
        if (!wentNativeRef.current) return
        wentNativeRef.current = false
        const st = useEditorStore.getState()
        if (!st.previewFullscreen) return
        st.setPreviewFullscreen(false)
        restoreFocus()
      }),
    [],
  )

  // The export screen takes the session over. It is `z-50`; the fullscreen
  // stage is `z-[60]`, so they cannot coexist — `routes/index.tsx` gates the
  // overlay at RENDER time (an effect alone would paint one frame of preview
  // over the screen that owns the finished MP4 on iOS) and this drops the flag
  // and the OS chrome so the Share sheet and the download anchor are reachable.
  useEffect(() => {
    if (exportPhase === 'idle') return
    exitNativeFullscreen()
    const st = useEditorStore.getState()
    if (st.previewFullscreen) st.setPreviewFullscreen(false)
  }, [exportPhase])
}
