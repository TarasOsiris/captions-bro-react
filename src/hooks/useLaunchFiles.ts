// The two ways an installed Captions Bro receives media from the OS rather than
// from its own file picker:
//
//  - FILE HANDLING — the manifest's `file_handlers` registers the app for video
//    and image types, so "Open with → Captions Bro" (desktop) delivers handles
//    through `window.launchQueue`.
//  - SHARE TARGET — the manifest's `share_target` puts the app in the Android /
//    ChromeOS share sheet; `public/sw.js` catches the POST and parks the files
//    for `takeSharedFiles` to drain (see lib/pwa/shareTarget.ts).
//
// Both funnel into the SAME `onFile` the picker and the drop target use, so an
// OS-delivered file is imported by exactly the code path a dragged one is.
//
// `launch_handler: focus-existing` in the manifest is load-bearing here: the
// default would NAVIGATE the open window, reloading the editor and dropping the
// session the files are meant to join.

import { useEffect, useRef } from 'react'
import {
  clearShareFlag,
  hasSharedFiles,
  takeSharedFiles,
} from '@/lib/pwa/shareTarget'

/** `window.launchQueue`, absent from lib.dom. */
interface LaunchParams {
  files: ReadonlyArray<FileSystemFileHandle>
}
interface LaunchQueue {
  setConsumer: (consumer: (params: LaunchParams) => void) => void
}

export function useLaunchFiles(onFile: (file: File) => void) {
  // The consumer is registered once and lives for the tab's lifetime, so it
  // must read the CURRENT importer rather than close over the mount-time one.
  const onFileRef = useRef(onFile)
  onFileRef.current = onFile

  useEffect(() => {
    let cancelled = false
    const deliver = (file: File) => {
      if (!cancelled) onFileRef.current(file)
    }

    if (hasSharedFiles()) {
      clearShareFlag()
      void takeSharedFiles().then((files) => {
        for (const file of files) deliver(file)
      })
    }

    const queue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue
    if (queue) {
      queue.setConsumer((params) => {
        for (const handle of params.files) {
          handle.getFile().then(deliver, () => {
            // Permission revoked or the file moved — nothing to import.
          })
        }
      })
    }

    return () => {
      cancelled = true
    }
  }, [])
}
