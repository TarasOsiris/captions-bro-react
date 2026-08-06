// Still image → a silent H.264 MP4 of a fixed length: composite ONE frame onto
// the output canvas, then hold it for the duration.

import { drawScene } from '@/lib/render/compositor'
import { bitmapSource } from '@/lib/render/sceneItems'
import { IDENTITY } from '@/lib/transform'
import { CancelToken, toHandle } from './cancel'
import { makeOutputSurface } from './canvas'
import { ExportInvalidFileError, ExportUnsupportedError } from './errors'
import { runFrameLoop } from './frameLoop'
import { makeResult } from './result'
import type { OutputSurface } from './canvas'
import type { ExportHandle, ExportResult } from './types'
import type { CanvasSettings } from '@/lib/model/types'
import type { Transform } from '@/lib/transform'

const IMAGE_FPS = 30

/** Decode `file` and composite it onto the output surface with `transform`
 *  applied, via `drawScene`. EXIF orientation is respected (matching the
 *  preview `<img>`). */
async function paintStill(
  file: File,
  transform: Transform,
  surface: OutputSurface,
): Promise<void> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      throw new ExportInvalidFileError("This image couldn't be decoded.")
    }
  }
  try {
    drawScene(surface.ctx, surface.out, [
      { transform, source: bitmapSource(bitmap) },
    ])
  } finally {
    bitmap.close()
  }
}

export function exportImage(
  file: File,
  opts: {
    durationSec: number
    canvas: CanvasSettings
    fileName: string
    transform?: Transform
    onProgress?: (fraction: number) => void
  },
): ExportHandle {
  const token = new CancelToken()

  const done = (async (): Promise<ExportResult> => {
    const mb = await import('mediabunny')
    // Defence in depth behind the mount-time capability probe: without this the
    // failure would surface as a generic "could not be encoded" rather than the
    // update-your-browser advice.
    if (!(await mb.canEncodeVideo('avc'))) throw new ExportUnsupportedError()

    const surface = makeOutputSurface(opts.canvas)
    await paintStill(file, opts.transform ?? IDENTITY, surface)

    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new mb.BufferTarget(),
    })
    token.arm(() => output.cancel())

    const source = new mb.CanvasSource(surface.el, {
      codec: 'avc',
      bitrate: mb.QUALITY_HIGH,
    })
    output.addVideoTrack(source, { frameRate: IMAGE_FPS })

    await token.checkpoint()
    await output.start()

    await runFrameLoop({
      frames: Math.max(1, Math.round(opts.durationSec * IMAGE_FPS)),
      fps: IMAGE_FPS,
      token,
      // The composite is already on the canvas; every frame just re-encodes it.
      renderFrame: () => undefined,
      sink: source,
      output,
      onProgress: opts.onProgress,
      wrapError: () =>
        new ExportInvalidFileError('The image could not be encoded.'),
    })

    opts.onProgress?.(1)
    return makeResult({
      buffer: output.target.buffer,
      fileName: opts.fileName,
    })
  })()

  return toHandle(token, done)
}
