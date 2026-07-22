// Export lifecycle: capability probe, start/cancel, progress → store, download +
// toasts. The live ExportHandle and the result object-URL are owned here (refs),
// not the store.

import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useEditorStore } from '@/store/editorStore'
import { ExportCancelledError, canExportH264, exportProject } from '@/lib/export'
import { formatBytes } from '@/lib/media'
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
        useEditorStore
          .getState()
          .completeExport(url, result.suggestedFileName)
        triggerDownload(url, result.suggestedFileName)
        toast.success('Export complete — download started', {
          description: `${result.suggestedFileName} · ${formatBytes(result.blob.size)}`,
          action: {
            label: 'Download again',
            onClick: () => {
              triggerDownload(url, result.suggestedFileName)
            },
          },
          duration: 8000,
        })
        if (result.silent) {
          toast.warning(
            "Audio couldn't be encoded in this browser, so the export is silent — try Chrome or Safari.",
          )
        } else if (result.discardedTracks.length) {
          toast.warning(
            "Audio was dropped — this browser can't encode its codec, so the exported video is silent.",
          )
        }
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
    handle.cancel().catch(() => {})
    useEditorStore.getState().resetExport()
  }, [])

  return { startExport, cancelExport }
}
