// The timeline playback engine. A single virtual clock advances `currentTime`
// (wall-clock delta while playing) and the video elements are slaved to it: each
// live clip's <video> plays and is nudged back to its local time only when it
// drifts, so audio stays smooth. Non-live videos are paused. Stills need no sync.
//
// Reads state imperatively via `useEditorStore.getState()` so nothing here causes
// React re-renders.

import { useCallback, useEffect } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { projectDuration } from '@/lib/model/selectors'
import { clamp } from '@/lib/utils'
import type { Project } from '@/lib/model/types'
import type { MediaPool } from '@/lib/render/mediaPool'

/** Re-seek a video only when it drifts further than this (seconds) from its
 *  local time — small enough to stay in sync, large enough to avoid stutter. */
const DRIFT = 0.3

function syncVideos(project: Project, t: number, pool: MediaPool, playing: boolean) {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.type !== 'video') continue
      const el = pool.videos.get(clip.id)
      if (!el) continue
      const live = t >= clip.start && t <= clip.start + clip.duration
      if (live) {
        const local = clip.trimIn + (t - clip.start)
        if (Math.abs(el.currentTime - local) > DRIFT && Number.isFinite(local)) {
          try {
            el.currentTime = local
          } catch {
            // Seeking before metadata is ready throws; the next tick retries.
          }
        }
        el.muted = clip.muted ?? false
        if (playing && el.paused) el.play().catch(() => {})
        else if (!playing && !el.paused) el.pause()
      } else if (!el.paused) {
        el.pause()
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
    if (!st.playing && st.currentTime >= total) setCurrentTime(0)
    setPlaying(!st.playing)
  }, [setCurrentTime, setPlaying])

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
