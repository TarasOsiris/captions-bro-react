// The full-screen export experience — a web port of the iOS app's export screen.
// One screen that morphs between two phases: `exporting` (big percentage + a
// rounded-rect progress ring tracing the preview) and `done` (looping result
// video + a share row). Reads all state from the store; the parent owns cancel/close.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, Share2, X } from 'lucide-react'
import { useEditorStore } from '@/store/editorStore'

interface ExportScreenProps {
  /** Abort the in-progress export (cancel X while exporting). */
  onCancel: () => void
  /** Dismiss the finished screen (X while done) — releases the file URL. */
  onClose: () => void
}

const PREVIEW_RADIUS = 20
const RING_GAP = 10
const RING_LINE = 6
const RING_INSET = RING_GAP + RING_LINE // ring sits this far outside the preview
const PAD = 24
const PREVIEW_ASPECT = 16 / 9

/** Rounded-rect outline starting at top-center, drawn clockwise, so a
 *  stroke-dasharray trim fills the frame from 12 o'clock like the iOS ring. */
function ringPath(w: number, h: number, r: number): string {
  const cx = w / 2
  return [
    `M ${cx} 0`,
    `H ${w - r}`,
    `A ${r} ${r} 0 0 1 ${w} ${r}`,
    `V ${h - r}`,
    `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
    `H ${r}`,
    `A ${r} ${r} 0 0 1 0 ${h - r}`,
    `V ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    'Z',
  ].join(' ')
}

export function ExportScreen({ onCancel, onClose }: ExportScreenProps) {
  const progress = useEditorStore((s) => s.exportProgress)
  const downloadUrl = useEditorStore((s) => s.downloadUrl)
  const downloadName = useEditorStore((s) => s.downloadName)
  const silent = useEditorStore((s) => s.exportSilent)
  const done = useEditorStore((s) => s.exportPhase === 'done')

  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setStage({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [])

  // Fit a 16:9 preview (plus the ring inset) into the measured stage area.
  const availW = Math.max(0, stage.w - PAD * 2 - RING_INSET * 2)
  const availH = Math.max(0, stage.h - PAD * 2 - RING_INSET * 2)
  const previewW = Math.max(0, Math.min(availW, availH * PREVIEW_ASPECT))
  const previewH = previewW / PREVIEW_ASPECT
  const ringW = previewW + RING_INSET * 2
  const ringH = previewH + RING_INSET * 2
  const ringRadius = PREVIEW_RADIUS + RING_INSET

  const pct = Math.floor(progress * 1000) / 10 // one decimal, rounded down

  // Probe actual file-sharing support: desktop Chrome/Edge expose navigator.canShare
  // but return false for { files }, which would leave a dead Share button.
  const canShare = useMemo(
    () =>
      typeof navigator !== 'undefined' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({
        files: [new File([], 'video.mp4', { type: 'video/mp4' })],
      }),
    [],
  )

  const doDownload = () => {
    if (!downloadUrl || !downloadName) return
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = downloadName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setSaved(true)
  }

  const doShare = async () => {
    if (!downloadUrl || !downloadName) return
    try {
      const blob = await fetch(downloadUrl).then((r) => r.blob())
      const file = new File([blob], downloadName, { type: 'video/mp4' })
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: downloadName })
      }
    } catch {
      /* user dismissed the share sheet, or it isn't shareable — no-op */
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg text-ink">
      <div className="flex h-14 shrink-0 items-center px-4">
        <button
          type="button"
          onClick={done ? onClose : onCancel}
          aria-label={done ? 'Close' : 'Cancel export'}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-raised text-muted transition hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex shrink-0 flex-col items-center gap-2 px-6 text-center">
        <div className="flex min-h-[3.25rem] items-center justify-center">
          {done ? (
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Choose where to share
            </h2>
          ) : (
            <span className="font-mono text-4xl font-semibold tabular-nums sm:text-5xl">
              {pct.toFixed(1)}%
            </span>
          )}
        </div>
        <p className="max-w-md text-sm text-muted">
          {done
            ? 'Your video is optimized for high-quality playback on social media.'
            : 'Keep this tab open while your video renders. You can download or share it next.'}
        </p>
      </div>

      <div
        ref={stageRef}
        className="flex min-h-0 flex-1 items-center justify-center"
      >
        {previewW > 0 && (
          <div
            className="relative"
            style={{ width: `${previewW}px`, height: `${previewH}px` }}
          >
            <div
              className="absolute inset-0 overflow-hidden bg-black shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9)]"
              style={{ borderRadius: `${PREVIEW_RADIUS}px` }}
            >
              {done && downloadUrl ? (
                <video
                  key={downloadUrl}
                  src={downloadUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                  controls
                  className="h-full w-full object-cover"
                />
              ) : (
                <div
                  className="h-full w-full"
                  style={{
                    background:
                      'radial-gradient(60rem 40rem at 50% -10%, color-mix(in srgb, var(--color-accent-deep) 20%, transparent), transparent)',
                  }}
                />
              )}
            </div>

            {!done && (
              <svg
                className="pointer-events-none absolute"
                style={{
                  left: `${-RING_INSET}px`,
                  top: `${-RING_INSET}px`,
                  width: `${ringW}px`,
                  height: `${ringH}px`,
                }}
                viewBox={`0 0 ${ringW} ${ringH}`}
                fill="none"
              >
                <defs>
                  <linearGradient id="export-ring" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent-deep)" />
                    <stop offset="100%" stopColor="var(--color-accent)" />
                  </linearGradient>
                </defs>
                <path
                  d={ringPath(ringW, ringH, ringRadius)}
                  stroke="rgba(255,255,255,0.10)"
                  strokeWidth={RING_LINE}
                />
                <path
                  d={ringPath(ringW, ringH, ringRadius)}
                  stroke="url(#export-ring)"
                  strokeWidth={RING_LINE}
                  strokeLinecap="round"
                  pathLength={1}
                  strokeDasharray={`${Math.max(progress, 0.012)} 1`}
                />
              </svg>
            )}
          </div>
        )}
      </div>

      {/* Fixed-height slot so the preview never reflows between phases. */}
      <div className="flex h-[104px] shrink-0 items-start justify-center gap-8 px-6">
        {done && (
          <>
            <ShareTile
              icon={
                saved ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <Download className="h-5 w-5" />
                )
              }
              label={saved ? 'Saved' : 'Download'}
              onClick={doDownload}
            />
            {canShare && (
              <ShareTile
                icon={<Share2 className="h-5 w-5" />}
                label="Share"
                onClick={() => {
                  void doShare()
                }}
              />
            )}
          </>
        )}
      </div>

      {done && silent && (
        <p className="pb-4 text-center text-xs text-muted/70">
          This browser couldn&apos;t encode audio, so the video is silent.
        </p>
      )}
    </div>
  )
}

function ShareTile({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-raised text-ink shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] transition hover:brightness-125">
        {icon}
      </span>
      <span className="text-[11px] text-muted">{label}</span>
    </button>
  )
}
