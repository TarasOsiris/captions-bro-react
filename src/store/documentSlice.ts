// The document slice: the Project tree (tracks → clips) + asset registry, and the
// mutation actions over it. immer drafts make nested updates clean.

import { cloneClip, createProject } from '@/lib/model/factories'
import { uid } from '@/lib/model/ids'
import { clamp } from '@/lib/utils'
import type {
  Clip,
  MediaAsset,
  Project,
  Track,
  Transform,
} from '@/lib/model/types'
import type { ImmerSlice } from './editorStore'

/** Lay a track's clips end-to-end from t=0 — the magnetic model: no gaps, no overlap. */
function repackTrack(track: Track): void {
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
  /** Move a clip to `index` within its own track (index is against the array
   *  excluding the clip), then re-pack the track. */
  moveClipToIndex: (id: string, index: number) => void
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
        const left: Clip = {
          ...clip,
          id: uid('clip'),
          duration: leftDuration,
          transform: { ...clip.transform },
        }
        const right: Clip = {
          ...clip,
          id: uid('clip'),
          start: atTime,
          duration: end - atTime,
          trimIn: clip.trimIn + leftDuration,
          transform: { ...clip.transform },
        }
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
        const copy = cloneClip(track.clips[i])
        newId = copy.id
        track.clips.splice(i + 1, 0, copy)
        repackTrack(track)
        return
      }
    })
    return newId
  },
})
