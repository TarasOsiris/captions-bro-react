// The document slice: the Project tree (tracks → clips) + asset registry, and the
// mutation actions over it. immer drafts make nested updates clean.

import { cloneClip, createProject, createTrack } from '@/lib/model/factories'
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
 * OVERLAY tracks are exempt: text sits wherever it was put, may overlap itself,
 * and must not be dragged to t=0 by a neighbour's trim. This guard is the ONE
 * place that distinction lives — it covers addClipAtIndex, moveClipToIndex,
 * trimClip and duplicateClip at once.
 */
function repackTrack(track: Track): void {
  if (track.type === 'overlay') return
  let t = 0
  for (const clip of track.clips) {
    clip.start = t
    t += clip.duration
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
  /** The overlay (text) track's id, creating it on first use. Appended LAST, so
   *  draw order — which is tracks order — puts text above the video. */
  ensureOverlayTrack: () => string
  /** Set a free-positioned clip's timeline window outright: no re-pack, no
   *  ripple onto neighbours. The overlay counterpart of `trimClip`. */
  setClipWindow: (id: string, start: number, duration: number) => void
  /** Time-based move for a free-positioned clip (the overlay lane's drag). */
  setClipStart: (id: string, start: number) => void
  /** Move a clip to `index` within its own track (index is against the array
   *  excluding the clip), then re-pack the track. */
  moveClipToIndex: (id: string, index: number) => void
  /** Set a clip's source in-point + on-timeline length (edge trim), then re-pack. */
  trimClip: (id: string, trimIn: number, duration: number) => void
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

  ensureOverlayTrack: () => {
    // Captured through a closed-over `let` rather than returned from `set`,
    // matching `duplicateClip` below.
    let trackId = ''
    set((s) => {
      const existing = s.project.tracks.find((t) => t.type === 'overlay')
      if (existing) {
        trackId = existing.id
        return
      }
      const track = createTrack('overlay')
      s.project.tracks.push(track)
      trackId = track.id
    })
    return trackId
  },

  setClipWindow: (id, start, duration) =>
    set((s) => {
      for (const track of s.project.tracks) {
        const clip = track.clips.find((c) => c.id === id)
        if (clip) {
          clip.start = Math.max(0, start)
          clip.duration = Math.max(MIN_CLIP_DURATION, duration)
          return
        }
      }
    }),

  setClipStart: (id, start) =>
    set((s) => {
      for (const track of s.project.tracks) {
        const clip = track.clips.find((c) => c.id === id)
        if (clip) {
          clip.start = Math.max(0, start)
          return
        }
      }
    }),

  moveClipToIndex: (id, index) =>
    set((s) => {
      for (const track of s.project.tracks) {
        const from = track.clips.findIndex((c) => c.id === id)
        if (from < 0) continue
        const [clip] = track.clips.splice(from, 1)
        track.clips.splice(clamp(index, 0, track.clips.length), 0, clip)
        repackTrack(track)
        return
      }
    }),

  trimClip: (id, trimIn, duration) =>
    set((s) => {
      for (const track of s.project.tracks) {
        const clip = track.clips.find((c) => c.id === id)
        if (clip) {
          clip.trimIn = trimIn
          clip.duration = duration
          repackTrack(track)
          return
        }
      }
    }),

  updateClip: (id, patch) =>
    set((s) => {
      for (const track of s.project.tracks) {
        const clip = track.clips.find((c) => c.id === id)
        if (clip) {
          Object.assign(clip, patch)
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
          // Drop an overlay track that just emptied, so the Timeline doesn't
          // carry a permanently blank lane and a text-free project looks exactly
          // as it did before any text existed. Undo restores the whole project,
          // so nothing is lost by pruning.
          if (track.type === 'overlay' && track.clips.length === 0) {
            s.project.tracks = s.project.tracks.filter((t) => t.id !== track.id)
          }
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
      for (const track of s.project.tracks) {
        const i = track.clips.findIndex((c) => c.id === id)
        if (i < 0) continue
        const original = track.clips[i]
        // On a packed track the re-pack below places the copy. On a FREE track
        // nothing moves it, so without an explicit offset it would land exactly
        // on the original and be invisible.
        const copy =
          track.type === 'overlay'
            ? cloneClip(original, { start: original.start + original.duration })
            : cloneClip(original)
        newId = copy.id
        track.clips.splice(i + 1, 0, copy)
        repackTrack(track)
        return
      }
    })
    return newId
  },
})
