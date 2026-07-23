import { useState } from 'react'
import { Captions, Film, Music, Plus, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useEditorStore } from '@/store/editorStore'
import { assetOf } from '@/lib/model/selectors'
import { cn } from '@/lib/utils'
import { formatBytes, formatDuration } from '@/lib/media'
import { MEDIA_ASSET_MIME } from '@/lib/dnd'

interface MediaPanelProps {
  disabled: boolean
  onPickFile: () => void
}

function RailItem({
  icon,
  label,
  active = false,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
}) {
  const button = (
    <Button
      variant="ghost"
      aria-disabled={!active}
      onClick={
        active
          ? undefined
          : (e) => {
              e.preventDefault()
            }
      }
      className={cn(
        'h-auto w-12 flex-col gap-1 rounded-lg px-0 py-2 text-[10px] font-medium',
        active
          ? 'bg-raised text-ink hover:bg-raised hover:text-ink'
          : 'cursor-default text-muted/50 hover:bg-transparent hover:text-muted/50',
      )}
    >
      {icon}
      {label}
    </Button>
  )

  if (active) return button

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label} — coming soon</TooltipContent>
    </Tooltip>
  )
}

export function MediaPanel({ disabled, onPickFile }: MediaPanelProps) {
  const project = useEditorStore((s) => s.project)
  const selectedClipId = useEditorStore((s) => s.selectedClipId)
  const selectClip = useEditorStore((s) => s.selectClip)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const clips = project.tracks.flatMap((t) => t.clips)

  return (
    <aside className="flex shrink-0 border-r border-edge bg-surface">
      <nav className="flex w-16 flex-col items-center gap-1 border-r border-edge/60 py-3">
        <RailItem active icon={<Film className="h-5 w-5" />} label="Media" />
        <RailItem icon={<Type className="h-5 w-5" />} label="Text" />
        <RailItem icon={<Music className="h-5 w-5" />} label="Audio" />
        <RailItem icon={<Captions className="h-5 w-5" />} label="Captions" />
      </nav>

      <div className="flex w-72 flex-col">
        <div className="flex h-10 shrink-0 items-center justify-between px-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Media
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={onPickFile}
                disabled={disabled}
                aria-label="Import media"
                className="h-6 w-6"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Import media</TooltipContent>
          </Tooltip>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 pt-1">
          {clips.length > 0 ? (
            clips.map((clip) => {
              const asset = assetOf(project, clip)
              const thumb =
                asset && asset.thumbs.length > 0 ? asset.thumbs[0] : null
              const canDrag = clip.assetId != null
              return (
                <button
                  key={clip.id}
                  type="button"
                  draggable={canDrag}
                  onDragStart={(e) => {
                    if (clip.assetId == null) return
                    // Payload is the asset id — drop creates a new clip from it.
                    e.dataTransfer.setData(MEDIA_ASSET_MIME, clip.assetId)
                    e.dataTransfer.setData('text/plain', asset?.name ?? '')
                    e.dataTransfer.effectAllowed = 'copy'
                    setDraggingId(clip.id)
                  }}
                  onDragEnd={() => {
                    setDraggingId(null)
                  }}
                  onClick={() => {
                    selectClip(clip.id)
                  }}
                  className={cn(
                    'block w-full text-left',
                    canDrag && 'cursor-grab active:cursor-grabbing',
                    clip.id === selectedClipId ? 'opacity-100' : 'opacity-90',
                    draggingId === clip.id && 'opacity-40',
                  )}
                >
                  <div
                    className={cn(
                      'relative aspect-video overflow-hidden rounded-md border bg-black',
                      clip.id === selectedClipId
                        ? 'border-select ring-1 ring-select/70'
                        : 'border-edge ring-1 ring-transparent',
                    )}
                  >
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted/60">
                        <Film className="h-6 w-6" />
                      </div>
                    )}
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[10px] tabular-nums text-white/90">
                      {formatDuration(clip.duration)}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <p className="truncate text-xs text-ink">
                      {asset?.name ?? clip.type}
                    </p>
                    {asset && (
                      <p className="font-mono text-[10px] text-muted">
                        {formatBytes(asset.sizeBytes)}
                      </p>
                    )}
                  </div>
                </button>
              )
            })
          ) : (
            <Button
              variant="outline"
              onClick={onPickFile}
              disabled={disabled}
              className="flex aspect-video h-auto w-full flex-col gap-2 rounded-md border-dashed text-[11px]"
            >
              <Plus className="h-4 w-4" />
              <span>Import media</span>
            </Button>
          )}
        </div>
      </div>
    </aside>
  )
}
