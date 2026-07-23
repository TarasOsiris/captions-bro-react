// Pure lookups over the document tree. Keep SSR-safe and testable.

import { clamp } from '@/lib/math'
import type { Clip, MediaAsset, Project, Track } from './types'

/** Every clip across all tracks, in track order. */
export function allClips(project: Project): Clip[] {
  return project.tracks.flatMap((t) => t.clips)
}

/** The first clip in document order, or null. In the single-clip MVP this is the
 *  "active" clip; multi-track selection supersedes it later. */
export function firstClip(project: Project): Clip | null {
  for (const track of project.tracks) {
    if (track.clips.length > 0) return track.clips[0]
  }
  return null
}

export function clipById(project: Project, id: string | null): Clip | null {
  if (id == null) return null
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === id)
    if (clip) return clip
  }
  return null
}

export function trackOfClip(project: Project, id: string): Track | null {
  return project.tracks.find((t) => t.clips.some((c) => c.id === id)) ?? null
}

export function assetOf(
  project: Project,
  clip: Clip | null,
): MediaAsset | null {
  if (!clip || clip.assetId == null) return null
  return project.assets[clip.assetId] ?? null
}

/** Natural aspect ratio of a clip's asset, or null until dimensions are known. */
export function clipAspect(project: Project, clip: Clip | null): number | null {
  const asset = assetOf(project, clip)
  if (!asset || asset.naturalWidth <= 0 || asset.naturalHeight <= 0) return null
  return asset.naturalWidth / asset.naturalHeight
}

/** Insertion slot for a clip dropped/moved to `time`: the number of clips
 *  (optionally excluding `excludeId`) whose midpoint sits at or before `time`.
 *  On a packed track this is the array index to splice at. Drives the magnetic
 *  drop indicator and the reposition target. */
export function insertionIndex(
  clips: Clip[],
  time: number,
  excludeId?: string,
): number {
  let index = 0
  for (const clip of clips) {
    if (clip.id === excludeId) continue
    if (clip.start + clip.duration / 2 <= time) index++
  }
  return index
}

/** Resolve an edge-trim drag into a clip's new `{ trimIn, duration }`. `deltaSec` is
 *  the signed distance the dragged edge moved. Clamped so the clip stays
 *  ≥ `minDuration`, `trimIn` ≥ 0, and (for a bounded source) the out-point stays
 *  within `sourceLen` (pass Infinity for stills / unknown length). */
export function resolveTrim(
  edge: 'left' | 'right',
  clip: { trimIn: number; duration: number },
  deltaSec: number,
  sourceLen: number,
  minDuration: number,
): { trimIn: number; duration: number } {
  if (edge === 'right') {
    // Never below the current length — so a clip whose stored duration already
    // exceeds the source (rare) can't snap shorter on an outward drag.
    const maxDuration = Math.max(clip.duration, sourceLen - clip.trimIn)
    return {
      trimIn: clip.trimIn,
      duration: clamp(clip.duration + deltaSec, minDuration, maxDuration),
    }
  }
  // Head trim: h>0 removes from the start (trimIn↑, duration↓); h<0 restores it.
  const h = clamp(deltaSec, -clip.trimIn, clip.duration - minDuration)
  return { trimIn: clip.trimIn + h, duration: clip.duration - h }
}

/** Total timeline duration = the furthest clip end across all tracks. */
export function projectDuration(project: Project): number {
  let end = 0
  for (const clip of allClips(project)) {
    end = Math.max(end, clip.start + clip.duration)
  }
  return end
}
