export const VIDEO_EXTENSIONS = ['.mov', '.mp4', '.m4v', '.webm', '.mkv']

export interface LoadedVideo {
  file: File
  url: string
  name: string
  sizeBytes: number
  durationSec: number | null
  /** Filmstrip frames (data URLs) for the timeline clip; empty while generating. */
  thumbs: string[]
}

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true
  if (file.type === '') {
    const lower = file.name.toLowerCase()
    return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))
  }
  return false
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
