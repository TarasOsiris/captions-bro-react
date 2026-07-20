import { useRef } from 'react'
import {
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconPause,
  IconPlay,
  IconScissors,
  IconSkipEnd,
  IconSkipStart,
  IconTrash,
} from './icons'
import { formatDuration, formatRulerTime, formatTimecode } from '@/lib/media'

export interface TimelineClip {
  name: string
  durationSec: number | null
  thumbs: string[]
}

interface TimelineProps {
  clip: TimelineClip | null
  currentTime: number
  playing: boolean
  selected: boolean
  onTogglePlay: () => void
  onSeek: (t: number) => void
  onSelect: () => void
  onDeselect: () => void
}

/** Major-tick spacing that yields ≤10 labels across the ruler. */
function tickStep(duration: number): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  for (const s of steps) {
    if (duration / s <= 10) return s
  }
  return 1800
}

const RULER_FALLBACK_SEC = 60

const TOOLBAR_TOOLS = [
  { Icon: IconScissors, label: 'Split' },
  { Icon: IconCopy, label: 'Duplicate' },
  { Icon: IconTrash, label: 'Delete' },
]

export function Timeline({
  clip,
  currentTime,
  playing,
  selected,
  onTogglePlay,
  onSeek,
  onSelect,
  onDeselect,
}: TimelineProps) {
  const scrubRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const duration =
    clip && clip.durationSec != null && clip.durationSec > 0
      ? clip.durationSec
      : null
  const rulerDuration = duration ?? RULER_FALLBACK_SEC
  const playheadPct =
    duration != null ? Math.min(Math.max(currentTime / duration, 0), 1) * 100 : 0

  const seekFromClientX = (clientX: number) => {
    if (duration == null) return
    const el = scrubRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
    onSeek(frac * duration)
  }

  // Ticks: majors carry labels, four minors between each pair.
  const step = tickStep(rulerDuration)
  const minorStep = step / 5
  const tickCount = Math.floor(rulerDuration / minorStep)
  const ticks: Array<{ t: number; major: boolean }> = []
  for (let i = 0; i <= tickCount; i++) {
    ticks.push({ t: i * minorStep, major: i % 5 === 0 })
  }

  return (
    <footer className="flex h-56 shrink-0 flex-col border-t border-edge bg-surface/70">
      <div className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-edge/70 px-3">
        <div className="flex items-center gap-1">
          {TOOLBAR_TOOLS.map(({ Icon, label }) => (
            <button
              key={label}
              type="button"
              disabled
              title={`${label} — coming soon`}
              className="flex h-7 w-7 cursor-default items-center justify-center rounded-md text-muted/40"
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              onSeek(0)
            }}
            disabled={duration == null}
            title="Jump to start"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconSkipStart className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={duration == null}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-bg transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {playing ? (
              <IconPause className="h-4 w-4" />
            ) : (
              <IconPlay className="ml-0.5 h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              if (duration != null) onSeek(duration)
            }}
            disabled={duration == null}
            title="Jump to end"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconSkipEnd className="h-4 w-4" />
          </button>
          <div className="ml-3 font-mono text-xs tabular-nums">
            <span className="text-ink">{formatTimecode(currentTime)}</span>
            <span className="text-muted"> / {formatTimecode(duration ?? 0)}</span>
          </div>
        </div>

        <div className="flex justify-end">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted/50">
            On-device · WebCodecs
          </span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 px-4 pb-4 pt-1.5">
        <div
          ref={scrubRef}
          onPointerDown={(e) => {
            // Reaches here only when the pointer isn't on the clip (the clip
            // stops propagation), so a press on the ruler/empty area deselects.
            onDeselect()
            if (duration == null) return
            draggingRef.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            seekFromClientX(e.clientX)
          }}
          onPointerMove={(e) => {
            if (draggingRef.current) seekFromClientX(e.clientX)
          }}
          onPointerUp={(e) => {
            draggingRef.current = false
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId)
            }
          }}
          onPointerCancel={() => {
            draggingRef.current = false
          }}
          className={`relative h-full select-none ${duration != null ? 'cursor-pointer' : ''}`}
        >
          <div className="relative h-6">
            {ticks.map(({ t, major }) => {
              const left = `${((t / rulerDuration) * 100).toString()}%`
              return major ? (
                <div key={t}>
                  <span
                    className="absolute top-0 -translate-x-1/2 font-mono text-[10px] tabular-nums text-muted/70"
                    style={{ left }}
                  >
                    {formatRulerTime(t)}
                  </span>
                  <span
                    className="absolute bottom-0 h-1.5 w-px bg-muted/40"
                    style={{ left }}
                  />
                </div>
              ) : (
                <span
                  key={t}
                  className="absolute bottom-0 h-1 w-px bg-muted/20"
                  style={{ left }}
                />
              )
            })}
          </div>

          <div className="relative mt-2">
            {clip ? (
              <div
                onClick={onSelect}
                onPointerDown={(e) => {
                  // Keep the clip press from bubbling to the scrub handler, which
                  // would seek and deselect; a tap on the clip only selects it.
                  e.stopPropagation()
                }}
                className="relative h-14 cursor-pointer"
              >
                <div className="absolute inset-0 overflow-hidden rounded-[11px] bg-black">
                  {clip.thumbs.length > 0 ? (
                    <div className="flex h-full w-full">
                      {clip.thumbs.map((src, i) => (
                        <img
                          key={i}
                          src={src}
                          alt=""
                          draggable={false}
                          className="h-full min-w-0 flex-1 object-cover"
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="h-full w-full animate-pulse bg-linear-to-r from-raised via-edge/60 to-raised" />
                  )}
                  <span className="absolute bottom-1 left-1.5 max-w-[60%] truncate rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/90">
                    {clip.name}
                  </span>
                </div>

                {/* Selection chrome — mirrors the iOS TrimChromeOverlay: a 3px
                    white border at r=13 with 18px filled handle brackets bearing
                    chevrons, overhanging 3px top/bottom. */}
                {selected && (
                  <div className="pointer-events-none absolute -inset-y-[3px] inset-x-0 z-20">
                    <div className="absolute inset-0 rounded-[13px] border-[3px] border-select" />
                    <div className="absolute -left-[18px] top-0 bottom-0 flex w-[18px] items-center justify-center rounded-l-[13px] bg-select">
                      <IconChevronLeft className="h-3.5 w-3.5 text-black/70" />
                    </div>
                    <div className="absolute -right-[18px] top-0 bottom-0 flex w-[18px] items-center justify-center rounded-r-[13px] bg-select">
                      <IconChevronRight className="h-3.5 w-3.5 text-black/70" />
                    </div>
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                      {formatDuration(clip.durationSec)}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-14 items-center justify-center rounded-[11px] border border-dashed border-edge/80 text-xs text-muted">
                Import a clip to start
              </div>
            )}
          </div>

          {clip && duration != null && (
            <div
              className="pointer-events-none absolute inset-y-0 z-10"
              style={{ left: `${playheadPct.toString()}%` }}
            >
              <div className="pointer-events-auto absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 cursor-grab active:cursor-grabbing" />
              <div className="absolute left-1/2 top-0 h-3.5 w-[9px] -translate-x-1/2 rounded-[2px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.6)]" />
              <div className="absolute inset-y-0 left-1/2 top-1 w-[3px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_4px_rgba(0,0,0,0.6)]" />
            </div>
          )}
        </div>
      </div>
    </footer>
  )
}
