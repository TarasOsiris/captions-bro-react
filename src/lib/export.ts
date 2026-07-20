// The single seam for the client-side video pipeline.
//
// `mediabunny` is imported DYNAMICALLY, inside functions only — never at module
// top level — so nothing WebCodecs-touching is evaluated during SSR (the module
// is imported by the route, which is server-rendered).
//
// Caption burn-in will later plug in here: mediabunny's per-frame
// `video.process(sample) => CanvasImageSource` hook on the Conversion below is
// where a styled caption canvas gets composited onto each decoded frame, with no
// change to this module's public API.

export class ExportUnsupportedError extends Error {
  constructor(message = "This browser can't encode H.264 video.") {
    super(message)
    this.name = 'ExportUnsupportedError'
  }
}

export class ExportInvalidFileError extends Error {
  constructor(message = "This file couldn't be read as a video.") {
    super(message)
    this.name = 'ExportInvalidFileError'
  }
}

export class ExportCancelledError extends Error {
  constructor(message = 'Export cancelled.') {
    super(message)
    this.name = 'ExportCancelledError'
  }
}

export interface ExportResult {
  /** The re-encoded file: H.264 video + AAC audio in an MP4 container. */
  blob: Blob
  /** `"<basename>-captions-bro.mp4"`. */
  suggestedFileName: string
  /** Non-fatal track drops (e.g. an audio codec this browser can't encode). */
  discardedTracks: Array<{ type: 'video' | 'audio'; reason: string }>
}

export interface ExportHandle {
  /** Resolves with the result, or rejects with one of the Export*Error classes. */
  done: Promise<ExportResult>
  /** Cancels the running export; `done` then rejects with `ExportCancelledError`. */
  cancel: () => Promise<void>
}

/**
 * Whether this browser can encode H.264 (AVC) video via WebCodecs. Used to gate
 * the Export button. Never throws — a missing WebCodecs API resolves to `false`.
 */
export async function canExportH264(): Promise<boolean> {
  try {
    const mb = await import('mediabunny')
    return await mb.canEncodeVideo('avc')
  } catch {
    return false
  }
}

function suggestedName(file: File): string {
  const base = file.name.replace(/\.[^./\\]+$/, '') || 'video'
  return `${base}-captions-bro.mp4`
}

/**
 * Re-encodes `file` to an H.264 + AAC MP4 entirely in the browser (decode →
 * encode via WebCodecs, driven by mediabunny). Returns immediately with a handle;
 * the actual work runs on `handle.done`.
 */
export function exportVideo(
  file: File,
  opts?: { onProgress?: (fraction: number) => void },
): ExportHandle {
  // Held in an object (not a bare `let`) so the mutation from the `cancel`
  // closure is visible to the async body; read via `isCancelled()` so the check
  // reflects the latest value at each `await` boundary.
  const control = { cancelled: false }
  const isCancelled = () => control.cancelled
  let cancelConversion: (() => Promise<void>) | null = null

  const done = (async (): Promise<ExportResult> => {
    const mb = await import('mediabunny')

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
      conversion = await mb.Conversion.init({
        input,
        output,
        // `forceTranscode` guarantees a real decode → encode even when the input
        // is already H.264 — this is the pipeline captions will later hook into.
        video: { codec: 'avc', bitrate: mb.QUALITY_HIGH, forceTranscode: true },
        // No `forceTranscode` on audio: AAC sources are packet-copied, so export
        // works even where there is no AudioEncoder (e.g. Firefox lacks AAC
        // encode). Non-AAC audio that can't be encoded is dropped non-fatally.
        audio: { codec: 'aac' },
        // width/height omitted → original resolution kept; rotation metadata is
        // handled by mediabunny.
      })
    } catch {
      throw new ExportInvalidFileError()
    }

    cancelConversion = () => conversion.cancel()
    if (isCancelled()) {
      await conversion.cancel()
      throw new ExportCancelledError()
    }

    const discardedTracks: ExportResult['discardedTracks'] = []
    for (const discarded of conversion.discardedTracks) {
      const type = discarded.track.type
      if (type === 'video') {
        // No video track survived → nothing to export.
        if (discarded.reason === 'no_encodable_target_codec') {
          throw new ExportUnsupportedError()
        }
        throw new ExportInvalidFileError(
          "This browser can't decode this video's codec.",
        )
      }
      if (type === 'audio') {
        discardedTracks.push({ type: 'audio', reason: discarded.reason })
      }
    }

    if (opts?.onProgress) {
      const onProgress = opts.onProgress
      // Set before execute() so mediabunny computes progress. Note a progress of
      // 1.0 fires before execute() resolves (finalizing the container).
      conversion.onProgress = (progress) => onProgress(progress)
    }

    try {
      await conversion.execute()
    } catch (err) {
      if (isCancelled()) throw new ExportCancelledError()
      if (
        err instanceof ExportUnsupportedError ||
        err instanceof ExportInvalidFileError
      ) {
        throw err
      }
      throw new ExportInvalidFileError('The video could not be re-encoded.')
    }

    if (isCancelled()) throw new ExportCancelledError()

    const buffer = output.target.buffer
    if (!buffer) throw new ExportInvalidFileError()

    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      suggestedFileName: suggestedName(file),
      discardedTracks,
    }
  })()

  return {
    done,
    cancel: async () => {
      control.cancelled = true
      if (cancelConversion) await cancelConversion()
    },
  }
}
