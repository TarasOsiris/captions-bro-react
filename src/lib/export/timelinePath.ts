// The multi-clip compositor: every output frame is drawn with the SAME
// `drawScene` + `sceneDrawItems` the preview uses, from a VideoSampleSink per
// video clip and a decoded bitmap per image asset. Audio from every clip is
// mixed into one track where an AAC encoder exists.

import { drawScene } from '@/lib/render/compositor'
import {
  bitmapSource,
  sceneDrawItems,
  videoSampleSource,
} from '@/lib/render/sceneItems'
import { resolveScene } from '@/lib/model/scene'
import { allClips, assetOf, projectDuration } from '@/lib/model/selectors'
import { intendsAudio } from '@/lib/model/audio'
import { ensureProjectFonts } from '@/lib/text/fontLoader'
import { mixTimelineAudio } from './audioMix'
import { CancelToken, toHandle } from './cancel'
import { makeOutputSurface } from './canvas'
import { ExportInvalidFileError, ExportUnsupportedError } from './errors'
import { runFrameLoop } from './frameLoop'
import { ResourceBag } from './resources'
import { makeResult } from './result'
import type { ExportHandle, ExportResult } from './types'
import type { Project } from '@/lib/model/types'

const TIMELINE_FPS = 30

export function exportTimeline(
  project: Project,
  opts: {
    fileName: string
    onProgress?: (fraction: number) => void
    /** Hands out the compositing surface, for the live preview (see videoPath). */
    onSurface?: (el: HTMLCanvasElement) => void
  },
): ExportHandle {
  const token = new CancelToken()

  const done = (async (): Promise<ExportResult> => {
    const mb = await import('mediabunny')
    if (!(await mb.canEncodeVideo('avc'))) throw new ExportUnsupportedError()
    // Resolve webfonts BEFORE any frame is drawn — otherwise the first frames
    // encode in the fallback face and the output doesn't match the preview.
    await ensureProjectFonts(project)
    const total = projectDuration(project)
    if (total <= 0) throw new ExportInvalidFileError('The timeline is empty.')

    const surface = makeOutputSurface(project.canvas)
    const out = surface.out
    opts.onSurface?.(surface.el)

    // One decoder per video clip; one decoded bitmap per referenced image asset.
    // Everything acquired here is registered with the bag and released in the
    // `finally` below — an Input that is never disposed keeps its decoders
    // alive for the life of the tab.
    const bag = new ResourceBag()
    const sinks = new Map<string, InstanceType<typeof mb.VideoSampleSink>>()
    const bitmaps = new Map<string, ImageBitmap>()
    try {
      try {
        for (const clip of allClips(project)) {
          const asset = assetOf(project, clip)
          if (!asset) continue
          if (clip.type === 'video') {
            const input = new mb.Input({
              formats: mb.ALL_FORMATS,
              source: new mb.BlobSource(asset.file),
            })
            bag.add(() => {
              input.dispose()
            })
            const track = await input.getPrimaryVideoTrack()
            if (track) sinks.set(clip.id, new mb.VideoSampleSink(track))
          } else if (clip.type === 'image' && !bitmaps.has(asset.id)) {
            const bmp = await createImageBitmap(asset.file, {
              imageOrientation: 'from-image',
            }).catch(() => createImageBitmap(asset.file))
            bitmaps.set(asset.id, bmp)
            bag.add(() => {
              bmp.close()
            })
          }
        }
      } catch {
        throw new ExportInvalidFileError("A clip's media couldn't be decoded.")
      }

      // Mix audio ahead of muxing (best-effort; needs an AAC encoder).
      const hasAudio = intendsAudio(project)
      let mixed: AudioBuffer | null = null
      if (hasAudio) {
        try {
          if (await mb.canEncodeAudio('aac')) {
            mixed = await mixTimelineAudio(project, total)
          }
        } catch {
          mixed = null
        }
      }

      const output = new mb.Output({
        format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
        target: new mb.BufferTarget(),
      })
      token.arm(() => output.cancel())
      const source = new mb.CanvasSource(surface.el, {
        codec: 'avc',
        bitrate: mb.QUALITY_HIGH,
      })
      output.addVideoTrack(source, { frameRate: TIMELINE_FPS })
      let audioSource: InstanceType<typeof mb.AudioBufferSource> | null = null
      if (mixed) {
        audioSource = new mb.AudioBufferSource({
          codec: 'aac',
          bitrate: mb.QUALITY_HIGH,
        })
        output.addAudioTrack(audioSource)
      }

      await token.checkpoint()
      await output.start()
      if (mixed && audioSource) await audioSource.add(mixed)

      await runFrameLoop({
        frames: Math.max(1, Math.round(total * TIMELINE_FPS)),
        fps: TIMELINE_FPS,
        token,
        renderFrame: async (t) => {
          const scene = resolveScene(project, t)
          // Fetch this frame's video samples first, so the assembler itself
          // stays synchronous (and shared with the preview).
          const samples = new Map<string, InstanceType<typeof mb.VideoSample>>()
          for (const item of scene) {
            if (item.clip.type !== 'video') continue
            const sink = sinks.get(item.clip.id)
            if (!sink) continue
            const sample = await sink.getSample(item.localTime)
            if (sample) samples.set(item.clip.id, sample)
          }
          try {
            const items = sceneDrawItems(
              scene,
              out.width,
              out.height,
              (item) => {
                if (item.clip.type === 'video') {
                  const sample = samples.get(item.clip.id)
                  return sample ? videoSampleSource(sample) : null
                }
                const bmp = item.asset ? bitmaps.get(item.asset.id) : undefined
                return bmp ? bitmapSource(bmp) : null
              },
            )
            drawScene(surface.ctx, out, items)
          } finally {
            // Per-iteration, not per-export: these are one frame's samples.
            for (const sample of samples.values()) sample.close()
          }
        },
        sink: source,
        output,
        onProgress: opts.onProgress,
        wrapError: () =>
          new ExportInvalidFileError('The timeline could not be encoded.'),
      })

      opts.onProgress?.(1)
      return makeResult({
        buffer: output.target.buffer,
        fileName: opts.fileName,
        // Silent only if there was audio we couldn't include (no AAC encoder).
        silent: hasAudio && !mixed,
      })
    } finally {
      // AFTER the loop has settled: `Input.dispose()` cancels in-flight sink
      // operations, so disposing earlier would abort a pending getSample.
      bag.disposeAll()
    }
  })()

  return toHandle(token, done)
}
