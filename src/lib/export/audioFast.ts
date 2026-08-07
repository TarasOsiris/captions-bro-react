// How the FAST PATH honours a clip's volume — pure, so the decision is
// unit-tested rather than buried in the mediabunny call.
//
// The bug this exists to close: `exportVideo` passes `audio: { codec: 'aac' }`
// with NO `forceTranscode`, so an AAC source is PACKET-COPIED — encoded frames
// moved across untouched. That is deliberate and load-bearing (it keeps audio
// on browsers with no AAC encoder, e.g. Firefox), but it also means a gain can
// never be applied to a copied packet. The preview (`videoSync`) and the
// timeline mixer (`audioMix`) both DO apply `clipGain`, so before this the
// inspector's volume slider changed the preview and not the export.
//
// The resolution is three modes rather than a blanket transcode:
//
//   gain 1  → copy    (byte-identical to the old behaviour; Firefox keeps audio)
//   gain 0  → discard (exact silence, and needs no encoder at all)
//   0<g<1   → gain    (decode → scale → re-encode; only when actually asked for)
//
// Note what is NOT done: rerouting to `exportTimeline`. That path is silent
// wherever there is no AAC encoder, so it would trade a wrong volume for no
// audio at all — and it re-encodes the video frame-by-frame as well.

import { clipGain } from '@/lib/model/audio'
import type { Clip } from '@/lib/model/types'

export type FastAudioMode =
  /** Leave the audio track alone — packet-copy where the codec allows. */
  | { kind: 'copy' }
  /** Drop the audio track outright. */
  | { kind: 'discard' }
  /** Decode, scale by `gain` (strictly between 0 and 1), re-encode. */
  | { kind: 'gain'; gain: number }

/** The mode for a clip. Volume semantics come from `clipGain` — muted beats
 *  volume, and out-of-range values clamp — so this file never restates them. */
export function fastAudioMode(
  clip: Pick<Clip, 'volume' | 'muted'>,
): FastAudioMode {
  const gain = clipGain(clip)
  if (gain >= 1) return { kind: 'copy' }
  if (gain <= 0) return { kind: 'discard' }
  return { kind: 'gain', gain }
}

/** Scale interleaved f32 PCM in place, returning the same array. The only
 *  arithmetic in the gain path, and the only part worth a test. */
export function applyGain(samples: Float32Array, gain: number): Float32Array {
  for (let i = 0; i < samples.length; i += 1) samples[i] *= gain
  return samples
}
