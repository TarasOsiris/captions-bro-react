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

    // A waiting worker stays waiting; only this toast's button lets it take
    // over. So the toast can be shown, hidden and shown again freely — the
    // update is not lost, it just isn't being OFFERED.
    let updateReady = false

    const syncUpdateToast = (exportPhase: string) => {
      if (!updateReady) return
      if (exportPhase !== 'idle') {
        // The reload discards an in-progress encode and the in-memory result
        // blob, and sonner floats above ExportScreen — right over its
        // Share/Download row. A persistent "Reload" there is a mis-tap away
        // from destroying the export. Re-offered the moment it closes.
        toast.dismiss(UPDATE_TOAST_ID)
        return
      }
      toast('A new version of Captions Bro is ready.', {
        id: UPDATE_TOAST_ID,
        description: 'Reload to pick it up.',
        duration: Infinity,
        action: { label: 'Reload', onClick: applyUpdate },
      })
    }

    const onUpdate = () => {
      updateReady = true
      syncUpdateToast(useEditorStore.getState().exportPhase)
    }

    // Selector subscription: fires only when exportPhase itself changes.
    const unsubscribe = useEditorStore.subscribe(
      (state) => state.exportPhase,
      syncUpdateToast,
    )

    const disposeSw = registerServiceWorker(onUpdate)

    // The editor is fully client-side, so offline is a non-event — but only if
    // we say so. Silence reads as breakage.
    const showOffline = () => {
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
    window.addEventListener('offline', showOffline)
    window.addEventListener('online', onOnline)

    // `offline` is a TRANSITION. Launching in airplane mode fires nothing, so
    // the one session that most needs the reassurance would never get it.
    //
    // Deferred to a macrotask, not called inline: `<Toaster/>` is a LATER
    // sibling of `{children}` in __root.tsx, so its subscribe-on-mount effect
    // runs after this one, and sonner drops anything published before it. A
    // timeout lands after the whole passive-effect flush, so the toast sticks.
    const bootCheck = setTimeout(() => {
      if (!navigator.onLine) showOffline()
    }, 0)

    return () => {
      clearTimeout(bootCheck)
      disposeSw()
      unsubscribe()
      window.removeEventListener('offline', showOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [])
}
