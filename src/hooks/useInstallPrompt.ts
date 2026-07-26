// The install affordance's state. SSR-safe by construction: every field starts
// `false`/`null` and is only filled in from an effect, so the server HTML and
// the first client render agree and nothing here is a hydration mismatch.

import { useCallback, useEffect, useState } from 'react'
import { isStandalone, needsIosInstallHint } from '@/lib/pwa/install'
import type { BeforeInstallPromptEvent } from '@/lib/pwa/install'

export interface InstallPrompt {
  /** Chromium captured a prompt we can replay. */
  canPrompt: boolean
  /** iOS Safari: no API, so show the Share-sheet instructions instead. */
  showIosHint: boolean
  /** Fire the browser's install dialog. Resolves once the user has answered. */
  promptInstall: () => Promise<void>
}

export function useInstallPrompt(): InstallPrompt {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  )
  const [installed, setInstalled] = useState(false)
  const [showIosHint, setShowIosHint] = useState(false)

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true)
      return
    }
    setShowIosHint(needsIosInstallHint())

    const onBeforeInstall = (e: Event) => {
      // Suppress Chrome's own mini-infobar; we own the affordance.
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
      setShowIosHint(false)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    // A prompt is single-use whatever the answer; a dismissal earns a fresh
    // `beforeinstallprompt` on a later visit, which re-arms this.
    setDeferred(null)
  }, [deferred])

  return {
    canPrompt: !installed && deferred !== null,
    showIosHint: !installed && showIosHint,
    promptInstall,
  }
}
