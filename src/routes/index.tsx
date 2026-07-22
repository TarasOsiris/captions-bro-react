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
import { MediaPanel } from '@/components/editor/MediaPanel'
import { PreviewStage } from '@/components/editor/PreviewStage'
import { Timeline } from '@/components/editor/Timeline'
import { TopBar } from '@/components/editor/TopBar'

export const Route = createFileRoute('/')({
  component: Editor,
})

function Editor() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const poolRef = useRef(createMediaPool())

  // Orchestration lives in hooks; the store is the single source of truth.
  const { saveUndo } = useUndoRedo()
  const { togglePlay, seek } = usePlayback(poolRef)
  const { importFile } = useMediaImport()
  const { startExport, cancelExport } = useExport()
  useEditorKeyboard({ togglePlay, seek, saveUndo })
  usePersistence()

  const project = useEditorStore((s) => s.project)
  const supported = useEditorStore((s) => s.supported)
  const exportPhase = useEditorStore((s) => s.exportPhase)
  const exportProgress = useEditorStore((s) => s.exportProgress)

  const hasClips = projectDuration(project) > 0
  const exporting = exportPhase === 'exporting'

  // Release all source URLs at unmount.
  useEffect(
    () => () => {
      for (const asset of Object.values(useEditorStore.getState().project.assets)) {
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

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleImport(file)
    e.target.value = ''
  }

  const pickFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-ink">
      <TopBar
        projectName={hasClips ? project.name : null}
        canExport={hasClips && !exporting}
        supported={supported}
        exporting={exporting ? { progress: exportProgress } : null}
        onExport={startExport}
        onCancelExport={cancelExport}
      />

      <div className="flex min-h-0 flex-1">
        <MediaPanel disabled={exporting} onPickFile={pickFile} />
        <PreviewStage
          poolRef={poolRef}
          dropDisabled={exporting}
          onEditStart={saveUndo}
          onDropFile={handleImport}
          onPickFile={pickFile}
        />
      </div>

      <Timeline onTogglePlay={togglePlay} onSeek={seek} onEditStart={saveUndo} />

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,image/*"
        className="hidden"
        onChange={onFileInputChange}
      />
    </div>
  )
}
