// The timeline playback engine: ONE virtual clock advancing `currentTime` from
// the wall-clock delta while playing. The media elements are slaved to it by
// `lib/render/videoSync` — this hook is the React shell around that (the rAF
// loop, the two callbacks the editor drives playback with).
//
// Reads state imperatively via `useEditorStore.getState()` so nothing here causes
// React re-renders.

import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { useEditorStore } from '@/store/editorStore'
import { projectDuration } from '@/lib/model/selectors'
import { primeAndPlay, syncVideos } from '@/lib/render/videoSync'
import { clamp } from '@/lib/math'
import type { MediaPool } from '@/lib/render/mediaPool'

/** Autoplay refused for good: stop the clock and say so, rather than letting
 *  the playhead run on over a frozen frame (which looks like a rendering bug
 *  and exports perfectly fine). */
function onAutoplayRefused() {
  const st = useEditorStore.getState()
  if (!st.playing) return // already handled this attempt
  st.setPlaying(false)
  toast.error('Playback needs a tap — press play again.')
}

const SYNC_CALLBACKS = { onAutoplayRefused }

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
    // Must happen synchronously here, inside the gesture's own task — WebKit
    // refuses a play() issued from the later rAF task (see primeAndPlay).
    if (!st.playing) primeAndPlay(st.project, t, poolRef.current)
    setPlaying(!st.playing)
  }, [poolRef, setCurrentTime, setPlaying])

  const seek = useCallback(
    (t: number) => {
      const st = useEditorStore.getState()
      const total = projectDuration(st.project)
      const clamped = clamp(t, 0, total)
      setCurrentTime(clamped)
      syncVideos(
        st.project,
        clamped,
        poolRef.current,
        st.playing,
        SYNC_CALLBACKS,
      )
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
      syncVideos(st.project, t, poolRef.current, wantPlay, SYNC_CALLBACKS)
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
