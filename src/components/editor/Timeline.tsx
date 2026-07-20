import { useRef } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Pause,
  Play,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatDuration, formatRulerTime, formatTimecode } from '@/lib/media'
import { TIMELINE_PX_PER_SEC, TIMELINE_TILE_W } from '@/lib/thumbs'

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

/** Horizontal inset (px) baked into every track offset so the overhanging trim
 *  handles stay on-screen at either scroll end. */
const TRACK_PAD = 24
/** Minimum spacing (px) between labelled major ticks at the fixed scale. */
const MIN_LABEL_PX = 56

/** Major-tick spacing (s) — the smallest that keeps labels ≥MIN_LABEL_PX apart
 *  at the fixed pixels-per-second scale. Cadence is length-independent: it's a
 *  function of the scale alone, so 2s ticks stay 2s ticks whatever the clip. */
function tickStep(): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  for (const s of steps) {
    if (s * TIMELINE_PX_PER_SEC >= MIN_LABEL_PX) return s
  }
  return 1800
}

const RULER_FALLBACK_SEC = 60

const TOOLBAR_TOOLS = [
  { Icon: Scissors, label: 'Split' },
  { Icon: Copy, label: 'Duplicate' },
  { Icon: Trash2, label: 'Delete' },
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
  // Fixed scale: the track is `rulerDuration` seconds wide at a constant
  // pixels-per-second, so a longer clip makes a longer (horizontally scrollable)
  // track — it never compresses to fit. TRACK_PAD is baked into every offset.
  const contentWidth = rulerDuration * TIMELINE_PX_PER_SEC
  const trackWidth = TRACK_PAD * 2 + contentWidth
  const tileCount = Math.max(1, Math.ceil(contentWidth / TIMELINE_TILE_W))
  const playheadX =
    duration != null
      ? TRACK_PAD +
        Math.min(Math.max(currentTime, 0), duration) * TIMELINE_PX_PER_SEC
      : 0

  const seekFromClientX = (clientX: number) => {
    if (duration == null) return
    const el = scrubRef.current
    if (!el) return
    // rect.left is the track's own left edge, which scrolls with the content, so
    // (clientX - left - pad) stays correct at any scroll offset.
    const rect = el.getBoundingClientRect()
    const frac = Math.min(
      Math.max(
        (clientX - rect.left - TRACK_PAD) / (duration * TIMELINE_PX_PER_SEC),
        0,
      ),
      1,
    )
    onSeek(frac * duration)
  }

  // Ticks: majors carry labels, four minors between each pair.
  const step = tickStep()
  const minorStep = step / 5
  const tickCount = Math.floor(rulerDuration / minorStep)
  const ticks: Array<{ t: number; major: boolean }> = []
  for (let i = 0; i <= tickCount; i++) {
    ticks.push({ t: i * minorStep, major: i % 5 === 0 })
  }

  return (
    <footer className="flex h-72 shrink-0 flex-col border-t border-edge bg-surface/70">
      <div className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-edge/70 px-3">
        <div className="flex items-center gap-1">
          {TOOLBAR_TOOLS.map(({ Icon, label }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-disabled
                  onClick={(e) => {
                    e.preventDefault()
                  }}
                  className="h-7 w-7 cursor-default text-muted/40 hover:bg-transparent hover:text-muted/40"
                >
                  <Icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{label} — coming soon</TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  onSeek(0)
                }}
                disabled={duration == null}
                aria-label="Jump to start"
                className="h-7 w-7"
              >
                <SkipBack className="h-4 w-4" fill="currentColor" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Jump to start</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={onTogglePlay}
                disabled={duration == null}
                aria-label={playing ? 'Pause' : 'Play'}
                className="h-8 w-8 rounded-full bg-ink p-0 text-bg hover:bg-white"
              >
                {playing ? (
                  <Pause className="h-4 w-4" fill="currentColor" />
                ) : (
                  <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {playing ? 'Pause (Space)' : 'Play (Space)'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (duration != null) onSeek(duration)
                }}
                disabled={duration == null}
                aria-label="Jump to end"
                className="h-7 w-7"
              >
                <SkipForward className="h-4 w-4" fill="currentColor" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Jump to end</TooltipContent>
          </Tooltip>
          <div className="ml-3 font-mono text-xs tabular-nums">
            <span className="text-ink">{formatTimecode(currentTime)}</span>
            <span className="text-muted">
              {' '}
              / {formatTimecode(duration ?? 0)}
            </span>
          </div>
        </div>

        <div className="flex justify-end">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted/50">
            On-device · WebCodecs
          </span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden pb-2 pt-1.5">
        {clip ? (
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
            style={{ width: `${trackWidth.toString()}px` }}
            className={`relative h-full select-none ${duration != null ? 'cursor-pointer' : ''}`}
          >
            <div className="relative h-6">
              {ticks.map(({ t, major }) => {
                const left = `${(TRACK_PAD + t * TIMELINE_PX_PER_SEC).toFixed(2)}px`
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

            <div className="relative mt-2 h-14">
              <div
                onClick={onSelect}
                onPointerDown={(e) => {
                  // Keep the clip press from bubbling to the scrub handler, which
                  // would seek and deselect; a tap on the clip only selects it.
                  e.stopPropagation()
                }}
                style={{
                  left: `${TRACK_PAD.toString()}px`,
                  width: `${contentWidth.toString()}px`,
                }}
                className="absolute inset-y-0 cursor-pointer"
              >
                <div
                  className={`absolute inset-0 overflow-hidden bg-black ${selected ? 'rounded-none' : 'rounded-[11px]'}`}
                >
                  {clip.thumbs.length > 0 ? (
                    <div className="absolute inset-0">
                      {Array.from({ length: tileCount }, (_, i) => {
                        // Fixed-width tiles sampled from the source frames, so a
                        // tile is a constant size at any clip length. Each is 1px
                        // wider than its slot so neighbours overlap — fractional
                        // pixels (any DPR) can't open a seam onto the black base.
                        const src =
                          clip.thumbs[
                            Math.min(
                              clip.thumbs.length - 1,
                              Math.floor(
                                ((i + 0.5) / tileCount) * clip.thumbs.length,
                              ),
                            )
                          ]
                        return (
                          <div
                            key={i}
                            style={{
                              backgroundImage: `url("${src}")`,
                              left: `${(i * TIMELINE_TILE_W).toString()}px`,
                              width: `${(TIMELINE_TILE_W + 1).toString()}px`,
                            }}
                            className="absolute inset-y-0 bg-cover bg-center"
                          />
                        )
                      })}
                    </div>
                  ) : (
                    <div className="h-full w-full animate-pulse bg-linear-to-r from-raised via-edge/60 to-raised" />
                  )}
                  <span className="absolute bottom-1 left-1.5 max-w-[60%] truncate rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/90">
                    {clip.name}
                  </span>
                </div>

                {/* Selection chrome — mirrors the iOS TrimChromeOverlay: a 3px
                    border with filled handle brackets bearing chevrons,
                    overhanging 3px top/bottom. The border is square-cornered so
                    its top/bottom bars run straight into the brackets with no
                    seam; the frame's rounded outer corners come from the
                    handles' r=13 rounding. */}
                {selected && (
                  <div className="pointer-events-none absolute -inset-y-[3px] inset-x-0 z-20">
                    <div className="absolute inset-0 border-[3px] border-select" />
                    <div className="absolute -left-[14px] top-0 bottom-0 flex w-[14px] items-center justify-center rounded-l-[13px] bg-select">
                      <ChevronLeft className="h-3 w-3 text-black/70" />
                    </div>
                    <div className="absolute -right-[14px] top-0 bottom-0 flex w-[14px] items-center justify-center rounded-r-[13px] bg-select">
                      <ChevronRight className="h-3 w-3 text-black/70" />
                    </div>
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                      {formatDuration(clip.durationSec)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {duration != null && (
              <div
                className="pointer-events-none absolute inset-y-0 z-10"
                style={{ left: `${playheadX.toFixed(2)}px` }}
              >
                <div className="pointer-events-auto absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 cursor-grab active:cursor-grabbing" />
                <div className="absolute inset-y-0 left-1/2 top-1 w-[3px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_4px_rgba(0,0,0,0.6)]" />
                <div className="absolute left-1/2 top-0 h-3.5 w-[9px] -translate-x-1/2 rounded-[2px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.6)]" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center px-6">
            <div className="flex h-14 w-full items-center justify-center rounded-[11px] border border-dashed border-edge/80 text-xs text-muted">
              Import a clip to start
            </div>
          </div>
        )}
      </div>
    </footer>
  )
}
