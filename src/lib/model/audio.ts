// Clip audio semantics, pure. Shared by the preview (usePlayback sets an
// element's volume) and the export mixer (a GainNode per clip) — they used to
// spell the same rule out separately, and had ALREADY diverged: the mixer used
// an unclamped `clip.volume ?? 1` while the preview clamped to [0,1], so a
// volume above 1 exported louder than it played.

import { clamp } from '@/lib/math'
import { allClips, assetOf } from './selectors'
import type { Clip, Project } from './types'

/** Which clip types can carry sound at all. One rule, so the export mixer, the
 *  silent verdict and the inspector's Audio section cannot disagree about
 *  whether a clip deserves a volume control. */
export function clipCarriesAudio(clip: Pick<Clip, 'type'>): boolean {
  return clip.type === 'video' || clip.type === 'audio'
}

/** Effective gain for a clip: muted is silence, otherwise volume in [0,1]. */
export function clipGain(clip: Pick<Clip, 'volume' | 'muted'>): number {
  if (clip.muted) return 0
  return clamp(clip.volume ?? 1, 0, 1)
}

/** Does the project ask for ANY sound? False when every audio-carrying clip is
 *  muted or at zero — silence the user chose, which the export must not report
 *  as a problem. Asked by BOTH export paths, so the composite path can't warn
 *  about a deliberate mute that the fast path correctly stays quiet about. */
export function intendsAudio(project: Project): boolean {
  return allClips(project).some((c) => clipCarriesAudio(c) && clipGain(c) > 0)
}

/** Clips worth decoding for audio: audible, and backed by an asset. */
export function audibleClips(project: Project): Clip[] {
  return allClips(project).filter(
    (c) =>
      (c.type === 'video' || c.type === 'audio') &&
      clipGain(c) > 0 &&
      assetOf(project, c) != null,
  )
}

/** Whether the project has any audio-bearing clip at all — the question
 *  `ExportResult.silent` answers against the output. */
export function hasAudioClips(project: Project): boolean {
  return allClips(project).some((c) => c.type === 'video' || c.type === 'audio')
}

export interface AudioScheduleEntry {
  clipId: string
  /** Project time to start playback at. */
  when: number
  /** Offset into the decoded source. */
  offset: number
  /** How much of the source to play. Entries with ≤0 are omitted. */
  duration: number
  gain: number
}

/**
 * Where each clip's decoded audio sits on the output timeline. Pure over the
 * decoded source durations, so the scheduling arithmetic — trim clamped to the
 * real source length, zero-length windows dropped — is unit-testable without
 * an OfflineAudioContext. Clips missing from `sourceDurations` had no decodable
 * audio and are skipped.
 */
export function planAudioSchedule(
  clips: ReadonlyArray<Clip>,
  sourceDurations: ReadonlyMap<string, number>,
): AudioScheduleEntry[] {
  const out: AudioScheduleEntry[] = []
  for (const clip of clips) {
    const sourceDuration = sourceDurations.get(clip.id)
    if (sourceDuration == null) continue
    const offset = Math.min(clip.trimIn, sourceDuration)
    const duration = Math.min(
      clip.duration,
      Math.max(0, sourceDuration - offset),
    )
    if (duration <= 0) continue
    out.push({
      clipId: clip.id,
      when: clip.start,
      offset,
      duration,
      gain: clipGain(clip),
    })
  }
  return out
}
