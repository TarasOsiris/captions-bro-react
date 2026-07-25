// Constructors for document entities. Keep these pure (no DOM/WebCodecs) so they
// are SSR-safe and unit-testable.

import { DEFAULT_IMAGE_DURATION_SEC } from '@/lib/media'
import { IDENTITY } from '@/lib/transform'
import { uid } from './ids'
import { DEFAULT_TEXT_CONTENT, withTextDefaults } from './text'
import type {
  CanvasSettings,
  Clip,
  MediaAsset,
  MediaKind,
  Project,
  TextStyle,
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

/** How long a freshly inserted text clip covers, matching the still-image default. */
export const DEFAULT_TEXT_DURATION_SEC = 4

/** A text clip: no asset, free-positioned at `start`, styled from the defaults. */
export function createTextClip(opts?: {
  start?: number
  duration?: number
  content?: string
  style?: Partial<TextStyle>
}): Clip {
  return {
    id: uid('clip'),
    type: 'text',
    assetId: null,
    start: Math.max(0, opts?.start ?? 0),
    duration: opts?.duration ?? DEFAULT_TEXT_DURATION_SEC,
    trimIn: 0,
    transform: { ...IDENTITY },
    text: opts?.content ?? DEFAULT_TEXT_CONTENT,
    textStyle: withTextDefaults(opts?.style),
  }
}

/**
 * A copy of a clip with a fresh id. Every NESTED value object is copied
 * explicitly: a shared reference would let an edit to the copy reach the
 * original. immer masks this today (its drafts are copy-on-write per object),
 * which is exactly why it must be spelled out — the next non-store caller would
 * hit it silently.
 */
export function cloneClip(clip: Clip, overrides: Partial<Clip> = {}): Clip {
  return {
    ...clip,
    id: uid('clip'),
    transform: {
      ...clip.transform,
      ...(clip.transform.crop && { crop: { ...clip.transform.crop } }),
    },
    ...(clip.textStyle && { textStyle: { ...clip.textStyle } }),
    ...overrides,
  }
}
