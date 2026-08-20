// THE FAST PATH: one untrimmed source video → decode → composite → encode, via
// mediabunny's Conversion.
//
// Two things here are load-bearing and must survive any refactor:
//  1. At full volume the audio options are `{ codec: 'aac' }` with NO
//     forceTranscode — an AAC source is PACKET-COPIED, so the export keeps its
//     audio even where there is no AAC encoder (Firefox). Falling back to the
//     timeline compositor would export silent there, which is why planExport
//     keeps captions on this path. A clip the user turned DOWN cannot be
//     packet-copied (the gain would be ignored); see ./audioFast for the
//     three-mode resolution and why it is not a blanket transcode.
//  2. The `process` hook is SYNCHRONOUS — it cannot await, so every font must
//     be resolved before `Conversion.init`.

import { drawScene } from '@/lib/render/compositor'
import {
  liveTextItems,
  mediaDrawItem,
  videoSampleSource,
} from '@/lib/render/sceneItems'
import { ensureExportFonts } from '@/lib/text/fontLoader'
import { IDENTITY } from '@/lib/transform'
import { applyGain, fastAudioMode } from './audioFast'
import { CancelToken, toHandle } from './cancel'
import { makeOutputSurface } from './canvas'
import { ExportInvalidFileError } from './errors'
import { encodeFraction } from './progress'
import { classifyDiscardedTracks, makeResult } from './result'
import type { DrawItem } from '@/lib/render/compositor'
import type { MediaLayer } from '@/lib/render/sceneItems'
import type { ExportHandle, ExportResult } from './types'
import type { CanvasSettings, Clip } from '@/lib/model/types'

export function exportVideo(
  file: File,
  opts: {
    canvas: CanvasSettings
    fileName: string
    /** The media clip's visual layer. A `Clip` satisfies it structurally; the
     *  `process` hook below builds its DrawItem through the same
     *  `mediaDrawItem` the scene walk uses, so the two cannot drift. */
    media?: MediaLayer
    /** The clip's audio levels. Deliberately separate from `media`, which is
     *  the VISUAL layer — see ./audioFast for what each level costs. */
    audio?: Pick<Clip, 'volume' | 'muted'>
    onProgress?: (fraction: number) => void
    /** Text clips to burn over every frame, in draw order. */
    overlays?: Clip[]
    /** projectTime = sample.timestamp + timeOffset. Zero on the fast path, which
     *  requires the media clip to start at 0 with no trim; passed explicitly so
     *  relaxing that precondition later can't silently desync the overlays. */
    timeOffset?: number
    /** Whether the project INTENDS audio (`intendsAudio`), for the `silent`
     *  verdict — not merely whether the source has an audio track. */
    hasAudio?: boolean
    /** Hands out the compositing surface once it exists, for the live preview.
     *  See the note at its call site. */
    onSurface?: (el: HTMLCanvasElement) => void
  },
): ExportHandle {
  const token = new CancelToken()
  const media: MediaLayer = opts.media ?? { transform: IDENTITY }
  const audioMode = fastAudioMode(opts.audio ?? {})
  const overlays = opts.overlays ?? []
  const timeOffset = opts.timeOffset ?? 0

  const done = (async (): Promise<ExportResult> => {
    const mb = await import('mediabunny')
    // The `process` hook below is SYNCHRONOUS and cannot await, so every face
    // must be resolved before `Conversion.init`.
    await ensureExportFonts(overlays)

    const output = new mb.Output({
      // `fastStart: 'in-memory'` writes the moov atom at the front so the result
      // is streamable / instantly seekable in a browser tab or QuickTime.
      format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new mb.BufferTarget(),
    })

    let conversion: Awaited<ReturnType<typeof mb.Conversion.init>>
    try {
      const input = new mb.Input({
        formats: mb.ALL_FORMATS,
        source: new mb.BlobSource(file),
      })
      // A single reused canvas the `process` hook composites each frame onto,
      // sized to the project canvas so the output matches the preview exactly.
      const surface = makeOutputSurface(opts.canvas)
      const out = surface.out
      // The finished frame lives on this canvas until the next one overwrites
      // it, so the export screen can mirror it and show the render happening.
      // Handed over rather than pushed per frame: the encode is what's under
      // time pressure, so the reader pulls at its own rate (ExportPreview).
      opts.onSurface?.(surface.el)

      conversion = await mb.Conversion.init({
        input,
        output,
        video: {
          // `forceTranscode` guarantees a real decode → encode; the `process`
          // hook then composites each frame onto the canvas with the media
          // transform, so the exported framing matches the preview exactly.
          codec: 'avc',
          bitrate: mb.QUALITY_HIGH,
          forceTranscode: true,
          // We bake all placement (incl. the source's own rotation, applied by
          // `VideoSample.draw`) into an upright canvas, so the output carries no
          // rotation metadata of its own.
          allowRotationMetadata: false,
          process: (sample) => {
            // The media frame draws UNCONDITIONALLY: a sample timestamp can run
            // a rounding step past the clip's stored duration, and a liveness
            // check here would black out the tail of the video.
            const items: DrawItem[] = [
              mediaDrawItem(media, videoSampleSource(sample)),
            ]
            if (overlays.length > 0) {
              items.push(
                ...liveTextItems(
                  overlays,
                  sample.timestamp + timeOffset,
                  out.width,
                  out.height,
                ),
              )
            }
            drawScene(surface.ctx, out, items)
            return surface.el
          },
          // Hints the post-process frame size so the encoder is configured for
          // the project canvas rather than the source dimensions.
          processedWidth: out.width,
          processedHeight: out.height,
        },
        // No `forceTranscode` on audio — see the packet-copy note in the
        // header. `copy` must stay BYTE-IDENTICAL to `{ codec: 'aac' }` or
        // every Firefox export loses its sound.
        audio:
          audioMode.kind === 'discard'
            ? { discard: true }
            : audioMode.kind === 'gain'
              ? {
                  codec: 'aac',
                  // Setting `process` implies a decode → encode; that cost is
                  // only paid when the user actually moved the slider.
                  process: (sample) => {
                    const format = 'f32' as const
                    const bytes = sample.allocationSize({
                      planeIndex: 0,
                      format,
                    })
                    const pcm = new Float32Array(
                      bytes / Float32Array.BYTES_PER_ELEMENT,
                    )
                    sample.copyTo(pcm, { planeIndex: 0, format })
                    applyGain(pcm, audioMode.gain)
                    // The input sample is NOT closed here — the conversion owns
                    // its lifecycle, exactly as in the video hook above.
                    return new mb.AudioSample({
                      data: pcm,
                      format,
                      numberOfChannels: sample.numberOfChannels,
                      sampleRate: sample.sampleRate,
                      timestamp: sample.timestamp,
                    })
                  },
                }
              : { codec: 'aac' },
      })
    } catch (err) {
      if (err instanceof ExportInvalidFileError) throw err
      throw new ExportInvalidFileError()
    }

    token.arm(() => conversion.cancel())
    await token.checkpoint()

    const discardedTracks = classifyDiscardedTracks(conversion.discardedTracks)

    if (opts.onProgress) {
      const onProgress = opts.onProgress
      // Mapped through the shared contract: mediabunny's raw fraction reaches
      // 1.0 before execute() resolves (it is still finalizing the container).
      conversion.onProgress = (progress) => {
        onProgress(encodeFraction(progress))
      }
    }

    try {
      await conversion.execute()
    } catch (err) {
      token.reclassify(
        err,
        () => new ExportInvalidFileError('The video could not be re-encoded.'),
      )
    }
    token.throwIfCancelled()

    opts.onProgress?.(1)
    return makeResult({
      buffer: output.target.buffer,
      fileName: opts.fileName,
      discardedTracks,
      // The source had audio the user WANTED, but every audio track was
      // dropped. `hasAudio` is the caller's `intendsAudio`, so a clip the user
      // muted never reports as a failure — silence was the request.
      silent:
        (opts.hasAudio ?? false) &&
        discardedTracks.some((t) => t.type === 'audio'),
    })
  })()

  return toHandle(token, done)
}
