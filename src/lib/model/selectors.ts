// Pure lookups over the document tree. Keep SSR-safe and testable.

import { clamp } from '@/lib/math'
import { createTrack } from './factories'
import type { Clip, MediaAsset, Project, Track } from './types'

/** Every clip across all tracks, in track order. */
export function allClips(project: Project): Clip[] {
  return project.tracks.flatMap((t) => t.clips)
}

/** Every clip backed by an imported file — what the media bin lists. Generated
 *  clips (text, and any future generated type) have no `assetId` and are NOT
 *  media: the bin is the collection of available photos and videos, so a text
 *  overlay must never show up there. Filter on `assetId`, not `type`, so a new
 *  generated clip type is excluded by construction. */
export function mediaClips(project: Project): Clip[] {
  return allClips(project).filter((c) => c.assetId != null)
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

/** The track new clips land on. Single video track today; when an explicit
 *  "active track" arrives, it changes here and nowhere else.
 *
 *  The `?? tracks[0]` fallback was typed as always-present but is `undefined`
 *  at runtime for a track-less project (which `replaceProject` can install
 *  from a hand-built or corrupt document). Creating one keeps the return type
 *  honest — callers get a real track to add to, not a crash one frame later. */
export function videoTrack(project: Project): Track {
  const found = project.tracks.find((t) => t.type === 'video')
  if (found) return found
  // `tracks[0]` is TYPED as always present (noUncheckedIndexedAccess is off),
  // so the length check is the only thing standing between a track-less
  // document and an `undefined` handed out as a `Track`.
  if (project.tracks.length > 0) return project.tracks[0]
  return createTrack('video')
}

/** Every overlay lane, in array order (bottom of the stack first — z-order).
 *  Lanes are created lazily on insert and pruned when their last clip goes, so
 *  a text-free project has none. Sibling of `videoTrack`: track routing lives
 *  here and nowhere else. */
export function overlayTracks(project: Project): Track[] {
  return project.tracks.filter(isFreeLane)
}

/**
 * The distinction the editor actually branches on — NOT the three track types.
 *
 * A FREE lane holds clips at arbitrary times (text and picture-in-picture);
 * they never overlap a lane sibling, but nothing packs them. A MAGNETIC track
 * (the one main video track) is laid gapless from t=0, so any edit ripples
 * through its neighbours. Named predicates because the raw
 * `track.type === 'overlay'` test appeared at a dozen sites and reads as an
 * implementation detail rather than the rule it encodes.
 */
export function isFreeLane(track: Track): boolean {
  return track.type === 'overlay'
}

export function isMagnetic(track: Track): boolean {
  return !isFreeLane(track)
}

/** Every edge a free-positioned clip can snap to: 0, the playhead, and both ends
 *  of every other clip. Excludes `excludeId` so a clip never snaps to itself. */
export function snapTargets(
  project: Project,
  playhead: number,
  excludeId?: string,
): number[] {
  const targets = [0, playhead]
  for (const clip of allClips(project)) {
    if (clip.id === excludeId) continue
    targets.push(clip.start, clip.start + clip.duration)
  }
  return targets
}

/** `t` pulled to the nearest target within `tolerance`, else left alone. Pure so
 *  the overlay drag's snapping is unit-testable without a DOM. */
export function snapTime(
  t: number,
  targets: number[],
  tolerance: number,
): number {
  let best = t
  let bestDist = tolerance
  for (const target of targets) {
    const dist = Math.abs(t - target)
    if (dist < bestDist) {
      bestDist = dist
      best = target
    }
  }
  return best
}

/** Whether `clip` is on screen at time `t`. Half-open `[start, end)` — start
 *  inclusive, end exclusive — so at a gapless boundary the later clip wins
 *  outright, with no reliance on draw order. The one per-clip definition of the
 *  live window, shared by `resolveScene`, the playback element sync and the
 *  selection UI so they can't disagree about a boundary. `resolveScene` layers
 *  the final-frame hold (see there) on top for the exact timeline end. */
export function clipIsLiveAt(clip: Clip, t: number): boolean {
  return t >= clip.start && t < clip.start + clip.duration
}

/** Where to move the playhead so `clip` is actually visible, or null if `t`
 *  already sits on it. Selecting a clip whose range excludes the playhead would
 *  otherwise show the selection over unrelated footage. */
export function revealTime(clip: Clip, t: number): number | null {
  return clipIsLiveAt(clip, t) ? null : clip.start
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

/** The timeline window an edge trim proposes for a FREE-POSITIONED clip: the
 *  left edge moves `start` with the trim (end pinned — nothing re-packs a free
 *  lane), the right edge leaves `start` alone. A magnetic track ignores the
 *  start (its re-pack owns it), so the caller needs no track-type branch. */
export function freeTrimWindow(
  edge: 'left' | 'right',
  orig: { start: number; duration: number },
  next: { trimIn: number; duration: number },
): { start: number; trimIn: number; duration: number } {
  return {
    start:
      edge === 'left'
        ? orig.start + (orig.duration - next.duration)
        : orig.start,
    trimIn: next.trimIn,
    duration: next.duration,
  }
}

/** Total timeline duration = the furthest clip end across all tracks. */
export function projectDuration(project: Project): number {
  let end = 0
  for (const clip of allClips(project)) {
    end = Math.max(end, clip.start + clip.duration)
  }
  return end
}
