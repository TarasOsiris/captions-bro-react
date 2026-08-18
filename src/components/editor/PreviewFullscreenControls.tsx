// The player bar shown over the fullscreen preview: play/pause, a scrub bar,
// the timecode and the exit control. Rendered ONLY while fullscreen, as a
// sibling of the aspect frame inside PreviewStage's promoted `<section>`.
//
// `absolute`, never `fixed`: `container-type: size` on the section implies
// `contain: layout`, which makes it the containing block for fixed descendants
// — a `fixed bottom-0` here would resolve against the section anyway and be a
// lie the next person trips over.
//
// The 60fps rules from CLAUDE.md are the reason this is its own component:
// PreviewStage subscribes to `project` wholesale, so anything that re-renders
// per frame has to live below it, and the playhead itself is written to the DOM
// imperatively rather than through React at all.

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Minimize, Pause, Play } from 'lucide-react'
import { useEditorStore } from '@/store/editorStore'
import { projectDuration } from '@/lib/model/selectors'
import { formatTimecode } from '@/lib/media'
import { isPrimaryPointer, releaseCapture } from '@/lib/pointer'
import { rafThrottle } from '@/lib/raf'
import { clamp } from '@/lib/math'

/** How long the bar stays up after the last input WHILE PLAYING. It never
 *  auto-hides on a paused frame: there would be no visible way back out. */
const HIDE_DELAY_MS = 2600

/**
 * The timecode, in its own leaf.
 *
 * Subscribed to the FORMATTED string, not to `currentTime`: the value only
 * changes at the precision it displays (tenths), so this re-renders ~10×/s
 * instead of every frame, and nothing above it re-renders at all. The formatter
 * is the shared `formatTimecode` — a second one here is the `19rem` drift.
 */
const Timecode = memo(function Timecode() {
  const now = useEditorStore((s) => formatTimecode(s.currentTime))
  const total = useEditorStore((s) =>
    formatTimecode(projectDuration(s.project)),
  )
  return (
    <div className="whitespace-nowrap font-mono text-xs tabular-nums text-white/90">
      {now} <span className="text-white/50">/ {total}</span>
    </div>
  )
})

export const PreviewFullscreenControls = memo(
  function PreviewFullscreenControls({
    onTogglePlay,
    onSeek,
    onExit,
  }: {
    onTogglePlay: () => void
    onSeek: (t: number) => void
    onExit: () => void
  }) {
    const playing = useEditorStore((s) => s.playing)
    const exitRef = useRef<HTMLButtonElement>(null)
    const trackRef = useRef<HTMLDivElement>(null)
    const fillRef = useRef<HTMLDivElement>(null)
    const knobRef = useRef<HTMLDivElement>(null)
    const scrubRef = useRef<number | null>(null)

    // ── Auto-hide ───────────────────────────────────────────────────────────
    // The reveal listeners live HERE, on window, so a mouse move over the video
    // never re-renders PreviewStage. `visibleRef` mirrors the state so a move
    // while the bar is already up costs a timer reset and nothing else.
    const [visible, setVisible] = useState(true)
    const visibleRef = useRef(true)
    useEffect(() => {
      if (!playing) {
        visibleRef.current = true
        setVisible(true)
        return
      }
      let timer = 0
      const arm = () => {
        window.clearTimeout(timer)
        if (!visibleRef.current) {
          visibleRef.current = true
          setVisible(true)
        }
        timer = window.setTimeout(() => {
          visibleRef.current = false
          setVisible(false)
        }, HIDE_DELAY_MS)
      }
      arm()
      window.addEventListener('pointermove', arm)
      window.addEventListener('pointerdown', arm)
      window.addEventListener('keydown', arm)
      return () => {
        window.clearTimeout(timer)
        window.removeEventListener('pointermove', arm)
        window.removeEventListener('pointerdown', arm)
        window.removeEventListener('keydown', arm)
      }
    }, [playing])

    // Hand focus over on mount — the control that opened fullscreen is now
    // covered, and leaving focus on `<body>` puts a stray Backspace one keypress
    // from deleting the selected clip (useEditorKeyboard is on window).
    useEffect(() => {
      exitRef.current?.focus()
    }, [])

    // ── The playhead, written imperatively ──────────────────────────────────
    // A controlled Radix Slider bound to `currentTime` would reconcile
    // Root/Track/Range/Thumb on every frame. This is the same shape as the
    // timeline's playhead-follow: a store subscription, rAF-coalesced, touching
    // two style properties.
    useEffect(() => {
      const paint = rafThrottle((t: number) => {
        const total = projectDuration(useEditorStore.getState().project)
        const pct = `${(total > 0 ? clamp(t / total, 0, 1) * 100 : 0).toFixed(3)}%`
        if (fillRef.current) fillRef.current.style.width = pct
        if (knobRef.current) knobRef.current.style.left = pct
      })
      paint(useEditorStore.getState().currentTime)
      const unsub = useEditorStore.subscribe((s) => s.currentTime, paint)
      return () => {
        paint.cancel()
        unsub()
      }
    }, [])

    // ── Scrub ───────────────────────────────────────────────────────────────
    const seekFromClientX = useCallback(
      (clientX: number) => {
        const el = trackRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        if (r.width <= 0) return
        const total = projectDuration(useEditorStore.getState().project)
        onSeek(clamp((clientX - r.left) / r.width, 0, 1) * total)
      },
      [onSeek],
    )

    const onTrackDown = (e: React.PointerEvent) => {
      if (!isPrimaryPointer(e) || scrubRef.current != null) return
      scrubRef.current = e.pointerId
      e.currentTarget.setPointerCapture(e.pointerId)
      seekFromClientX(e.clientX)
    }
    const onTrackMove = (e: React.PointerEvent) => {
      // Only the pointer that started the scrub may drive it.
      if (scrubRef.current !== e.pointerId) return
      seekFromClientX(e.clientX)
    }
    const endScrub = (e: React.PointerEvent) => {
      if (scrubRef.current !== e.pointerId) return
      scrubRef.current = null
      releaseCapture(e.currentTarget, e.pointerId)
    }

    return (
      <div
        // The wrapper never eats a pointer; only the two controls do, so a tap
        // on the video still reaches the reveal listener above.
        className={`pointer-events-none absolute inset-0 z-30 transition-opacity duration-200 motion-reduce:transition-none ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden={!visible}
      >
        <button
          ref={exitRef}
          type="button"
          onClick={onExit}
          aria-label="Exit fullscreen"
          // A raw <button>, not the `icon` Button: its `after:-inset-2` hit-area
          // growth would overhang the safe-area gutter it is pinned inside.
          className="pointer-events-auto absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white/90 backdrop-blur transition hover:bg-black/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40"
        >
          <Minimize className="h-5 w-5" />
        </button>

        <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-10">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition hover:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            {playing ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5 translate-x-px" />
            )}
          </button>

          <div
            ref={trackRef}
            onPointerDown={onTrackDown}
            onPointerMove={onTrackMove}
            onPointerUp={endScrub}
            onPointerCancel={endScrub}
            // `touch-none`: a drag here is never a scroll (the touch-action
            // table in CLAUDE.md). The transparent ::after lifts the hit area
            // to a thumb without moving the line the user reads as the seek bar.
            className="relative h-1.5 flex-1 cursor-pointer touch-none rounded-full bg-white/25 after:absolute after:-inset-y-3 after:inset-x-0 after:content-['']"
          >
            <div
              ref={fillRef}
              className="absolute inset-y-0 left-0 rounded-full bg-white"
              style={{ width: '0%' }}
            />
            <div
              ref={knobRef}
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
              style={{ left: '0%' }}
            />
          </div>

          <Timecode />
        </div>
      </div>
    )
  },
)
