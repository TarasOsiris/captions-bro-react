// The document slice: the Project tree (tracks → clips) + asset registry, and the
// mutation actions over it. immer drafts make nested updates clean.

import { cloneClip, createProject, createTrack } from '@/lib/model/factories'
import {
  clampTrimToLane,
  laneHasRoom,
  resolveLaneStart,
} from '@/lib/model/lanes'
import { trackOfClip } from '@/lib/model/selectors'
import { clamp } from '@/lib/utils'
import type {
  Clip,
  MediaAsset,
  Project,
  Track,
  Transform,
} from '@/lib/model/types'
import type { ImmerSlice } from './editorStore'

/** Shortest a clip can be, matching the Timeline's trim floor. */
const MIN_CLIP_DURATION = 0.1

/**
 * Lay a track's clips end-to-end from t=0 — the magnetic model: no gaps, no
 * overlap.
 *
 * OVERLAY tracks are exempt: their clips are free-positioned — they sit where
 * they were put (never overlapping a lane sibling; the lane geometry in
 * lib/model/lanes.ts clamps that) and must not be dragged to t=0 by a
 * neighbour's trim. This guard is the ONE place that distinction lives — it
 * covers addClipAtIndex, moveClipToTrack, setClipTrimWindow and duplicateClip
 * at once.
 */
function repackTrack(track: Track): void {
  if (track.type === 'overlay') return
  let t = 0
  for (const clip of track.clips) {
    clip.start = t
    t += clip.duration
  }
}

/** Take `clip` off `track` (re-packing a magnetic one behind it). */
function detachClip(track: Track, clip: Clip): void {
  track.clips.splice(track.clips.indexOf(clip), 1)
  repackTrack(track)
}

/** Position `clip` at `start` on `track` — clamped into a free gap on a lane,
 *  floored at 0 on a magnetic track. The ONE encoding of the lane-placement
 *  clamp shared by every action that sets a start. */
function placeClipStart(track: Track, clip: Clip, start: number): void {
  clip.start =
    track.type === 'overlay'
      ? resolveLaneStart(track.clips, start, clip.duration, clip.id)
      : Math.max(0, start)
}

/** A fresh overlay lane spliced directly ABOVE array position `index`
 *  (array order is z-order, bottom first). */
function spliceLaneAbove(project: Project, index: number): Track {
  const lane = createTrack('overlay')
  project.tracks.splice(index + 1, 0, lane)
  return lane
}

/** Drop `track` if it is an overlay lane that just emptied, so the Timeline
 *  doesn't carry a permanently blank lane and a text-free project looks
 *  exactly as it did before any text existed. Undo restores the whole
 *  project, so nothing is lost by pruning. */
function pruneEmptyOverlayTrack(project: Project, track: Track): void {
  if (track.type === 'overlay' && track.clips.length === 0) {
    project.tracks = project.tracks.filter((t) => t.id !== track.id)
  }
}

export interface DocumentSlice {
  project: Project
  /** Full replace — used by document load and undo/redo restore. */
  replaceProject: (project: Project) => void
  addAsset: (asset: MediaAsset) => void
  updateAsset: (id: string, patch: Partial<MediaAsset>) => void
  /** Append a clip to a track (defaults to the first video track). */
  addClip: (clip: Clip, trackId?: string) => void
  /** Insert a clip into a track at `index`, then re-pack the track (no gaps/overlap). */
  addClipAtIndex: (clip: Clip, trackId: string, index: number) => void
  /** Create a new overlay lane and return its id. With `belowTrackId` it lands
   *  directly ABOVE that track in the stack (array order is z-order, bottom
   *  first); without, on top of everything. */
  addOverlayTrack: (belowTrackId?: string) => string
  /** Set a clip's timeline window outright: no ripple onto neighbours (on an
   *  overlay lane the window is clamped into a free gap). The Inspector's
   *  timing fields. */
  setClipWindow: (id: string, start: number, duration: number) => void
  /** Move a clip to a track — its own included (a plain reorder/re-time).
   *  `{ index }` splices into a magnetic track and re-packs, `{ start }`
   *  free-positions on an overlay lane (clamped into a gap). An overlay
   *  source that empties is pruned. Text never joins a magnetic track — such
   *  a call is a no-op. */
  moveClipToTrack: (
    id: string,
    trackId: string,
    at: { index: number } | { start: number },
  ) => void
  /** Move a clip onto a brand-new overlay lane directly above `belowTrackId`
   *  (the seam drop). Prunes the emptied overlay source. */
  moveClipToNewTrack: (id: string, belowTrackId: string, start: number) => void
  /** Commit an edge trim as a whole window. The magnetic-vs-free routing
   *  lives HERE, not in the caller: on a free lane the window (whose start
   *  follows the left edge — see `freeTrimWindow`) clamps flush against lane
   *  neighbours; on a magnetic track the re-pack owns `start` (the proposal's
   *  is ignored) and neighbours ripple. */
  setClipTrimWindow: (
    id: string,
    next: { start: number; trimIn: number; duration: number },
  ) => void
  updateClip: (id: string, patch: Partial<Clip>) => void
  setClipTransform: (id: string, transform: Transform) => void
  removeClip: (id: string) => void
  /** Split the clip at project time `atTime` into two adjacent clips. */
  splitClip: (id: string, atTime: number) => void
  /** Copy the clip, placed immediately after it on the same track. */
  duplicateClip: (id: string) => string | null
}

export const createDocumentSlice: ImmerSlice<DocumentSlice> = (set) => ({
  project: createProject(),

  replaceProject: (project) =>
    set((s) => {
      s.project = project
    }),

  addAsset: (asset) =>
    set((s) => {
      s.project.assets[asset.id] = asset
    }),

  updateAsset: (id, patch) =>
    set((s) => {
      if (Object.hasOwn(s.project.assets, id)) {
        Object.assign(s.project.assets[id], patch)
      }
    }),

  addClip: (clip, trackId) =>
    set((s) => {
      const track = trackId
        ? s.project.tracks.find((t) => t.id === trackId)
        : (s.project.tracks.find((t) => t.type === 'video') ??
          s.project.tracks[0])
      if (track) track.clips.push(clip)
    }),

  addClipAtIndex: (clip, trackId, index) =>
    set((s) => {
      const track = s.project.tracks.find((t) => t.id === trackId)
      if (!track) return
      track.clips.splice(clamp(index, 0, track.clips.length), 0, clip)
      repackTrack(track)
    }),

  addOverlayTrack: (belowTrackId) => {
    // Captured through a closed-over `let` rather than returned from `set`,
    // matching `duplicateClip` below.
    let trackId = ''
    set((s) => {
      const track = createTrack('overlay')
      const below = belowTrackId
        ? s.project.tracks.findIndex((t) => t.id === belowTrackId)
        : -1
      if (below >= 0) s.project.tracks.splice(below + 1, 0, track)
      else s.project.tracks.push(track)
      trackId = track.id
    })
    return trackId
  },

  setClipWindow: (id, start, duration) =>
    set((s) => {
      for (const track of s.project.tracks) {
        const clip = track.clips.find((c) => c.id === id)
        if (clip) {
          clip.duration = Math.max(MIN_CLIP_DURATION, duration)
          placeClipStart(track, clip, start)
          return
        }
      }
    }),

  moveClipToTrack: (id, trackId, at) =>
    set((s) => {
      const source = trackOfClip(s.project, id)
      const target = s.project.tracks.find((t) => t.id === trackId)
      if (!source || !target) return
      const clip = source.clips.find((c) => c.id === id)!
      // Text is generated content — it never joins the magnetic media track.
      if (clip.type === 'text' && target.type !== 'overlay') return
      detachClip(source, clip)
      if ('index' in at) {
        target.clips.splice(clamp(at.index, 0, target.clips.length), 0, clip)
        repackTrack(target)
      } else {
        placeClipStart(target, clip, at.start)
        target.clips.push(clip)
      }
      if (source.id !== target.id) pruneEmptyOverlayTrack(s.project, source)
    }),

  moveClipToNewTrack: (id, belowTrackId, start) =>
    set((s) => {
      const source = trackOfClip(s.project, id)
      const below = s.project.tracks.findIndex((t) => t.id === belowTrackId)
      if (!source || below < 0) return
      const clip = source.clips.find((c) => c.id === id)!
      // A sole occupant dropped into the seam beside its own lane: the fresh
      // lane would sit exactly where the pruned one was — a structural no-op,
      // so just set the time (and don't churn track ids under the UI).
      if (
        source.type === 'overlay' &&
        source.clips.length === 1 &&
        (source.id === belowTrackId ||
          s.project.tracks[below + 1]?.id === source.id)
      ) {
        clip.start = Math.max(0, start)
        return
      }
      detachClip(source, clip)
      clip.start = Math.max(0, start)
      spliceLaneAbove(s.project, below).clips.push(clip)
      pruneEmptyOverlayTrack(s.project, source)
    }),

  setClipTrimWindow: (id, next) =>
    set((s) => {
      for (const track of s.project.tracks) {
        const clip = track.clips.find((c) => c.id === id)
        if (!clip) continue
        if (track.type === 'overlay') {
          const w = clampTrimToLane(track.clips, id, next)
          clip.start = Math.max(0, w.start)
          clip.trimIn = Math.max(0, w.trimIn)
          clip.duration = Math.max(MIN_CLIP_DURATION, w.duration)
        } else {
          // Magnetic: the re-pack owns `start`; only the trim fields apply.
          clip.trimIn = Math.max(0, next.trimIn)
          clip.duration = Math.max(MIN_CLIP_DURATION, next.duration)
          repackTrack(track)
        }
        return
      }
    }),

  updateClip: (id, patch) =>
    set((s) => {
      for (const track of s.project.tracks) {
        const clip = track.clips.find((c) => c.id === id)
        if (clip) {
          Object.assign(clip, patch)
          // Keep the lane no-overlap invariant un-bypassable: a timing patch
          // on a lane clip (e.g. a video learning its real duration from
          // metadata) re-clamps it into a free gap, the same way repackTrack
          // makes the magnetic invariant survive any mutation.
          if (
            track.type === 'overlay' &&
            (patch.start !== undefined || patch.duration !== undefined)
          ) {
            placeClipStart(track, clip, clip.start)
          }
          return
        }
      }
    }),

  setClipTransform: (id, transform) =>
    set((s) => {
      for (const track of s.project.tracks) {
        const clip = track.clips.find((c) => c.id === id)
        if (clip) {
          clip.transform = transform
          return
        }
      }
    }),

  removeClip: (id) =>
    set((s) => {
      for (const track of s.project.tracks) {
        const i = track.clips.findIndex((c) => c.id === id)
        if (i >= 0) {
          track.clips.splice(i, 1)
          pruneEmptyOverlayTrack(s.project, track)
          return
        }
      }
    }),

  splitClip: (id, atTime) =>
    set((s) => {
      for (const track of s.project.tracks) {
        const i = track.clips.findIndex((c) => c.id === id)
        if (i < 0) continue
        const clip = track.clips[i]
        const end = clip.start + clip.duration
        // Only split when the cut is strictly inside the clip.
        if (atTime <= clip.start || atTime >= end) return
        const leftDuration = atTime - clip.start
        // `cloneClip` so nested value objects (transform.crop, textStyle) are
        // copied rather than shared between the two halves.
        const left = cloneClip(clip, { duration: leftDuration })
        const right = cloneClip(clip, {
          start: atTime,
          duration: end - atTime,
          // Generated content has no source timeline to advance into — a text
          // clip's second half must keep showing the same text from its start.
          trimIn:
            clip.type === 'text' ? clip.trimIn : clip.trimIn + leftDuration,
        })
        // Both halves carry explicit starts, so no re-pack is needed either way.
        track.clips.splice(i, 1, left, right)
        return
      }
    }),

  duplicateClip: (id) => {
    let newId: string | null = null
    set((s) => {
      for (const [trackIndex, track] of s.project.tracks.entries()) {
        const i = track.clips.findIndex((c) => c.id === id)
        if (i < 0) continue
        const original = track.clips[i]
        // On a packed track the re-pack below places the copy. On a FREE track
        // nothing moves it, so it goes right after the original — unless a lane
        // sibling already sits there, in which case the copy lands on a fresh
        // lane directly above, at the original's own time.
        if (track.type === 'overlay') {
          const after = original.start + original.duration
          const fits = laneHasRoom(track.clips, after, original.duration)
          const copy = cloneClip(original, fits ? { start: after } : undefined)
          newId = copy.id
          if (fits) track.clips.splice(i + 1, 0, copy)
          else spliceLaneAbove(s.project, trackIndex).clips.push(copy)
          return
        }
        const copy = cloneClip(original)
        newId = copy.id
        track.clips.splice(i + 1, 0, copy)
        repackTrack(track)
        return
      }
    })
    return newId
  },
})
