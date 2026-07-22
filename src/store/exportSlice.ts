// Export lifecycle status (session state, not undone). The live ExportHandle and
// object-URL lifecycle are owned by the useExport hook, not the store — only
// serializable status lives here.

import type { ImmerSlice } from './editorStore'

export type ExportPhase = 'idle' | 'exporting' | 'done'

export interface ExportSlice {
  /** H.264 encode capability (null until probed). */
  supported: boolean | null
  exportPhase: ExportPhase
  exportProgress: number
  downloadUrl: string | null
  downloadName: string | null
  setSupported: (v: boolean | null) => void
  beginExport: () => void
  setExportProgress: (p: number) => void
  completeExport: (url: string, name: string) => void
  /** Back to idle (cancel / fail / dismiss). */
  resetExport: () => void
}

export const createExportSlice: ImmerSlice<ExportSlice> = (set) => ({
  supported: null,
  exportPhase: 'idle',
  exportProgress: 0,
  downloadUrl: null,
  downloadName: null,

  setSupported: (v) =>
    set((s) => {
      s.supported = v
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

  completeExport: (url, name) =>
    set((s) => {
      s.exportPhase = 'done'
      s.exportProgress = 1
      s.downloadUrl = url
      s.downloadName = name
    }),

  resetExport: () =>
    set((s) => {
      s.exportPhase = 'idle'
      s.exportProgress = 0
    }),
})
