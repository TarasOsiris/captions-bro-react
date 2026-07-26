// Install-to-home-screen plumbing.
//
// Two mutually exclusive worlds:
//
//  - Chromium fires `beforeinstallprompt`, which we capture (preventing the
//    browser's own mini-infobar) and replay from our own button.
//  - WebKit fires nothing and exposes no API. On iOS the ONLY install path is
//    Share → "Add to Home Screen", so all we can do is say so — which is why
//    `isAppleWebKit` is consulted here. Same rule as the export gate: platform
//    detection picks the COPY, never the capability (see CLAUDE.md).

import { isAppleWebKit } from '@/lib/platform'

/** The Chromium-only event. Not in lib.dom, so it is spelled out here. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** True when the app is already running as an installed app — in which case
 *  there is nothing to offer. Covers Chromium/Android (`display-mode`) and
 *  iOS Safari's legacy `navigator.standalone`. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    legacy === true
  )
}

/** iOS/iPadOS, where installing is a manual Share-sheet step we can only
 *  describe. Never true where `beforeinstallprompt` exists. */
export function needsIosInstallHint(): boolean {
  if (typeof window === 'undefined') return false
  return (
    isAppleWebKit() &&
    !isStandalone() &&
    !('onbeforeinstallprompt' in window) &&
    // A home-screen app on iOS reports standalone; a Chrome/Firefox-for-iOS tab
    // can't install at all, so only offer the hint in Safari itself.
    /Safari/.test(navigator.userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent)
  )
}
