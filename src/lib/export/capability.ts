// Can this browser encode H.264, and what should we tell the user if not.
//
// mediabunny is imported dynamically here too — this module is reached from the
// route's mount effect, which is server-rendered.

import { isAppleWebKit } from '@/lib/platform'

/**
 * Whether this browser can encode H.264 (AVC) video via WebCodecs. Used to gate
 * the Export button. Never throws — a missing WebCodecs API resolves to `false`.
 */
export async function canExportH264(): Promise<boolean> {
  try {
    const mb = await import('mediabunny')
    return await mb.canEncodeVideo('avc')
  } catch {
    return false
  }
}

export type ExportCapability =
  | { ok: true }
  /** `reason` is user-facing copy explaining what to actually do about it. */
  | { ok: false; reason: string }

/**
 * `canExportH264` plus advice the user can act on. Codec knowledge stays in the
 * export layer rather than leaking into the UI.
 *
 * The capability itself is feature-detected; the platform check only chooses
 * WHICH remediation to suggest. That distinction matters on iOS, where every
 * browser is WebKit — so "try Chrome" is actively wrong there, and the real gate
 * is the OS version (WebCodecs video encode landed in Safari 26 / iOS 26).
 */
export async function exportCapability(): Promise<ExportCapability> {
  if (await canExportH264()) return { ok: true }
  return {
    ok: false,
    reason: isAppleWebKit()
      ? "This iOS version can't encode H.264 in the browser. Update to iOS 26 or later, or use the Captions Bro iOS app."
      : "This browser can't encode H.264 video. Try Chrome, Edge, or Safari 26+.",
  }
}
