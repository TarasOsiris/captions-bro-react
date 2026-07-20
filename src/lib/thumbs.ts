// Filmstrip thumbnails for the timeline clip and media bin: a detached <video>
// is seeked through the clip and frames are drawn to a canvas. Client-only —
// call from an effect, never during SSR.

const TILE_W = 96
const TILE_H = 54

function once(el: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup()
      resolve()
    }
    const fail = () => {
      cleanup()
      reject(new Error(`video "${event}" failed`))
    }
    const cleanup = () => {
      el.removeEventListener(event, ok)
      el.removeEventListener('error', fail)
    }
    el.addEventListener(event, ok, { once: true })
    el.addEventListener('error', fail, { once: true })
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timed out'))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      },
    )
  })
}

/**
 * Extracts `count` evenly-spaced frames from the video at `url` as JPEG data
 * URLs (center-cropped 16:9 tiles). Never throws — failures yield fewer (or
 * zero) frames.
 */
export async function generateFilmstrip(
  url: string,
  count = 16,
): Promise<string[]> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url

  try {
    await withTimeout(once(video, 'loadeddata'), 5000)
  } catch {
    return []
  }

  const duration = video.duration
  if (!Number.isFinite(duration) || duration <= 0) return []

  const canvas = document.createElement('canvas')
  canvas.width = TILE_W
  canvas.height = TILE_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return []

  const frames: string[] = []
  for (let i = 0; i < count; i++) {
    const t = ((i + 0.5) / count) * duration
    try {
      video.currentTime = t
      await withTimeout(once(video, 'seeked'), 2000)
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (vw === 0 || vh === 0) continue
      // Cover-crop the source frame into the fixed tile.
      const scale = Math.max(TILE_W / vw, TILE_H / vh)
      const sw = TILE_W / scale
      const sh = TILE_H / scale
      ctx.drawImage(
        video,
        (vw - sw) / 2,
        (vh - sh) / 2,
        sw,
        sh,
        0,
        0,
        TILE_W,
        TILE_H,
      )
      frames.push(canvas.toDataURL('image/jpeg', 0.65))
    } catch {
      // A frame that fails to seek/draw is skipped; the strip stretches the rest.
    }
  }

  video.removeAttribute('src')
  video.load()
  return frames
}
