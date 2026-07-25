// Export lifecycle status (session state, not undone). The live ExportHandle and
// object-URL lifecycle are owned by the useExport hook, not the store — only
// serializable status lives here.

import type { ImmerSlice } from './editorStore'

export type ExportPhase = 'idle' | 'exporting' | 'done'

export interface ExportSlice {
  /** H.264 encode capability (null until probed). */
  supported: boolean | null
  /** Why export is unavailable — user-facing, platform-aware (see
   *  exportCapability in lib/export.ts). Null when supported or unprobed. */
  unsupportedReason: string | null
  exportPhase: ExportPhase
  exportProgress: number
  downloadUrl: string | null
  downloadName: string | null
  /** The finished file has no audio (browser couldn't encode it). */
  exportSilent: boolean
  setSupported: (v: boolean | null, reason?: string | null) => void
  beginExport: () => void
  setExportProgress: (p: number) => void
  completeExport: (url: string, name: string, silent: boolean) => void
  /** Back to idle (cancel / fail / dismiss); also clears the finished result. */
  resetExport: () => void
}

export const createExportSlice: ImmerSlice<ExportSlice> = (set) => ({
  supported: null,
  unsupportedReason: null,
  exportPhase: 'idle',
  exportProgress: 0,
  downloadUrl: null,
  downloadName: null,
  exportSilent: false,

  setSupported: (v, reason = null) =>
    set((s) => {
      s.supported = v
      s.unsupportedReason = reason
    }),

  beginExport: () =>
    set((s) => {
      s.exportPhase = 'exporting'
      s.exportProgress = 0
    }),

  setExportProgress: (p) =>
    set((s) => {
      s.exportProgress = p
    }),

  completeExport: (url, name, silent) =>
    set((s) => {
      s.exportPhase = 'done'
      s.exportProgress = 1
      s.downloadUrl = url
      s.downloadName = name
      s.exportSilent = silent
    }),

  resetExport: () =>
    set((s) => {
      s.exportPhase = 'idle'
      s.exportProgress = 0
      s.downloadUrl = null
      s.downloadName = null
      s.exportSilent = false
    }),
})
