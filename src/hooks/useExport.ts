// Export lifecycle: capability probe, start/cancel, progress → store. The finished
// file is surfaced by the full-screen ExportScreen (which reads downloadUrl from the
// store); this hook owns the live ExportHandle and the result object-URL (refs).

import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useEditorStore } from '@/store/editorStore'
import {
  ExportCancelledError,
  canExportH264,
  exportProject,
} from '@/lib/export'
import { projectDuration } from '@/lib/model/selectors'
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

  // Client-only capability probe (touches WebCodecs, never during SSR).
  useEffect(() => {
    let alive = true
    canExportH264().then(
      (ok) => {
        if (alive) useEditorStore.getState().setSupported(ok)
      },
      () => {
        if (alive) useEditorStore.getState().setSupported(false)
      },
    )
    return () => {
      alive = false
    }
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

    const handle = exportProject(st.project, { onProgress })
    handleRef.current = handle
    st.beginExport()

    handle.done.then(
      (result) => {
        if (handleRef.current !== handle) return
        const url = URL.createObjectURL(result.blob)
        downloadUrlRef.current = url
        // The finished video is silent if audio existed but couldn't be encoded.
        const silent =
          result.silent === true ||
          result.discardedTracks.some((t) => t.type === 'audio')
        useEditorStore
          .getState()
          .completeExport(url, result.suggestedFileName, silent)
        // Safety net: save the render immediately so a long export is never lost
        // if the user dismisses the screen without pressing Download.
        triggerDownload(url, result.suggestedFileName)
      },
      (err: unknown) => {
        if (handleRef.current !== handle) return
        const message = errorMessage(err)
        if (message != null) toast.error(message)
        useEditorStore.getState().resetExport()
      },
    )
  }, [])

  const cancelExport = useCallback(() => {
    const handle = handleRef.current
    if (!handle) return
    // Detach first, so a same-tick resolve is dropped by the `!== handle` guard
    // and can't flip the just-cancelled export back to 'done'.
    handleRef.current = null
    handle.cancel().catch(() => {})
    useEditorStore.getState().resetExport()
  }, [])

  // Dismiss the finished-export screen: release the file URL and go back to idle.
  const closeExport = useCallback(() => {
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current)
      downloadUrlRef.current = null
    }
    useEditorStore.getState().resetExport()
  }, [])

  return { startExport, cancelExport, closeExport }
}
