import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ExportCancelledError,
  canExportH264,
  exportImage,
  exportVideo,
} from '@/lib/export'
import {
  DEFAULT_IMAGE_DURATION_SEC,
  formatBytes,
  mediaKind,
} from '@/lib/media'
import { generateFilmstrip } from '@/lib/thumbs'
import { MediaPanel } from '@/components/editor/MediaPanel'
import { PreviewStage } from '@/components/editor/PreviewStage'
import { Timeline } from '@/components/editor/Timeline'
import { TopBar } from '@/components/editor/TopBar'
import { IconCheck, IconDownload, IconX } from '@/components/editor/icons'
import type { ExportHandle } from '@/lib/export'
import type { LoadedMedia } from '@/lib/media'

export const Route = createFileRoute('/')({
  component: Editor,
})

// Timeline filmstrip tile count; stills just repeat their own frame.
const STRIP_TILES = 14

type UiState =
  | { phase: 'empty'; error?: string }
  | { phase: 'loaded'; media: LoadedMedia; error?: string }
  | {
      phase: 'exporting'
      media: LoadedMedia
      progress: number
      handle: ExportHandle
    }
  | {
      phase: 'done'
      media: LoadedMedia
      downloadUrl: string
      fileName: string
      outputBytes: number
      warning?: string
    }

function errorMessage(err: unknown): string | null {
  if (err instanceof ExportCancelledError) return null
  if (err instanceof Error && err.message) return err.message
  return 'Something went wrong during export.'
}

function revokeState(s: UiState) {
  if (s.phase === 'loaded' || s.phase === 'exporting') {
    URL.revokeObjectURL(s.media.url)
  } else if (s.phase === 'done') {
    URL.revokeObjectURL(s.media.url)
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function Editor() {
  const [state, setState] = useState<UiState>({ phase: 'empty' })
  const [supported, setSupported] = useState<boolean | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Mirror state into refs so async export callbacks and the rAF clock read the
  // latest values without going stale.
  const stateRef = useRef(state)
  stateRef.current = state
  const playingRef = useRef(playing)
  const currentTimeRef = useRef(0)

  const media = state.phase === 'empty' ? null : state.media
  const clipUrl = media?.url ?? null
  const clipKind = media?.kind ?? null

  const setTime = useCallback((t: number) => {
    currentTimeRef.current = t
    setCurrentTime(t)
  }, [])

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

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

  // Unified playhead clock. Video: mirror the element. Image: advance a virtual
  // time while playing, stopping at the clip's fixed duration.
  useEffect(() => {
    if (clipUrl == null) return
    let raf = 0
    let lastTs: number | null = null
    const tick = (ts: number) => {
      const s = stateRef.current
      if (s.phase !== 'empty') {
        if (s.media.kind === 'video') {
          const v = videoRef.current
          if (v) setTime(v.currentTime)
        } else if (playingRef.current && lastTs != null) {
          const dur = s.media.durationSec ?? DEFAULT_IMAGE_DURATION_SEC
          let next = currentTimeRef.current + (ts - lastTs) / 1000
          if (next >= dur) {
            next = dur
            setPlaying(false)
          }
          setTime(next)
        }
      }
      lastTs = ts
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [clipUrl, setTime])

  // Filmstrip thumbnails for the timeline + media bin (video only; stills reuse
  // their own frame, set at load time).
  useEffect(() => {
    if (clipUrl == null || clipKind !== 'video') return
    let alive = true
    generateFilmstrip(clipUrl).then(
      (frames) => {
        if (!alive || frames.length === 0) return
        setState((prev) => {
          if (prev.phase === 'empty' || prev.media.url !== clipUrl) return prev
          return { ...prev, media: { ...prev.media, thumbs: frames } }
        })
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [clipUrl, clipKind])

  // Auto-download whenever we enter a fresh `done` state (new blob URL).
  const doneUrl = state.phase === 'done' ? state.downloadUrl : null
  const doneName = state.phase === 'done' ? state.fileName : null
  useEffect(() => {
    if (doneUrl != null && doneName != null) triggerDownload(doneUrl, doneName)
  }, [doneUrl, doneName])

  const loadFile = useCallback(
    (file: File) => {
      revokeState(stateRef.current)
      setPlaying(false)
      setTime(0)
      const kind = mediaKind(file)
      if (kind == null) {
        setState({
          phase: 'empty',
          error: "That doesn't look like a video or image file.",
        })
        return
      }
      const url = URL.createObjectURL(file)
      setState({
        phase: 'loaded',
        media: {
          file,
          kind,
          url,
          name: file.name,
          sizeBytes: file.size,
          durationSec: kind === 'image' ? DEFAULT_IMAGE_DURATION_SEC : null,
          thumbs: kind === 'image' ? Array(STRIP_TILES).fill(url) : [],
        },
      })
    },
    [setTime],
  )

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) loadFile(file)
    e.target.value = ''
  }

  const pickFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onLoadedMetadata = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const dur = e.currentTarget.duration
      setState((prev) =>
        prev.phase !== 'empty' && prev.media.durationSec == null
          ? {
              ...prev,
              media: {
                ...prev.media,
                durationSec: Number.isFinite(dur) ? dur : null,
              },
            }
          : prev,
      )
    },
    [],
  )

  const togglePlay = useCallback(() => {
    const s = stateRef.current
    if (s.phase === 'empty') return
    if (s.media.kind === 'video') {
      const v = videoRef.current
      if (!v) return
      if (v.paused || v.ended) v.play().catch(() => {})
      else v.pause()
    } else {
      const dur = s.media.durationSec ?? DEFAULT_IMAGE_DURATION_SEC
      if (!playingRef.current && currentTimeRef.current >= dur) setTime(0)
      setPlaying((p) => !p)
    }
  }, [setTime])

  const seek = useCallback(
    (t: number) => {
      const s = stateRef.current
      if (s.phase === 'empty') return
      if (s.media.kind === 'video') {
        const v = videoRef.current
        if (!v) return
        const dur = Number.isFinite(v.duration) ? v.duration : t
        const clamped = clamp(t, 0, dur)
        v.currentTime = clamped
        setTime(clamped)
      } else {
        const dur = s.media.durationSec ?? DEFAULT_IMAGE_DURATION_SEC
        setTime(clamp(t, 0, dur))
      }
    },
    [setTime],
  )

  // Space = play/pause, ←/→ = nudge 1s, Home/End = jump.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      if (stateRef.current.phase === 'empty') return
      if (e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) togglePlay()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        seek(currentTimeRef.current - 1)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        seek(currentTimeRef.current + 1)
      } else if (e.code === 'Home') {
        e.preventDefault()
        seek(0)
      } else if (e.code === 'End') {
        e.preventDefault()
        seek(Number.POSITIVE_INFINITY)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [togglePlay, seek])

  const startExport = useCallback(() => {
    const current = stateRef.current
    if (current.phase !== 'loaded' && current.phase !== 'done') return
    if (current.phase === 'done') URL.revokeObjectURL(current.downloadUrl)
    const activeMedia = current.media

    const onProgress = (fraction: number) => {
      setState((prev) =>
        prev.phase === 'exporting' && prev.handle === handle
          ? { ...prev, progress: fraction }
          : prev,
      )
    }
    const handle =
      activeMedia.kind === 'image'
        ? exportImage(activeMedia.file, {
            durationSec: activeMedia.durationSec ?? DEFAULT_IMAGE_DURATION_SEC,
            onProgress,
          })
        : exportVideo(activeMedia.file, { onProgress })

    setState({ phase: 'exporting', media: activeMedia, progress: 0, handle })

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
          media,
          downloadUrl,
          fileName: result.suggestedFileName,
          outputBytes: result.blob.size,
          warning,
        })
      },
      (err: unknown) => {
        const s = stateRef.current
        if (s.phase !== 'exporting' || s.handle !== handle) return
        const message = errorMessage(err)
        setState(
          message != null
            ? { phase: 'loaded', media, error: message }
            : { phase: 'loaded', media },
        )
      },
    )
  }, [])

  const cancelExport = useCallback(() => {
    const s = stateRef.current
    if (s.phase !== 'exporting') return
    const activeMedia = s.media
    s.handle.cancel().catch(() => {})
    setState({ phase: 'loaded', media: activeMedia })
  }, [])

  const dismissDone = useCallback(() => {
    const s = stateRef.current
    if (s.phase !== 'done') return
    URL.revokeObjectURL(s.downloadUrl)
    setState({ phase: 'loaded', media: s.media })
  }, [])

  const dismissError = useCallback(() => {
    setState((prev) => {
      if (prev.phase === 'loaded') return { phase: 'loaded', media: prev.media }
      if (prev.phase === 'empty') return { phase: 'empty' }
      return prev
    })
  }, [])

  const errorText =
    state.phase === 'loaded' || state.phase === 'empty'
      ? (state.error ?? null)
      : null
  const firstThumb =
    media != null && media.thumbs.length > 0 ? media.thumbs[0] : null

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-ink">
      <TopBar
        projectName={media ? media.name : null}
        canExport={state.phase === 'loaded' || state.phase === 'done'}
        supported={supported}
        exporting={
          state.phase === 'exporting' ? { progress: state.progress } : null
        }
        onExport={startExport}
        onCancelExport={cancelExport}
      />

      <div className="flex min-h-0 flex-1">
        <MediaPanel
          clip={
            media
              ? {
                  name: media.name,
                  sizeBytes: media.sizeBytes,
                  durationSec: media.durationSec,
                  thumb: firstThumb,
                }
              : null
          }
          disabled={state.phase === 'exporting'}
          onPickFile={pickFile}
        />
        <PreviewStage
          media={media ? { url: media.url, kind: media.kind } : null}
          videoRef={videoRef}
          dropDisabled={state.phase === 'exporting'}
          onLoadedMetadata={onLoadedMetadata}
          onPlayingChange={setPlaying}
          onTogglePlay={togglePlay}
          onDropFile={loadFile}
          onPickFile={pickFile}
        />
      </div>

      <Timeline
        clip={
          media
            ? {
                name: media.name,
                durationSec: media.durationSec,
                thumbs: media.thumbs,
              }
            : null
        }
        currentTime={currentTime}
        playing={playing}
        onTogglePlay={togglePlay}
        onSeek={seek}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,image/*"
        className="hidden"
        onChange={onFileInputChange}
      />

      <div className="fixed bottom-[15rem] right-4 z-40 flex w-80 flex-col gap-2">
        {errorText != null && (
          <div className="flex items-start gap-3 rounded-xl border border-[#ff7a7a]/30 bg-surface p-4 shadow-2xl">
            <p className="min-w-0 flex-1 text-sm text-[#ff9a9a]">{errorText}</p>
            <button
              type="button"
              onClick={dismissError}
              title="Dismiss"
              className="shrink-0 text-muted transition hover:text-ink"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        )}

        {state.phase === 'done' && (
          <div className="rounded-xl border border-edge bg-surface p-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                <IconCheck className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">
                  Export complete — download started
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted">
                  {state.fileName} · {formatBytes(state.outputBytes)}
                </p>
                {state.warning != null && (
                  <p className="mt-2 text-xs text-[#f5c56b]">{state.warning}</p>
                )}
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      triggerDownload(state.downloadUrl, state.fileName)
                    }}
                    className="flex items-center gap-1.5 text-xs font-medium text-accent transition hover:brightness-110"
                  >
                    <IconDownload className="h-3.5 w-3.5" />
                    Download again
                  </button>
                  <button
                    type="button"
                    onClick={dismissDone}
                    className="text-xs text-muted transition hover:text-ink"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
