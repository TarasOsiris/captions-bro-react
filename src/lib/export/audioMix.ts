// The impure shell around lib/model/audio's pure schedule: decode each audible
// clip with the BROWSER's audio decoder (portable — works on Firefox too), then
// play the planned schedule into an OfflineAudioContext.

import { audibleClips, planAudioSchedule } from '@/lib/model/audio'
import { assetOf } from '@/lib/model/selectors'
import type { Project } from '@/lib/model/types'

export const AUDIO_SAMPLE_RATE = 48000
export const AUDIO_CHANNELS = 2

/**
 * Mixes every audible clip into one timeline-length AudioBuffer. Returns null
 * if nothing is audible; any clip without decodable audio (stills, silent
 * video) is skipped.
 */
export async function mixTimelineAudio(
  project: Project,
  total: number,
): Promise<AudioBuffer | null> {
  const frames = Math.ceil(total * AUDIO_SAMPLE_RATE)
  if (frames <= 0) return null
  const ctx = new OfflineAudioContext(AUDIO_CHANNELS, frames, AUDIO_SAMPLE_RATE)

  const clips = audibleClips(project)
  const buffers = new Map<string, AudioBuffer>()
  const durations = new Map<string, number>()
  for (const clip of clips) {
    const asset = assetOf(project, clip)
    if (!asset) continue
    try {
      const bytes = await asset.file.arrayBuffer()
      const buffer = await ctx.decodeAudioData(bytes.slice(0))
      buffers.set(clip.id, buffer)
      durations.set(clip.id, buffer.duration)
    } catch {
      continue // no decodable audio track in this clip
    }
  }

  const schedule = planAudioSchedule(clips, durations)
  if (schedule.length === 0) return null
  for (const entry of schedule) {
    const buffer = buffers.get(entry.clipId)
    if (!buffer) continue
    const node = ctx.createBufferSource()
    node.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = entry.gain
    node.connect(gain).connect(ctx.destination)
    node.start(entry.when, entry.offset, entry.duration)
  }
  return ctx.startRendering()
}
