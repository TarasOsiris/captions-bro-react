import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { projectDuration } from '@/lib/model/selectors'
import { createMediaPool } from '@/lib/render/mediaPool'
import { useEditorKeyboard } from '@/hooks/useEditorKeyboard'
import { useExport } from '@/hooks/useExport'
import { useMediaImport } from '@/hooks/useMediaImport'
import { usePersistence } from '@/hooks/usePersistence'
import { usePlayback } from '@/hooks/usePlayback'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { useClipInsert } from '@/hooks/useClipInsert'
import { useFontLoader } from '@/hooks/useFontLoader'
import { useLaunchFiles } from '@/hooks/useLaunchFiles'
import { useServiceWorker } from '@/hooks/useServiceWorker'
import { ExportScreen } from '@/components/editor/ExportScreen'
import { InspectorPanel } from '@/components/editor/InspectorPanel'
import { MediaPanel } from '@/components/editor/MediaPanel'
import { MobileDock } from '@/components/editor/MobileDock'
import { PreviewStage } from '@/components/editor/PreviewStage'
import { Timeline } from '@/components/editor/Timeline'
import { TopBar } from '@/components/editor/TopBar'

export const Route = createFileRoute('/')({
  component: Editor,
})

function Editor() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const poolRef = useRef(createMediaPool())

  const project = useEditorStore((s) => s.project)
  const supported = useEditorStore((s) => s.supported)
  const unsupportedReason = useEditorStore((s) => s.unsupportedReason)
  const exportPhase = useEditorStore((s) => s.exportPhase)

  const hasClips = projectDuration(project) > 0
  const exporting = exportPhase === 'exporting'

  // Orchestration lives in hooks; the store is the single source of truth.
  const { saveUndo, undo, redo, canUndo, canRedo } = useUndoRedo()
  const { togglePlay, seek } = usePlayback(poolRef)
  const { importFile } = useMediaImport()
  const { insertAssetAtTime } = useClipInsert()
  const { startExport, cancelExport, closeExport, getResultBlob } = useExport()
  useEditorKeyboard({
    togglePlay,
    seek,
    saveUndo,
    enabled: exportPhase === 'idle',
  })
  usePersistence()
  // Keeps every face the document uses loaded — including after a reload or an
  // undo, which have no UI action behind them.
  useFontLoader()
  // Offline shell + the "new version ready" prompt (production only).
  useServiceWorker()

  // Release all source URLs at unmount.
  useEffect(
    () => () => {
      for (const asset of Object.values(
        useEditorStore.getState().project.assets,
      )) {
        URL.revokeObjectURL(asset.url)
      }
    },
    [],
  )

  // Importing appends a clip — snapshot first so it's undoable.
  const handleImport = useCallback(
    (file: File) => {
      saveUndo()
      importFile(file)
    },
    [saveUndo, importFile],
  )

  // "Open with → Captions Bro" and the OS share sheet land here, on the same
  // importer as the picker and the drop target.
  useLaunchFiles(handleImport)

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleImport(file)
    e.target.value = ''
  }

  const pickFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // The touch counterpart to dragging a bin item onto the timeline: place a
  // copy at the playhead. Same seam as the desktop drop path (useClipInsert).
  const handleAddToTimeline = useCallback(
    (assetId: string) => {
      saveUndo()
      insertAssetAtTime(assetId, useEditorStore.getState().currentTime)
    },
    [saveUndo, insertAssetAtTime],
  )

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-ink">
      <TopBar
        projectName={hasClips ? project.name : null}
        canExport={hasClips && !exporting}
        supported={supported}
        unsupportedReason={unsupportedReason}
        onExport={startExport}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      {/* Must stay a row-direction `flex` with `min-h-0`. PreviewStage sets
          `container-type: size`, which implies `contain: size` — if this row's
          height ever became content-driven the section would collapse to zero
          and the preview would vanish. See CLAUDE.md. */}
      <div className="flex min-h-0 flex-1">
        <MediaPanel
          onPickFile={pickFile}
          onSeek={seek}
          onAddToTimeline={handleAddToTimeline}
          onEditStart={saveUndo}
        />
        <PreviewStage
          poolRef={poolRef}
          dropDisabled={exporting}
          onEditStart={saveUndo}
          onDropFile={handleImport}
          onPickFile={pickFile}
        />
        <InspectorPanel onEditStart={saveUndo} />
      </div>

      <Timeline
        onTogglePlay={togglePlay}
        onSeek={seek}
        onEditStart={saveUndo}
      />

      {/* Bottom rail + media sheet; renders nothing at lg+. */}
      <MobileDock
        onPickFile={pickFile}
        onSeek={seek}
        onAddToTimeline={handleAddToTimeline}
        onEditStart={saveUndo}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,image/*"
        className="hidden"
        onChange={onFileInputChange}
      />

      {exportPhase !== 'idle' && (
        <ExportScreen
          onCancel={cancelExport}
          onClose={closeExport}
          getResultBlob={getResultBlob}
        />
      )}
    </div>
  )
}
