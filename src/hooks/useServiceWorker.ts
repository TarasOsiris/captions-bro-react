// Mounts the service worker and surfaces the two things it can tell the user:
// a new build is ready, and the network went away.
//
// In DEV it does the opposite — it tears any worker down. `npm run dev`,
// `preview` and `start` all share localhost:3000, so a worker installed by a
// production build would keep serving cached prod assets over the dev server
// and make source edits look like they did nothing.

import { useEffect } from 'react'
import { toast } from 'sonner'
import {
  applyUpdate,
  registerServiceWorker,
  unregisterServiceWorker,
} from '@/lib/pwa/register'
import { useEditorStore } from '@/store/editorStore'

const UPDATE_TOAST_ID = 'sw-update'
const OFFLINE_TOAST_ID = 'sw-offline'

export function useServiceWorker() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      unregisterServiceWorker()
      return
    }

    const showUpdateToast = () => {
      toast('A new version of Captions Bro is ready.', {
        id: UPDATE_TOAST_ID,
        description: 'Reload to pick it up.',
        duration: Infinity,
        action: { label: 'Reload', onClick: applyUpdate },
      })
    }

    // Never offer a reload mid-export: the encode lives entirely in this page,
    // so reloading throws away however many minutes of work. Hold the update
    // (the worker stays `waiting` regardless) until the export screen is done.
    let unsubscribe: (() => void) | undefined
    const onUpdate = () => {
      if (useEditorStore.getState().exportPhase === 'idle') {
        showUpdateToast()
        return
      }
      unsubscribe?.()
      unsubscribe = useEditorStore.subscribe((state) => {
        if (state.exportPhase !== 'idle') return
        unsubscribe?.()
        unsubscribe = undefined
        showUpdateToast()
      })
    }

    const disposeSw = registerServiceWorker(onUpdate)

    // The editor is fully client-side, so offline is a non-event — but only if
    // we say so. Silence reads as breakage.
    const onOffline = () => {
      toast('You’re offline.', {
        id: OFFLINE_TOAST_ID,
        description:
          'The editor and export keep working — nothing is uploaded.',
        duration: 6000,
      })
    }
    const onOnline = () => {
      toast.dismiss(OFFLINE_TOAST_ID)
    }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)

    return () => {
      disposeSw()
      unsubscribe?.()
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [])
}
