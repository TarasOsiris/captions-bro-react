// Constructors for document entities. Keep these pure (no DOM/WebCodecs) so they
// are SSR-safe and unit-testable.

import { DEFAULT_IMAGE_DURATION_SEC } from '@/lib/media'
import { IDENTITY } from '@/lib/transform'
import { uid } from './ids'
import type {
  CanvasSettings,
  Clip,
  MediaAsset,
  MediaKind,
  Project,
  Track,
} from './types'

/** Default output canvas: 1080p 16:9 on black. */
export const DEFAULT_CANVAS: CanvasSettings = {
  width: 1920,
  height: 1080,
  background: '#000000',
}

export function createTrack(type: Track['type']): Track {
  return { id: uid('track'), type, clips: [] }
}

/** A fresh, empty project with a single video track. */
export function createProject(name = 'Untitled project'): Project {
  return {
    id: uid('proj'),
    name,
    canvas: { ...DEFAULT_CANVAS },
    tracks: [createTrack('video')],
    assets: {},
  }
}

export function assetFromFile(
  file: File,
  kind: MediaKind,
  url: string,
): MediaAsset {
  return {
    id: uid('asset'),
    kind,
    name: file.name,
    sizeBytes: file.size,
    file,
    url,
    naturalWidth: 0,
    naturalHeight: 0,
    durationSec: kind === 'image' ? DEFAULT_IMAGE_DURATION_SEC : null,
    // Images have a single, self-repeating filmstrip frame; videos fill in later.
    thumbs: kind === 'image' ? [url] : [],
  }
}

/** A timeline clip placing `asset` at `start` seconds, at its natural length. */
export function clipFromAsset(asset: MediaAsset, start = 0): Clip {
  return {
    id: uid('clip'),
    type: asset.kind,
    assetId: asset.id,
    start,
    duration: asset.durationSec ?? DEFAULT_IMAGE_DURATION_SEC,
    trimIn: 0,
    transform: { ...IDENTITY },
  }
}

/** A deep-ish copy of a clip with a fresh id (transform cloned so edits don't alias). */
export function cloneClip(clip: Clip, overrides: Partial<Clip> = {}): Clip {
  return {
    ...clip,
    id: uid('clip'),
    transform: { ...clip.transform },
    ...overrides,
  }
}
