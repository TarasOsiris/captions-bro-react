import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MediaKind } from '@/lib/media'

interface PreviewStageProps {
  media: { url: string; kind: MediaKind } | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  dropDisabled: boolean
  onLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => void
  onPlayingChange: (playing: boolean) => void
  onTogglePlay: () => void
  onDropFile: (file: File) => void
  onPickFile: () => void
}

export function PreviewStage({
  media,
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
      className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-stage bg-[radial-gradient(70rem_45rem_at_50%_-15%,rgba(168,137,255,0.05),transparent)] p-5"
    >
      {/* The project frame: always a 16:9 black canvas, sized to fill the stage. */}
      <div className="relative aspect-video h-full max-h-full w-auto max-w-full overflow-hidden rounded-[3px] bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_40px_120px_-30px_rgba(0,0,0,0.9)]">
        {media?.kind === 'video' && (
          <video
            key={media.url}
            ref={videoRef}
            src={media.url}
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
            className="h-full w-full cursor-pointer object-contain"
          />
        )}

        {media?.kind === 'image' && (
          <img
            key={media.url}
            src={media.url}
            alt=""
            draggable={false}
            onClick={onTogglePlay}
            className="h-full w-full cursor-pointer object-contain"
          />
        )}

        {media == null && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
            <Upload className="h-7 w-7 text-muted/40" />
            <div>
              <p className="text-sm text-muted/70">Drop a video or image</p>
              <Button onClick={onPickFile} className="mt-2">
                Import media
              </Button>
            </div>
          </div>
        )}
      </div>

      {dragOver && (
        <div className="pointer-events-none absolute inset-4 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent/10">
          <span className="rounded-md bg-bg/85 px-3 py-1.5 text-sm text-ink">
            {media == null ? 'Drop to import' : 'Drop to replace'}
          </span>
        </div>
      )}
    </section>
  )
}
