// Export lifecycle: capability probe, start/cancel, progress → store. The finished
// file is surfaced by the full-screen ExportScreen (which reads downloadUrl from the
// store); this hook owns the live ExportHandle and the result object-URL (refs).

import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useEditorStore } from '@/store/editorStore'
import {
  ExportCancelledError,
  exportCapability,
  exportProject,
} from '@/lib/export'
import { projectDuration } from '@/lib/model/selectors'
import { isAppleWebKit } from '@/lib/platform'
import type { ExportHandle } from '@/lib/export'

function errorMessage(err: unknown): string | null {
  if (err instanceof ExportCancelledError) return null
  if (err instanceof Error && err.message) return err.message
  return 'Something went wrong during export.'
}

function triggerDownload(url: string, fileName: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function useExport() {
  const handleRef = useRef<ExportHandle | null>(null)
  const downloadUrlRef = useRef<string | null>(null)
  // The result Blob, kept out of the store so export state stays serializable
  // for persistence. ExportScreen reads it via getResultBlob rather than
  // re-fetching the object URL, which would hold a SECOND full copy of the MP4
  // in RAM at the exact moment a phone is closest to being killed.
  const resultBlobRef = useRef<Blob | null>(null)
  // The canvas the running export composites each frame onto — ExportScreen
  // mirrors it so the user watches the render instead of a black rectangle.
  // A ref, like the blob above: it is a live DOM object, so it has no business
  // in a store that is meant to stay serializable.
  const surfaceRef = useRef<HTMLCanvasElement | null>(null)
  /** Identifies the current run, so a surface arriving late can be told apart
   *  from the one belonging to the export now on screen. */
  const runIdRef = useRef(0)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  // Client-only capability probe (touches WebCodecs, never during SSR).
  useEffect(() => {
    let alive = true
    exportCapability().then(
      (cap) => {
        if (!alive) return
        useEditorStore
          .getState()
          .setSupported(cap.ok, cap.ok ? null : cap.reason)
        // The badge explains it in the TopBar, but on a phone the user is
        // looking at the disabled button, not the header. Say it once, here.
        if (!cap.ok) toast.warning(cap.reason, { duration: 10000 })
      },
      () => {
        if (alive) useEditorStore.getState().setSupported(false)
      },
    )
    return () => {
      alive = false
    }
  }, [])

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null
  }, [])

  // Release the last download URL at unmount.
  useEffect(
    () => () => {
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current)
    },
    [],
  )

  const startExport = useCallback(() => {
    const st = useEditorStore.getState()
    if (st.exportPhase === 'exporting') return
    if (projectDuration(st.project) <= 0) return

    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current)
      downloadUrlRef.current = null
    }

    const onProgress = (fraction: number) =>
      useEditorStore.getState().setExportProgress(fraction)

    // Bumping the id here is what makes the guard below sufficient: an export
    // that was cancelled during its dynamic import still resolves a surface,
    // and it must not land in the screen showing the NEXT export.
    const runId = ++runIdRef.current
    surfaceRef.current = null

    const handle = exportProject(st.project, {
      onProgress,
      onSurface: (el) => {
        if (runIdRef.current === runId) surfaceRef.current = el
      },
    })
    handleRef.current = handle
    st.beginExport()

    // The UI already says "keep this tab open"; this gives that a mechanism.
    // Backgrounding mid-export on iOS can get the tab discarded outright.
    // `in` rather than `?.` — lib.dom types wakeLock as always present, but it
    // is genuinely absent in Firefox and pre-16.4 Safari.
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(
        (lock) => {
          if (handleRef.current === handle) wakeLockRef.current = lock
          else lock.release().catch(() => {})
        },
        () => {},
      )
    }

    handle.done.then(
      (result) => {
        releaseWakeLock()
        if (handleRef.current !== handle) return
        // Done: the screen swaps the mirror for the result <video>, so let the
        // full-size compositing canvas go rather than pin it for the life of
        // the finished-export screen.
        surfaceRef.current = null
        const url = URL.createObjectURL(result.blob)
        downloadUrlRef.current = url
        resultBlobRef.current = result.blob
        // `silent` is computed by every export path now (it used to be set by
        // the timeline path alone, so this had to guess from discardedTracks).
        useEditorStore
          .getState()
          .completeExport(url, result.suggestedFileName, result.silent)
        // Safety net: save the render immediately so a long export is never lost
        // if the user dismisses the screen without pressing Download.
        //
        // NOT on iOS. This click comes from a promise continuation, so it has no
        // user activation; Safari either ignores it or NAVIGATES THE TAB to the
        // blob — tearing down the editor mid-session and revoking every asset
        // URL. The net that exists to prevent losing work would cause it. There,
        // ExportScreen's explicit Download / Share buttons are the save path.
        if (!isAppleWebKit()) triggerDownload(url, result.suggestedFileName)
      },
      (err: unknown) => {
        releaseWakeLock()
        if (handleRef.current !== handle) return
        surfaceRef.current = null
        const message = errorMessage(err)
        if (message != null) toast.error(message)
        useEditorStore.getState().resetExport()
      },
    )
  }, [releaseWakeLock])

  const cancelExport = useCallback(() => {
    const handle = handleRef.current
    if (!handle) return
    // Detach first, so a same-tick resolve is dropped by the `!== handle` guard
    // and can't flip the just-cancelled export back to 'done'.
    handleRef.current = null
    surfaceRef.current = null
    releaseWakeLock()
    handle.cancel().catch(() => {})
    useEditorStore.getState().resetExport()
  }, [releaseWakeLock])

  // Dismiss the finished-export screen: release the file URL and go back to idle.
  const closeExport = useCallback(() => {
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current)
      downloadUrlRef.current = null
    }
    resultBlobRef.current = null
    surfaceRef.current = null
    useEditorStore.getState().resetExport()
  }, [])

  /** The finished MP4, for Share — avoids re-materialising it from the URL. */
  const getResultBlob = useCallback(() => resultBlobRef.current, [])

  /** The frame the export is composing right now, for the live preview. Polled
   *  rather than subscribed: it appears mid-export (after mediabunny's dynamic
   *  import) and its CONTENT changes per encoded frame, neither of which is a
   *  React render. */
  const getExportSurface = useCallback(() => surfaceRef.current, [])

  return {
    startExport,
    cancelExport,
    closeExport,
    getResultBlob,
    getExportSurface,
  }
}
