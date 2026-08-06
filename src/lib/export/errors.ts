// The three export failure classes. `useExport` maps them to user-facing copy
// (and treats Cancelled as "not a failure"), so every path must throw one of
// these rather than a bare Error.

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
