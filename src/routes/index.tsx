import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ExportCancelledError, canExportH264, exportVideo } from '@/lib/export'
import type { ExportHandle } from '@/lib/export'

export const Route = createFileRoute('/')({
  component: Home,
})

const VIDEO_EXTENSIONS = ['.mov', '.mp4', '.m4v', '.webm', '.mkv']

const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40'
const BTN_SECONDARY =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-edge bg-transparent px-4 py-2.5 text-sm font-medium text-ink transition hover:border-muted disabled:cursor-not-allowed disabled:opacity-40'

type LoadedVideo = {
  file: File
  url: string
  name: string
  sizeBytes: number
  durationSec: number | null
}

type UiState =
  | { phase: 'empty'; error?: string }
  | { phase: 'loaded'; video: LoadedVideo; error?: string }
  | {
      phase: 'exporting'
      video: LoadedVideo
      progress: number
      handle: ExportHandle
    }
  | {
      phase: 'done'
      video: LoadedVideo
      downloadUrl: string
      fileName: string
      outputBytes: number
      warning?: string
    }

function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true
  if (file.type === '') {
    const lower = file.name.toLowerCase()
    return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))
  }
  return false
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '—'
  const total = Math.round(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function errorMessage(err: unknown): string | null {
  if (err instanceof ExportCancelledError) return null
  if (err instanceof Error && err.message) return err.message
  return 'Something went wrong during export.'
}

function revokeState(s: UiState) {
  if (s.phase === 'loaded' || s.phase === 'exporting') {
    URL.revokeObjectURL(s.video.url)
  } else if (s.phase === 'done') {
    URL.revokeObjectURL(s.video.url)
    URL.revokeObjectURL(s.downloadUrl)
  }
}

function triggerDownload(url: string, fileName: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function Home() {
  const [state, setState] = useState<UiState>({ phase: 'empty' })
  const [supported, setSupported] = useState<boolean | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Mirror state into a ref so async export callbacks can read the latest value
  // without going stale (they compare the in-flight handle against current state).
  const stateRef = useRef(state)
  stateRef.current = state

  // Client-only capability probe (touches WebCodecs, never runs during SSR).
  useEffect(() => {
    let alive = true
    canExportH264().then(
      (ok) => {
        if (alive) setSupported(ok)
      },
      () => {
        if (alive) setSupported(false)
      },
    )
    return () => {
      alive = false
    }
  }, [])

  // Release any object URLs held at unmount.
  useEffect(() => () => revokeState(stateRef.current), [])

  // Auto-download whenever we enter a fresh `done` state (new blob URL).
  const doneUrl = state.phase === 'done' ? state.downloadUrl : null
  const doneName = state.phase === 'done' ? state.fileName : null
  useEffect(() => {
    if (doneUrl && doneName) triggerDownload(doneUrl, doneName)
  }, [doneUrl, doneName])

  const loadFile = useCallback((file: File) => {
    revokeState(stateRef.current)
    if (!isVideoFile(file)) {
      setState({ phase: 'empty', error: "That doesn't look like a video file." })
      return
    }
    const url = URL.createObjectURL(file)
    setState({
      phase: 'loaded',
      video: {
        file,
        url,
        name: file.name,
        sizeBytes: file.size,
        durationSec: null,
      },
    })
  }, [])

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) loadFile(file)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = e.dataTransfer.files
    if (files.length > 0) loadFile(files[0])
  }

  const onLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const dur = e.currentTarget.duration
    setState((prev) =>
      prev.phase === 'loaded' && prev.video.durationSec == null
        ? {
            ...prev,
            video: {
              ...prev.video,
              durationSec: Number.isFinite(dur) ? dur : null,
            },
          }
        : prev,
    )
  }

  const startExport = useCallback(() => {
    const current = stateRef.current
    if (current.phase !== 'loaded') return
    const video = current.video

    const handle = exportVideo(video.file, {
      onProgress: (fraction) => {
        setState((prev) =>
          prev.phase === 'exporting' && prev.handle === handle
            ? { ...prev, progress: fraction }
            : prev,
        )
      },
    })

    setState({ phase: 'exporting', video, progress: 0, handle })

    handle.done.then(
      (result) => {
        const s = stateRef.current
        if (s.phase !== 'exporting' || s.handle !== handle) return
        const downloadUrl = URL.createObjectURL(result.blob)
        const warning = result.discardedTracks.length
          ? "Audio was dropped — this browser can't encode its codec, so the exported video is silent."
          : undefined
        setState({
          phase: 'done',
          video,
          downloadUrl,
          fileName: result.suggestedFileName,
          outputBytes: result.blob.size,
          warning,
        })
      },
      (err) => {
        const s = stateRef.current
        if (s.phase !== 'exporting' || s.handle !== handle) return
        const message = errorMessage(err)
        setState(
          message
            ? { phase: 'loaded', video, error: message }
            : { phase: 'loaded', video },
        )
      },
    )
  }, [])

  const cancelExport = useCallback(() => {
    const s = stateRef.current
    if (s.phase !== 'exporting') return
    const video = s.video
    s.handle.cancel().catch(() => {})
    setState({ phase: 'loaded', video })
  }, [])

  const exportAgain = useCallback(() => {
    const s = stateRef.current
    if (s.phase !== 'done') return
    URL.revokeObjectURL(s.downloadUrl)
    setState({ phase: 'loaded', video: s.video })
  }, [])

  const reset = useCallback(() => {
    revokeState(stateRef.current)
    setState({ phase: 'empty' })
  }, [])

  return (
    <main className="min-h-screen bg-[radial-gradient(60rem_40rem_at_50%_-10%,rgba(79,140,255,0.10),transparent)] px-5 py-12">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.22em] text-accent">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
            Captions Bro
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
            Video, re-encoded in your browser
          </h1>
          <p className="mt-2 text-sm text-muted">
            Drop in a clip and export a clean H.264 + AAC MP4. Nothing uploads —
            the whole pipeline runs on this device.
          </p>
        </header>

        <section className="rounded-2xl border border-edge bg-surface p-6 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_20px_60px_-30px_rgba(0,0,0,0.9)] sm:p-8">
          {supported === false && (
            <div className="mb-6 rounded-lg border border-[#f5b344]/30 bg-[#f5b344]/10 px-4 py-3 text-sm text-[#f5c56b]">
              Your browser can't encode H.264 — try Chrome or Edge.
            </div>
          )}

          {state.phase === 'empty' && (
            <div>
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors ${
                  dragging ? 'border-accent bg-accent/5' : 'border-edge'
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-10 w-10 text-muted"
                  aria-hidden="true"
                >
                  <path d="M12 16V4" />
                  <path d="m7 9 5-5 5 5" />
                  <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                </svg>
                <div>
                  <p className="text-ink">Drop a video here</p>
                  <p className="mt-1 text-sm text-muted">
                    MP4, MOV, WebM or MKV
                  </p>
                </div>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose a file
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={onFileInputChange}
                />
              </div>
              {state.error && (
                <p className="mt-3 text-sm text-[#ff7a7a]">{state.error}</p>
              )}
            </div>
          )}

          {state.phase === 'loaded' && (
            <div>
              <video
                key={state.video.url}
                src={state.video.url}
                controls
                playsInline
                onLoadedMetadata={onLoadedMetadata}
                className="max-h-[48vh] w-full rounded-xl bg-black"
              />
              <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted">
                <span className="max-w-full truncate text-ink">
                  {state.video.name}
                </span>
                <span>·</span>
                <span>{formatBytes(state.video.sizeBytes)}</span>
                <span>·</span>
                <span>{formatDuration(state.video.durationSec)}</span>
              </div>

              {state.error && (
                <p className="mt-4 rounded-lg border border-[#ff7a7a]/30 bg-[#ff7a7a]/10 px-4 py-3 text-sm text-[#ff9a9a]">
                  {state.error}
                </p>
              )}

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={startExport}
                  disabled={supported === false}
                >
                  Export MP4
                </button>
                <button
                  type="button"
                  className={BTN_SECONDARY}
                  onClick={reset}
                >
                  Choose different video
                </button>
              </div>
            </div>
          )}

          {state.phase === 'exporting' && (
            <div>
              <p className="mb-4 max-w-full truncate font-mono text-xs text-muted">
                {state.video.name}
              </p>
              <div className="rounded-xl border border-edge bg-bg/40 p-6">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-ink">
                    {state.progress >= 0.99 ? 'Finalizing…' : 'Encoding video…'}
                  </span>
                  <span className="font-mono text-sm tabular-nums text-accent">
                    {Math.round(state.progress * 100)}%
                  </span>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-edge">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
                    style={{ width: `${Math.max(2, state.progress * 100)}%` }}
                  />
                </div>
                <p className="mt-3 text-xs text-muted">
                  Re-encoding to H.264 + AAC. Keep this tab open.
                </p>
              </div>
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  className={BTN_SECONDARY}
                  onClick={cancelExport}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {state.phase === 'done' && (
            <div>
              <div className="rounded-xl border border-edge bg-bg/40 p-6 text-center">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mx-auto h-9 w-9 text-accent"
                  aria-hidden="true"
                >
                  <path d="M21.801 10A10 10 0 1 1 17 3.335" />
                  <path d="m9 11 3 3L22 4" />
                </svg>
                <p className="mt-3 text-ink">Export complete — download started</p>
                <p className="mt-1 font-mono text-xs text-muted">
                  {state.fileName} · {formatBytes(state.outputBytes)}
                </p>
              </div>

              {state.warning && (
                <p className="mt-4 rounded-lg border border-[#f5b344]/30 bg-[#f5b344]/10 px-4 py-3 text-sm text-[#f5c56b]">
                  {state.warning}
                </p>
              )}

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={() => triggerDownload(state.downloadUrl, state.fileName)}
                >
                  Download again
                </button>
                <button
                  type="button"
                  className={BTN_SECONDARY}
                  onClick={exportAgain}
                >
                  Export again
                </button>
                <button
                  type="button"
                  className={BTN_SECONDARY}
                  onClick={reset}
                >
                  Choose different video
                </button>
              </div>
            </div>
          )}
        </section>

        <p className="mt-6 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-muted/70">
          On-device · WebCodecs · no upload
        </p>
      </div>
    </main>
  )
}
