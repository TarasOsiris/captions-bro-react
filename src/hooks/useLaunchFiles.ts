// The two ways an installed Captions Bro receives media from the OS rather than
// from its own file picker:
//
//  - FILE HANDLING — the manifest's `file_handlers` registers the app for video
//    and image types, so "Open with → Captions Bro" (desktop) delivers handles
//    through `window.launchQueue`.
//  - SHARE TARGET — the manifest's `share_target` puts the app in the Android /
//    ChromeOS share sheet; `public/sw.js` catches the POST and parks the files
//    for `peekSharedFiles` to read (see lib/pwa/shareTarget.ts).
//
// Both funnel into the SAME `onFile` the picker and the drop target use, so an
// OS-delivered file is imported by exactly the code path a dragged one is.
//
// THIS ENTRY POINT IS UNGUARDED BY CONSTRUCTION, WHICH IS THE WHOLE PROBLEM.
// Every in-app import path inherits its safety from the UI: `ExportScreen`
// covers the editor whenever `exportPhase !== 'idle'`, the panels disable
// themselves, and the keyboard hook is passed `enabled`. The OS calls in from
// outside all of that — and `launch_handler: focus-existing` guarantees it
// lands in a RUNNING session, not a fresh load. So the two guards the UI would
// have given us for free are enforced here instead, via `ready`:
//
//  1. NOT BEFORE HYDRATION. `usePersistence` restores the saved project
//     asynchronously and installs it with `replaceProject`, which replaces the
//     document WHOLESALE. An import that lands first is silently erased.
//  2. NOT DURING AN EXPORT. Importing mutates the document, and a document
//     mutation at phase 'done' clears the finished export (the store's
//     touchDocument seam) — tearing down `ExportScreen` and stranding the
//     finished MP4, which on iOS is only reachable from that screen.
//     Mid-encode, an import would edit the project out from under the encode.
//
// Files that arrive early are held and flushed when `ready` goes true, so
// nothing is dropped — the user gets their clip, just at a safe moment.

import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import {
  clearShareFlag,
  discardSharedFiles,
  peekSharedFiles,
} from '@/lib/pwa/shareTarget'
import { SHARE_FLAG } from '@/lib/pwa/constants'

/** `window.launchQueue`, absent from lib.dom. */
interface LaunchParams {
  /** The URL the launch targeted — for a share, it carries the share flag.
   *  Present even when the client is focused rather than navigated. */
  targetURL?: string
  files?: ReadonlyArray<FileSystemFileHandle>
}
interface LaunchQueue {
  setConsumer: (consumer: (params: LaunchParams) => void) => void
}

export function useLaunchFiles(
  onFile: (file: File) => void,
  { ready }: { ready: boolean },
) {
  // The consumer is registered once and lives for the tab's lifetime, so it
  // must read the CURRENT importer and readiness, not the mount-time ones.
  const onFileRef = useRef(onFile)
  onFileRef.current = onFile
  const readyRef = useRef(ready)
  readyRef.current = ready

  const pendingRef = useRef<File[]>([])
  const pendingFromShareRef = useRef(false)
  const drainingRef = useRef(false)

  /** Import now, or hold until it's safe to. */
  const accept = useCallback((file: File) => {
    if (readyRef.current) {
      onFileRef.current(file)
      return
    }
    pendingRef.current.push(file)
  }, [])

  // Flush whatever arrived early, the moment the gate opens.
  useEffect(() => {
    if (!ready || pendingRef.current.length === 0) return
    const files = pendingRef.current
    const fromShare = pendingFromShareRef.current
    pendingRef.current = []
    pendingFromShareRef.current = false
    for (const file of files) onFileRef.current(file)
    if (fromShare) void discardSharedFiles()
  }, [ready])

  /**
   * Claim anything sitting in the share inbox.
   *
   * Driven by the INBOX, not by `?share-target=1`: with
   * `launch_handler: focus-existing`, sharing into an already-open app focuses
   * the window without navigating, so no flag ever appears in the URL. Checking
   * only the flag meant those shares were parked and never read.
   */
  const drainShareInbox = useCallback(async () => {
    if (drainingRef.current) return
    drainingRef.current = true
    try {
      const files = await peekSharedFiles()
      clearShareFlag()
      if (files.length === 0) {
        // Nothing claimable — expired entries still need collecting.
        await discardSharedFiles()
        return
      }
      for (const file of files) accept(file)
      // Only now is it safe to empty the inbox. If the import was deferred, the
      // flush owns the delete instead — losing the files here would be
      // unrecoverable, since the OS has no copy to re-share.
      if (readyRef.current) await discardSharedFiles()
      else pendingFromShareRef.current = true
    } catch {
      toast.error("Couldn't open the shared file.", {
        description: 'Try sharing it again, or import it from the media panel.',
      })
    } finally {
      drainingRef.current = false
    }
  }, [accept])

  useEffect(() => {
    void drainShareInbox()

    const queue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue
    if (queue) {
      queue.setConsumer((params) => {
        // A share that focused this client instead of navigating.
        if (params.targetURL) {
          const target = new URL(params.targetURL, window.location.href)
          if (target.searchParams.has(SHARE_FLAG)) void drainShareInbox()
        }
        for (const handle of params.files ?? []) {
          handle.getFile().then(accept, () => {
            // Moved, deleted, or the file-system permission no longer covers
            // it. Every other import path reports its failures; so does this.
            toast.error("Couldn't open that file.", {
              description: 'It may have been moved or renamed.',
            })
          })
        }
      })
    }

    // Belt and braces for the focus-existing share on browsers that deliver no
    // launch params: whatever is in the inbox when we come back to the front is
    // ours to claim.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void drainShareInbox()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [accept, drainShareInbox])
}
