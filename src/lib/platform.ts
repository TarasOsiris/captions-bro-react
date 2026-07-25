// Platform detection, used ONLY to pick remediation copy and to choose between
// two equally-correct save paths — never to decide whether a feature works.
// Capability itself is always feature-detected (see canExportH264).

/**
 * True on iOS/iPadOS, where every browser — including "Chrome" and "Firefox" —
 * is WebKit under the hood. That makes "try another browser" useless advice
 * there: the OS version is the gate, not the browser.
 *
 * The `Macintosh` + touch-points arm catches iPadOS, which requests desktop
 * sites by default and so reports a Mac user agent.
 */
export function isAppleWebKit(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  )
}
