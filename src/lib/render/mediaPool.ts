// The live decode/audio elements backing the preview: one <video> per video clip
// (each has its own playhead, so clips sharing an asset stay independent) and one
// <img> per image asset (stills are static, so they're shared). PreviewStage
// populates the pool via ref callbacks; usePlayback reads the videos to keep them
// synced to the timeline clock.

export interface MediaPool {
  /** Keyed by clip id. */
  videos: Map<string, HTMLVideoElement>
  /** Keyed by asset id. */
  images: Map<string, HTMLImageElement>
}

export function createMediaPool(): MediaPool {
  return { videos: new Map(), images: new Map() }
}
