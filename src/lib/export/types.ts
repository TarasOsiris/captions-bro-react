// The export layer's public value types.

export interface ExportResult {
  /** The re-encoded file: H.264 video + AAC audio in an MP4 container. */
  blob: Blob
  /** `"<basename>-captions-bro.mp4"` — see ./filename. */
  suggestedFileName: string
  /** Non-fatal track drops (e.g. an audio codec this browser can't encode). */
  discardedTracks: Array<{ type: 'video' | 'audio'; reason: string }>
  /** True iff the project had audio the output does NOT contain. Required (not
   *  optional) so every path has to answer the question — it used to be set by
   *  exportTimeline alone, and useExport compensated by OR-ing in a guess from
   *  `discardedTracks`. */
  silent: boolean
}

export interface ExportHandle {
  /** Resolves with the result, or rejects with one of the Export*Error classes. */
  done: Promise<ExportResult>
  /** Cancels the running export; `done` then rejects with `ExportCancelledError`. */
  cancel: () => Promise<void>
}
