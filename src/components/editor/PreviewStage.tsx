import { useRef, useState } from 'react'
import { IconExport } from './icons'

interface PreviewStageProps {
  url: string | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  dropDisabled: boolean
  onLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => void
  onPlayingChange: (playing: boolean) => void
  onTogglePlay: () => void
  onDropFile: (file: File) => void
  onPickFile: () => void
}

export function PreviewStage({
  url,
  videoRef,
  dropDisabled,
  onLoadedMetadata,
  onPlayingChange,
  onTogglePlay,
  onDropFile,
  onPickFile,
}: PreviewStageProps) {
  const [dragOver, setDragOver] = useState(false)
  // dragenter/dragleave fire for every child crossed; a depth counter keeps the
  // highlight stable until the pointer truly leaves the stage.
  const dragDepth = useRef(0)

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    if (dropDisabled) return
    dragDepth.current += 1
    setDragOver(true)
  }
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragOver(false)
    if (dropDisabled) return
    const files = e.dataTransfer.files
    if (files.length > 0) onDropFile(files[0])
  }

  return (
    <section
      onDragEnter={onDragEnter}
      onDragOver={(e) => {
        e.preventDefault()
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-stage bg-[radial-gradient(70rem_45rem_at_50%_-15%,rgba(79,140,255,0.06),transparent)] p-6"
    >
      {url ? (
        <video
          key={url}
          ref={videoRef}
          src={url}
          playsInline
          onLoadedMetadata={onLoadedMetadata}
          onPlay={() => {
            onPlayingChange(true)
          }}
          onPause={() => {
            onPlayingChange(false)
          }}
          onEnded={() => {
            onPlayingChange(false)
          }}
          onClick={onTogglePlay}
          className="max-h-full max-w-full cursor-pointer rounded-[4px] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_40px_120px_-30px_rgba(0,0,0,0.9)]"
        />
      ) : (
        <div
          className={`flex flex-col items-center gap-4 rounded-xl border-2 border-dashed px-14 py-16 text-center transition-colors ${
            dragOver ? 'border-accent bg-accent/5' : 'border-edge'
          }`}
        >
          <IconExport className="h-9 w-9 text-muted" />
          <div>
            <p className="text-sm text-ink">Drop a video anywhere</p>
            <p className="mt-1 text-xs text-muted">MP4, MOV, WebM or MKV</p>
          </div>
          <button
            type="button"
            onClick={onPickFile}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:brightness-110"
          >
            Import media
          </button>
        </div>
      )}

      {url != null && dragOver && (
        <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent/10">
          <span className="rounded-md bg-bg/85 px-3 py-1.5 text-sm text-ink">
            Drop to replace clip
          </span>
        </div>
      )}
    </section>
  )
}
