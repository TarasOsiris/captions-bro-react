export const VIDEO_EXTENSIONS = ['.mov', '.mp4', '.m4v', '.webm', '.mkv']
export const IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.avif',
]

/** Fixed clip length given to a still image, matching the iOS app's still→video. */
export const DEFAULT_IMAGE_DURATION_SEC = 5

export type MediaKind = 'video' | 'image'

export interface LoadedMedia {
  file: File
  kind: MediaKind
  url: string
  name: string
  sizeBytes: number
  /** Video: read from metadata (null until known). Image: the default clip length. */
  durationSec: number | null
  /** Filmstrip frames (data/object URLs) for the timeline clip; empty while generating. */
  thumbs: string[]
}

function hasExtension(name: string, extensions: string[]): boolean {
  const lower = name.toLowerCase()
  return extensions.some((ext) => lower.endsWith(ext))
}

/** Classify a picked file, or `null` if it's neither a supported video nor image. */
export function mediaKind(file: File): MediaKind | null {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === '') {
    if (hasExtension(file.name, VIDEO_EXTENSIONS)) return 'video'
    if (hasExtension(file.name, IMAGE_EXTENSIONS)) return 'image'
  }
  return null
}

export function isMediaFile(file: File): boolean {
  return mediaKind(file) !== null
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '—'
  const total = Math.round(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Transport readout timecode with tenths, e.g. `0:11.4`. */
export function formatTimecode(sec: number): string {
  const clamped = Math.max(0, sec)
  const m = Math.floor(clamped / 60)
  const s = Math.floor(clamped % 60)
  const tenths = Math.floor((clamped * 10) % 10)
  return `${m}:${s.toString().padStart(2, '0')}.${tenths}`
}

/** Ruler tick label, e.g. `0:30`. */
export function formatRulerTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
