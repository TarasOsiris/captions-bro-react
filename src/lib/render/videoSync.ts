// Slaving the pool's <video> elements to the virtual timeline clock. Not React
// — this is media-element protocol (seek tolerance, WebKit's gesture rule, the
// gain semantics shared with the export mixer), so it lives beside the pool it
// drives rather than inside the hook that calls it.

import { clipGain } from '@/lib/model/audio'
import { resolveScene } from '@/lib/model/scene'
import type { MediaPool } from './mediaPool'
import type { Clip, Project } from '@/lib/model/types'

/** Re-seek a video only when it drifts further than this (seconds) from its
 *  local time — small enough to stay in sync, large enough to avoid stutter. */
const DRIFT = 0.3

function noop() {
  /* a refused prime needs no handling — the clip isn't playing yet anyway */
}

/** Every video element in the pool, with its clip. */
function* videoElements(
  project: Project,
  pool: MediaPool,
): Generator<{ clip: Clip; el: HTMLVideoElement }> {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.type !== 'video') continue
      const el = pool.videos.get(clip.id)
      if (el) yield { clip, el }
    }
  }
}

export interface SyncCallbacks {
  /** Autoplay was refused for good (WebKit's gesture rule). The caller stops
   *  the virtual clock — letting the playhead run on over a frozen frame looks
   *  like a rendering bug, and the export would come out fine, so it must not
   *  be swallowed. */
  onAutoplayRefused: () => void
}

/**
 * Point every live clip's <video> at its local time, play/pause per the clock,
 * and pause everything that isn't on screen.
 *
 * `resolveScene` is the single arbiter of what's on screen; slaving the
 * elements to the same list (its final-frame hold included) keeps decode and
 * draw from disagreeing about a boundary.
 */
export function syncVideos(
  project: Project,
  t: number,
  pool: MediaPool,
  playing: boolean,
  callbacks: SyncCallbacks,
): void {
  const live = new Map(
    resolveScene(project, t).map((item): [string, number] => [
      item.clip.id,
      item.localTime,
    ]),
  )
  for (const { clip, el } of videoElements(project, pool)) {
    const local = live.get(clip.id)
    if (local === undefined) {
      if (!el.paused) el.pause()
      continue
    }
    if (Math.abs(el.currentTime - local) > DRIFT && Number.isFinite(local)) {
      try {
        el.currentTime = local
      } catch {
        // Seeking before metadata is ready throws; the next tick retries.
      }
    }
    el.muted = clip.muted ?? false
    // THE gain rule, shared with the export mixer (lib/model/audio), so
    // overlapping picture-in-picture audio previews exactly as it exports.
    el.volume = clipGain(clip)
    if (playing && el.paused) {
      el.play().catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          callbacks.onAutoplayRefused()
        }
      })
    } else if (!playing && !el.paused) {
      el.pause()
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
export function primeAndPlay(
  project: Project,
  t: number,
  pool: MediaPool,
): void {
  const live = new Set(resolveScene(project, t).map((item) => item.clip.id))
  for (const { clip, el } of videoElements(project, pool)) {
    const playing = el.play()
    if (live.has(clip.id)) {
      playing.catch(() => {
        // syncVideos surfaces a real refusal
      })
    } else {
      // Prime-only: stop it again as soon as it starts, so nothing is heard.
      playing.then(() => {
        el.pause()
      }, noop)
    }
  }
}
