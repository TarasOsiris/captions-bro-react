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
import { usePreviewFullscreenSync } from '@/hooks/usePreviewFullscreen'
import { useClipCommands } from '@/hooks/useClipCommands'
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
  const previewFullscreen = useEditorStore((s) => s.previewFullscreen)

  const hasClips = projectDuration(project) > 0
  const exporting = exportPhase === 'exporting'

  // Orchestration lives in hooks; the store is the single source of truth.
  // Undo lives in the store's history slice — mutation sites call
  // beginEdit/beginEditSession through getState(), no prop-drilling.
  const { togglePlay, seek } = usePlayback(poolRef)
  const { importFile } = useMediaImport()
  const { insertAssetAtTime } = useClipInsert()
  const {
    startExport,
    cancelExport,
    closeExport,
    getResultBlob,
    getExportSurface,
  } = useExport()
  // ONE ClipCommands instance for the whole editor; the Timeline holds its own
  // (the callbacks are stable and stateless, so a second instance is free).
  const clipCommands = useClipCommands()
  useEditorKeyboard({
    togglePlay,
    seek,
    commands: clipCommands,
    enabled: exportPhase === 'idle',
  })
  const { hydrated } = usePersistence()
  // Keeps every face the document uses loaded — including after a reload or an
  // undo, which have no UI action behind them.
  useFontLoader()
  // Offline shell + the "new version ready" prompt (production only).
  useServiceWorker()
  // Keeps the fullscreen flag, the browser's own fullscreen and the wake lock
  // in agreement; the toggle itself is a plain function the button and the
  // keyboard import directly.
  usePreviewFullscreenSync()

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

  const handleImport = importFile

  // "Open with → Captions Bro" and the OS share sheet land here, on the same
  // importer as the picker and the drop target. `ready` is the guard the UI
  // gives every other import path for free: not before the saved project has
  // hydrated (`replaceProject` would erase the import), and not while the
  // export screen owns the session (a document mutation at phase 'done'
  // clears the finished export via the store's touchDocument seam).
  useLaunchFiles(handleImport, { ready: hydrated && exportPhase === 'idle' })

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
      insertAssetAtTime(assetId, useEditorStore.getState().currentTime)
    },
    [insertAssetAtTime],
  )

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-ink">
      {/* Semantic markup for search crawlers & screen readers */}
      <h1 className="sr-only">
        Free Browser Video Editor — No Account, No Registration, No Watermark
      </h1>
      <section className="sr-only" aria-label="About Captions Bro">
        <h2>Free Online Browser Video Editor</h2>
        <p>
          Captions Bro is a 100% free browser-based video editor requiring no
          account, no registration, and no sign-up. Trim video clips, add custom
          text overlay captions, and export clean H.264 MP4 videos with no
          watermark. All video processing happens client-side inside your
          browser for total privacy.
        </p>
      </section>

      <TopBar
        projectName={hasClips ? project.name : null}
        canExport={hasClips && !exporting}
        supported={supported}
        unsupportedReason={unsupportedReason}
        onExport={startExport}
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
        />
        <PreviewStage
          poolRef={poolRef}
          dropDisabled={exporting}
          // Gated at RENDER time, not by an effect: effects run after paint, so
          // starting an export would show one frame of the `z-[60]` stage over
          // ExportScreen's `z-50` — the screen that owns the finished MP4 on
          // iOS. `usePreviewFullscreenSync` then drops the flag for real.
          fullscreen={previewFullscreen && exportPhase === 'idle'}
          onDropFile={handleImport}
          onPickFile={pickFile}
          onTogglePlay={togglePlay}
          onSeek={seek}
        />
        <InspectorPanel />
      </div>

      <Timeline onTogglePlay={togglePlay} onSeek={seek} />

      {/* Bottom rail + media sheet; renders nothing at lg+. */}
      <MobileDock
        onPickFile={pickFile}
        onSeek={seek}
        onAddToTimeline={handleAddToTimeline}
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
          getExportSurface={getExportSurface}
        />
      )}
    </div>
  )
}
