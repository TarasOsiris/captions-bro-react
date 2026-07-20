import {
  IconCaptions,
  IconFilm,
  IconMusic,
  IconPlus,
  IconType,
} from './icons'
import { formatBytes, formatDuration } from '@/lib/media'

export interface MediaClipCard {
  name: string
  sizeBytes: number
  durationSec: number | null
  thumb: string | null
}

interface MediaPanelProps {
  clip: MediaClipCard | null
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
  return (
    <button
      type="button"
      disabled={!active}
      title={active ? label : `${label} — coming soon`}
      className={`flex w-12 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium ${
        active ? 'bg-raised text-ink' : 'cursor-default text-muted/50'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

export function MediaPanel({ clip, disabled, onPickFile }: MediaPanelProps) {
  return (
    <aside className="flex shrink-0 border-r border-edge bg-surface">
      <nav className="flex w-16 flex-col items-center gap-1 border-r border-edge/60 py-3">
        <RailItem active icon={<IconFilm className="h-5 w-5" />} label="Media" />
        <RailItem icon={<IconType className="h-5 w-5" />} label="Text" />
        <RailItem icon={<IconMusic className="h-5 w-5" />} label="Audio" />
        <RailItem
          icon={<IconCaptions className="h-5 w-5" />}
          label="Captions"
        />
      </nav>

      <div className="flex w-72 flex-col">
        <div className="flex h-10 shrink-0 items-center justify-between px-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Media
          </span>
          <button
            type="button"
            onClick={onPickFile}
            disabled={disabled}
            title="Import media"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-edge text-muted transition hover:border-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconPlus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 pt-1">
          {clip ? (
            <figure>
              <div className="relative aspect-video overflow-hidden rounded-md border border-edge bg-black ring-1 ring-accent/50">
                {clip.thumb ? (
                  <img
                    src={clip.thumb}
                    alt=""
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted/60">
                    <IconFilm className="h-6 w-6" />
                  </div>
                )}
                <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[10px] tabular-nums text-white/90">
                  {formatDuration(clip.durationSec)}
                </span>
              </div>
              <figcaption className="mt-1.5">
                <p className="truncate text-xs text-ink">{clip.name}</p>
                <p className="font-mono text-[10px] text-muted">
                  {formatBytes(clip.sizeBytes)}
                </p>
              </figcaption>
            </figure>
          ) : (
            <button
              type="button"
              onClick={onPickFile}
              disabled={disabled}
              className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-edge text-muted transition hover:border-muted hover:text-ink disabled:cursor-not-allowed"
            >
              <IconPlus className="h-4 w-4" />
              <span className="text-[11px]">Import media</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
