// Turning a finished muxer buffer into an ExportResult, and the discarded-track
// policy — both pure, both previously copy-pasted across the three paths.

import { ExportInvalidFileError, ExportUnsupportedError } from './errors'
import type { ExportResult } from './types'

/**
 * Classify mediabunny's discarded tracks. Video drops are FATAL (nothing left
 * to export) and split by cause so the user gets the right remediation; audio
 * drops are collected as non-fatal diagnostics.
 *
 * Extracted from exportVideo, where it was the only implementation — which is
 * why a missing AVC encoder on the other paths used to surface as a generic
 * "could not be encoded" instead of the install/update advice.
 */
export function classifyDiscardedTracks(
  discarded: ReadonlyArray<{ track: { type: string }; reason: string }>,
): ExportResult['discardedTracks'] {
  const out: ExportResult['discardedTracks'] = []
  for (const d of discarded) {
    if (d.track.type === 'video') {
      if (d.reason === 'no_encodable_target_codec') {
        throw new ExportUnsupportedError()
      }
      throw new ExportInvalidFileError(
        "This browser can't decode this video's codec.",
      )
    }
    if (d.track.type === 'audio') {
      out.push({ type: 'audio', reason: d.reason })
    }
  }
  return out
}

export function makeResult(opts: {
  /** `BufferTarget.buffer` — null means the muxer produced nothing. */
  buffer: ArrayBuffer | null
  fileName: string
  discardedTracks?: ExportResult['discardedTracks']
  silent?: boolean
}): ExportResult {
  if (!opts.buffer) throw new ExportInvalidFileError()
  return {
    blob: new Blob([opts.buffer], { type: 'video/mp4' }),
    suggestedFileName: opts.fileName,
    discardedTracks: opts.discardedTracks ?? [],
    silent: opts.silent ?? false,
  }
}
