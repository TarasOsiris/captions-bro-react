// The timeline playback engine. A single virtual clock advances `currentTime`
// (wall-clock delta while playing) and the video elements are slaved to it: each
// live clip's <video> plays and is nudged back to its local time only when it
// drifts, so audio stays smooth. Non-live videos are paused. Stills need no sync.
//
// Reads state imperatively via `useEditorStore.getState()` so nothing here causes
// React re-renders.

import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { useEditorStore } from '@/store/editorStore'
import { clipIsLiveAt, projectDuration } from '@/lib/model/selectors'
import { clamp } from '@/lib/utils'
import type { Project } from '@/lib/model/types'
import type { MediaPool } from '@/lib/render/mediaPool'

/** Re-seek a video only when it drifts further than this (seconds) from its
 *  local time — small enough to stay in sync, large enough to avoid stutter. */
const DRIFT = 0.3

function noop() {
  /* a refused prime needs no handling — the clip isn't playing yet anyway */
}

function syncVideos(
  project: Project,
  t: number,
  pool: MediaPool,
  playing: boolean,
) {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.type !== 'video') continue
      const el = pool.videos.get(clip.id)
      if (!el) continue
      const live = clipIsLiveAt(clip, t)
      if (live) {
        const local = clip.trimIn + (t - clip.start)
        if (
          Math.abs(el.currentTime - local) > DRIFT &&
          Number.isFinite(local)
        ) {
          try {
            el.currentTime = local
          } catch {
            // Seeking before metadata is ready throws; the next tick retries.
          }
        }
        el.muted = clip.muted ?? false
        if (playing && el.paused) {
          el.play().catch((err: unknown) => {
            // Autoplay was refused (iOS: play() must originate in the task that
            // handled a user gesture — see primeAndPlay). Stop the virtual clock
            // rather than letting the playhead run on over a frozen frame, which
            // looks like a rendering bug and exports perfectly fine.
            if (
              !(err instanceof DOMException) ||
              err.name !== 'NotAllowedError'
            )
              return
            const st = useEditorStore.getState()
            if (!st.playing) return // already handled this attempt
            st.setPlaying(false)
            toast.error('Playback needs a tap — press play again.')
          })
        } else if (!playing && !el.paused) el.pause()
      } else if (!el.paused) {
        el.pause()
      }
    }
  }
}

/**
 * Start the clips live at `t`, and clear the gesture restriction on the rest.
 *
 * WebKit only lets an element begin playing from inside the task that handled a
 * user gesture. The rAF clock calls `play()` from a LATER task, so on iOS every
 * such call is refused — silently, since the rejection was swallowed. Calling
 * play() here, synchronously inside `togglePlay` (which runs in the click/keydown
 * task), is what actually permits playback.
 *
 * Non-live elements are primed too — play() then an immediate pause() in the same
 * task, so nothing is ever audible — because a clip further down the timeline
 * would otherwise hit the same refusal when the playhead reaches it. They are
 * primed UNMUTED on purpose: priming muted only lifts WebKit's video restriction,
 * not the audio one, so a later unmuted play() would still be blocked.
 */
function primeAndPlay(project: Project, t: number, pool: MediaPool) {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.type !== 'video') continue
      const el = pool.videos.get(clip.id)
      if (!el) continue
      const playing = el.play()
      if (clipIsLiveAt(clip, t)) {
        playing.catch(() => {}) // syncVideos surfaces a real refusal
      } else {
        // Prime-only: stop it again as soon as it starts, so nothing is heard.
        playing.then(() => {
          el.pause()
        }, noop)
      }
    }
  }
}

export function usePlayback(poolRef: React.RefObject<MediaPool>) {
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime)
  const setPlaying = useEditorStore((s) => s.setPlaying)

  const togglePlay = useCallback(() => {
    const st = useEditorStore.getState()
    const total = projectDuration(st.project)
    if (total <= 0) return
    const restart = !st.playing && st.currentTime >= total
    const t = restart ? 0 : st.currentTime
    if (restart) setCurrentTime(0)
    // Must happen synchronously here, inside the gesture's own task — see above.
    if (!st.playing) primeAndPlay(st.project, t, poolRef.current)
    setPlaying(!st.playing)
  }, [poolRef, setCurrentTime, setPlaying])

  const seek = useCallback(
    (t: number) => {
      const st = useEditorStore.getState()
      const total = projectDuration(st.project)
      const clamped = clamp(t, 0, total)
      setCurrentTime(clamped)
      syncVideos(st.project, clamped, poolRef.current, st.playing)
    },
    [poolRef, setCurrentTime],
  )

  useEffect(() => {
    let raf = 0
    let lastTs: number | null = null
    const tick = (ts: number) => {
      const st = useEditorStore.getState()
      const total = projectDuration(st.project)
      let t = st.currentTime
      if (st.playing && lastTs != null && total > 0) {
        t = st.currentTime + (ts - lastTs) / 1000
        if (t >= total) {
          t = total
          setPlaying(false)
        }
        setCurrentTime(t)
      }
      const wantPlay = st.playing && t < total
      syncVideos(st.project, t, poolRef.current, wantPlay)
      lastTs = ts
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [poolRef, setCurrentTime, setPlaying])

  return { togglePlay, seek }
}
