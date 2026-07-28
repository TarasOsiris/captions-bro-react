// The single seam for the client-side video pipeline.
//
// `mediabunny` is imported DYNAMICALLY, inside functions only — never at module
// top level — so nothing WebCodecs-touching is evaluated during SSR (the module
// is imported by the route, which is server-rendered). `./render/compositor` and
// `./model` are pure (SSR-safe), so they're imported statically.
//
// The output is a composition on the project's canvas: every frame is drawn with
// `drawScene` — the SAME renderer the preview uses — so the export matches the
// preview by construction (see the invariant in CLAUDE.md). Multi-clip
// sequencing and caption layers extend the DrawItem list, with no change to this
// module's public API.

import { drawScene } from './render/compositor'
import { isAppleWebKit } from './platform'
import { resolveScene } from './model/scene'
import {
  allClips,
  assetOf,
  clipIsLiveAt,
  projectDuration,
} from './model/selectors'
import { textSourceForClip } from './render/textSource'
import { ensureFontsForClips, ensureProjectFonts } from './text/fontLoader'
import { IDENTITY } from './transform'
import type { DrawItem } from './render/compositor'
import type { CanvasSettings, Clip, Project } from './model/types'
import type { Transform } from './transform'

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
  /** True when audio was omitted because the multi-clip compositor is video-only. */
  silent?: boolean
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

export type ExportCapability =
  | { ok: true }
  /** `reason` is user-facing copy explaining what to actually do about it. */
  | { ok: false; reason: string }

/**
 * `canExportH264` plus advice the user can act on. Codec knowledge stays in this
 * module (the single export seam) rather than leaking into the UI.
 *
 * The capability itself is feature-detected; the platform check only chooses
 * WHICH remediation to suggest. That distinction matters on iOS, where every
 * browser is WebKit — so "try Chrome" is actively wrong there, and the real gate
 * is the OS version (WebCodecs video encode landed in Safari 26 / iOS 26).
 */
export async function exportCapability(): Promise<ExportCapability> {
  if (await canExportH264()) return { ok: true }
  return {
    ok: false,
    reason: isAppleWebKit()
      ? "This iOS version can't encode H.264 in the browser. Update to iOS 26 or later, or use the Captions Bro iOS app."
      : "This browser can't encode H.264 video. Try Chrome, Edge, or Safari 26+.",
  }
}

function suggestedNameStr(base: string): string {
  const b = base.replace(/\.[^./\\]+$/, '') || 'video'
  return `${b}-captions-bro.mp4`
}

function suggestedName(file: File): string {
  return suggestedNameStr(file.name)
}

const IMAGE_FPS = 30

/** Rounds down to an even number ≥2 (H.264 requires even dimensions). */
function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2)
}

/** The output canvas, with even dimensions for the encoder. */
function outputCanvas(canvas: CanvasSettings): CanvasSettings {
  return {
    width: even(canvas.width),
    height: even(canvas.height),
    background: canvas.background,
  }
}

/**
 * Decodes `file` (an image) and composites it onto a project-sized canvas with
 * the transform applied, via `drawScene`. EXIF orientation is respected (matching
 * the preview `<img>`).
 */
async function drawImageToCanvas(
  file: File,
  transform: Transform,
  canvas: CanvasSettings,
): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      throw new ExportInvalidFileError("This image couldn't be decoded.")
    }
  }

  const out = outputCanvas(canvas)
  const el = document.createElement('canvas')
  el.width = out.width
  el.height = out.height
  const ctx = el.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new ExportInvalidFileError('Canvas is unavailable in this browser.')
  }
  const items: DrawItem[] = [
    {
      transform,
      source: {
        aspect: bitmap.width / bitmap.height,
        paint: (c, dx, dy, dw, dh) => {
          c.drawImage(bitmap, dx, dy, dw, dh)
        },
      },
    },
  ]
  drawScene(ctx, out, items)
  bitmap.close()
  return el
}

/**
 * Encodes a still `image` file into a silent H.264 MP4 of `durationSec`, holding
 * the composited frame on the canvas. Same handle contract as {@link exportVideo}.
 */
export function exportImage(
  file: File,
  opts: {
    durationSec: number
    canvas: CanvasSettings
    transform?: Transform
    onProgress?: (fraction: number) => void
  },
): ExportHandle {
  const control = { cancelled: false }
  const isCancelled = () => control.cancelled
  let cancelOutput: (() => Promise<void>) | null = null

  const done = (async (): Promise<ExportResult> => {
    const mb = await import('mediabunny')
    const canvas = await drawImageToCanvas(
      file,
      opts.transform ?? IDENTITY,
      opts.canvas,
    )

    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new mb.BufferTarget(),
    })
    cancelOutput = () => output.cancel()

    const source = new mb.CanvasSource(canvas, {
      codec: 'avc',
      bitrate: mb.QUALITY_HIGH,
    })
    output.addVideoTrack(source, { frameRate: IMAGE_FPS })

    if (isCancelled()) {
      await output.cancel()
      throw new ExportCancelledError()
    }
    await output.start()

    const totalFrames = Math.max(1, Math.round(opts.durationSec * IMAGE_FPS))
    const step = 1 / IMAGE_FPS
    try {
      for (let i = 0; i < totalFrames; i++) {
        if (isCancelled()) {
          await output.cancel()
          throw new ExportCancelledError()
        }
        await source.add(i * step, step)
        opts.onProgress?.((0.9 * (i + 1)) / totalFrames)
      }
      await output.finalize()
    } catch (err) {
      if (err instanceof ExportCancelledError) throw err
      if (isCancelled()) throw new ExportCancelledError()
      throw new ExportInvalidFileError('The image could not be encoded.')
    }

    opts.onProgress?.(1)
    const buffer = output.target.buffer
    if (!buffer) throw new ExportInvalidFileError()

    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      suggestedFileName: suggestedName(file),
      discardedTracks: [],
    }
  })()

  return {
    done,
    cancel: async () => {
      control.cancelled = true
      if (cancelOutput) await cancelOutput()
    },
  }
}

/**
 * Re-encodes `file` to an H.264 + AAC MP4 entirely in the browser (decode →
 * composite via `drawScene` → encode). Returns immediately with a handle; the
 * actual work runs on `handle.done`.
 */
export function exportVideo(
  file: File,
  opts: {
    canvas: CanvasSettings
    transform?: Transform
    onProgress?: (fraction: number) => void
    /** Text clips to burn over every frame, in draw order. Keeping them on THIS
     *  path rather than falling back to `exportTimeline` is what preserves the
     *  AAC packet-copy below — so a project with captions still exports with
     *  audio where there is no AAC encoder (Firefox). */
    overlays?: Clip[]
    /** projectTime = sample.timestamp + timeOffset. Zero on the fast path, which
     *  requires the media clip to start at 0 with no trim; passed explicitly so
     *  relaxing that precondition later can't silently desync the overlays. */
    timeOffset?: number
  },
): ExportHandle {
  // Held in an object (not a bare `let`) so the mutation from the `cancel`
  // closure is visible to the async body; read via `isCancelled()` so the check
  // reflects the latest value at each `await` boundary.
  const control = { cancelled: false }
  const isCancelled = () => control.cancelled
  let cancelConversion: (() => Promise<void>) | null = null
  const transform = opts.transform ?? IDENTITY
  const out = outputCanvas(opts.canvas)
  const overlays = opts.overlays ?? []
  const timeOffset = opts.timeOffset ?? 0

  const done = (async (): Promise<ExportResult> => {
    const mb = await import('mediabunny')
    // The `process` hook below is SYNCHRONOUS and cannot await, so every face
    // must be resolved before `Conversion.init`.
    if (overlays.length > 0) await ensureFontsForClips(overlays)

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
      // A single reused canvas the `process` hook composites each frame onto,
      // sized to the project canvas so the output matches the preview exactly.
      const el = document.createElement('canvas')
      el.width = out.width
      el.height = out.height
      const drawCtx = el.getContext('2d')
      if (!drawCtx) {
        throw new ExportInvalidFileError(
          'Canvas is unavailable in this browser.',
        )
      }

      conversion = await mb.Conversion.init({
        input,
        output,
        video: {
          // `forceTranscode` guarantees a real decode → encode; the `process`
          // hook then composites each frame onto the canvas with the media
          // transform, so the exported framing matches the preview exactly.
          codec: 'avc',
          bitrate: mb.QUALITY_HIGH,
          forceTranscode: true,
          // We bake all placement (incl. the source's own rotation, applied by
          // `VideoSample.draw`) into an upright canvas, so the output carries no
          // rotation metadata of its own.
          allowRotationMetadata: false,
          process: (sample) => {
            const items: DrawItem[] = [
              {
                transform,
                source: {
                  aspect: sample.displayWidth / sample.displayHeight,
                  paint: (c, dx, dy, dw, dh) => {
                    sample.draw(c, dx, dy, dw, dh)
                  },
                },
              },
            ]
            // Caption burn-in, on the fast path. `clipIsLiveAt` is the shared
            // per-clip live window (half-open); `resolveScene` layers a
            // final-frame hold on top, immaterial to a frame-sampled text
            // overlay — so a text clip appears on exactly the frames the preview
            // showed it.
            if (overlays.length > 0) {
              const t = sample.timestamp + timeOffset
              for (const clip of overlays) {
                if (!clipIsLiveAt(clip, t)) continue
                const src = textSourceForClip(clip, out.width, out.height)
                if (src) items.push({ transform: clip.transform, source: src })
              }
            }
            drawScene(drawCtx, out, items)
            return el
          },
          // Hints the post-process frame size so the encoder is configured for
          // the project canvas rather than the source dimensions.
          processedWidth: out.width,
          processedHeight: out.height,
        },
        // No `forceTranscode` on audio: AAC sources are packet-copied, so export
        // works even where there is no AudioEncoder (e.g. Firefox lacks AAC
        // encode). Non-AAC audio that can't be encoded is dropped non-fatally.
        audio: { codec: 'aac' },
      })
    } catch (err) {
      if (err instanceof ExportInvalidFileError) throw err
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

    if (opts.onProgress) {
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

const TIMELINE_FPS = 30
const AUDIO_SAMPLE_RATE = 48000
const AUDIO_CHANNELS = 2

/**
 * Mixes every audible clip into one timeline-length AudioBuffer via Web Audio's
 * OfflineAudioContext: each clip's decoded audio is scheduled at its `start`,
 * trimmed to `[trimIn, trimIn+duration]`, gained by `volume`. Portable (uses the
 * browser audio decoder, so it works on Firefox too). Returns null if nothing is
 * audible. Any clip without decodable audio (stills, silent video) is skipped.
 */
async function mixTimelineAudio(
  project: Project,
  total: number,
): Promise<AudioBuffer | null> {
  const frames = Math.ceil(total * AUDIO_SAMPLE_RATE)
  if (frames <= 0) return null
  const ctx = new OfflineAudioContext(AUDIO_CHANNELS, frames, AUDIO_SAMPLE_RATE)
  let scheduled = false
  for (const clip of allClips(project)) {
    if (clip.type !== 'video' && clip.type !== 'audio') continue
    if (clip.muted) continue
    const asset = assetOf(project, clip)
    if (!asset) continue
    let buffer: AudioBuffer
    try {
      const bytes = await asset.file.arrayBuffer()
      buffer = await ctx.decodeAudioData(bytes.slice(0))
    } catch {
      continue // no decodable audio track in this clip
    }
    const offset = Math.min(clip.trimIn, buffer.duration)
    const dur = Math.min(clip.duration, Math.max(0, buffer.duration - offset))
    if (dur <= 0) continue
    const node = ctx.createBufferSource()
    node.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = clip.volume ?? 1
    node.connect(gain).connect(ctx.destination)
    node.start(clip.start, offset, dur)
    scheduled = true
  }
  if (!scheduled) return null
  return ctx.startRendering()
}

/**
 * Composites a whole multi-clip timeline frame-by-frame via the SAME `drawScene`
 * the preview uses: for each output frame it decodes each live clip's frame (a
 * `VideoSampleSink` per video clip, a decoded bitmap per image) and paints them.
 * Audio from every clip is mixed into one track (where an AAC encoder exists);
 * `silent` is set only when there was audio we couldn't include.
 */
export function exportTimeline(
  project: Project,
  opts?: { onProgress?: (fraction: number) => void },
): ExportHandle {
  const control = { cancelled: false }
  const isCancelled = () => control.cancelled
  let cancelOutput: (() => Promise<void>) | null = null

  const done = (async (): Promise<ExportResult> => {
    const mb = await import('mediabunny')
    // Resolve webfonts BEFORE any frame is drawn — otherwise the first frames
    // encode in the fallback face and the output doesn't match the preview.
    await ensureProjectFonts(project)
    const total = projectDuration(project)
    if (total <= 0) throw new ExportInvalidFileError('The timeline is empty.')

    const out = outputCanvas(project.canvas)
    const el = document.createElement('canvas')
    el.width = out.width
    el.height = out.height
    const ctx = el.getContext('2d')
    if (!ctx)
      throw new ExportInvalidFileError('Canvas is unavailable in this browser.')

    // One decoder per video clip; one decoded bitmap per referenced image asset.
    const sinks = new Map<string, InstanceType<typeof mb.VideoSampleSink>>()
    const bitmaps = new Map<string, ImageBitmap>()
    try {
      for (const clip of allClips(project)) {
        const asset = assetOf(project, clip)
        if (!asset) continue
        if (clip.type === 'video') {
          const input = new mb.Input({
            formats: mb.ALL_FORMATS,
            source: new mb.BlobSource(asset.file),
          })
          const track = await input.getPrimaryVideoTrack()
          if (track) sinks.set(clip.id, new mb.VideoSampleSink(track))
        } else if (clip.type === 'image' && !bitmaps.has(asset.id)) {
          const bmp = await createImageBitmap(asset.file, {
            imageOrientation: 'from-image',
          }).catch(() => createImageBitmap(asset.file))
          bitmaps.set(asset.id, bmp)
        }
      }
    } catch {
      throw new ExportInvalidFileError("A clip's media couldn't be decoded.")
    }

    // Mix audio ahead of muxing (best-effort; needs an AAC encoder to include it).
    const hasAudioClips = allClips(project).some(
      (c) => c.type === 'video' || c.type === 'audio',
    )
    let mixed: AudioBuffer | null = null
    if (hasAudioClips) {
      try {
        if (await mb.canEncodeAudio('aac')) {
          mixed = await mixTimelineAudio(project, total)
        }
      } catch {
        mixed = null
      }
    }

    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new mb.BufferTarget(),
    })
    cancelOutput = () => output.cancel()
    const source = new mb.CanvasSource(el, {
      codec: 'avc',
      bitrate: mb.QUALITY_HIGH,
    })
    output.addVideoTrack(source, { frameRate: TIMELINE_FPS })
    let audioSource: InstanceType<typeof mb.AudioBufferSource> | null = null
    if (mixed) {
      audioSource = new mb.AudioBufferSource({
        codec: 'aac',
        bitrate: mb.QUALITY_HIGH,
      })
      output.addAudioTrack(audioSource)
    }

    if (isCancelled()) {
      await output.cancel()
      throw new ExportCancelledError()
    }
    await output.start()
    if (mixed && audioSource) await audioSource.add(mixed)

    const step = 1 / TIMELINE_FPS
    const frames = Math.max(1, Math.round(total * TIMELINE_FPS))
    try {
      for (let i = 0; i < frames; i++) {
        if (isCancelled()) {
          await output.cancel()
          throw new ExportCancelledError()
        }
        const t = i * step
        const items: DrawItem[] = []
        const open: Array<{ close: () => void }> = []
        for (const item of resolveScene(project, t)) {
          const clip = item.clip
          // Text BEFORE the asset guard — it is generated, not decoded, so it
          // has no asset and would otherwise be silently dropped from the
          // export while still showing in the preview. Same factory the preview
          // uses; the layout behind it is memoized, so this is one cache hit.
          if (clip.type === 'text') {
            const src = textSourceForClip(clip, out.width, out.height)
            if (src) items.push({ transform: clip.transform, source: src })
            continue
          }
          const asset = assetOf(project, clip)
          if (!asset) continue
          if (clip.type === 'video') {
            const sink = sinks.get(clip.id)
            if (!sink) continue
            const sample = await sink.getSample(item.localTime)
            if (!sample) continue
            open.push(sample)
            items.push({
              transform: clip.transform,
              source: {
                aspect: sample.displayWidth / sample.displayHeight,
                paint: (c, dx, dy, dw, dh) => {
                  sample.draw(c, dx, dy, dw, dh)
                },
              },
            })
          } else if (clip.type === 'image') {
            const bmp = bitmaps.get(asset.id)
            if (!bmp) continue
            items.push({
              transform: clip.transform,
              source: {
                aspect: bmp.width / bmp.height,
                paint: (c, dx, dy, dw, dh) => {
                  c.drawImage(bmp, dx, dy, dw, dh)
                },
              },
            })
          }
        }
        drawScene(ctx, out, items)
        for (const s of open) s.close()
        await source.add(t, step)
        opts?.onProgress?.((0.95 * (i + 1)) / frames)
      }
      await output.finalize()
    } catch (err) {
      if (err instanceof ExportCancelledError) throw err
      if (isCancelled()) throw new ExportCancelledError()
      throw new ExportInvalidFileError('The timeline could not be encoded.')
    } finally {
      for (const bmp of bitmaps.values()) bmp.close()
    }

    opts?.onProgress?.(1)
    const buffer = output.target.buffer
    if (!buffer) throw new ExportInvalidFileError()

    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      suggestedFileName: suggestedNameStr(project.name),
      discardedTracks: [],
      // Silent only if there was audio we couldn't include (e.g. no AAC encoder).
      silent: hasAudioClips && !mixed,
    }
  })()

  return {
    done,
    cancel: async () => {
      control.cancelled = true
      if (cancelOutput) await cancelOutput()
    },
  }
}

/** Which encoder `exportProject` will use, and with what. */
export type ExportPlan =
  | { path: 'image'; clip: Clip; assetId: string }
  | { path: 'video'; clip: Clip; assetId: string; overlays: Clip[] }
  | { path: 'timeline' }

/**
 * Decide how to export, as a PURE function — the rule is subtle enough (and the
 * cost of getting it wrong is silent audio loss) that it deserves to be
 * inspectable and unit-tested without touching WebCodecs.
 *
 * Text overlays are composited by the fast path itself, so they do NOT
 * disqualify it — only the MEDIA clips decide which encoder can be used. Without
 * that split, adding one caption would drop every project onto `exportTimeline`,
 * which needs an AAC encoder and so exports SILENT on Firefox.
 */
export function planExport(project: Project): ExportPlan {
  const clips = allClips(project)
  // `allClips` walks tracks in order, so this preserves draw order.
  const overlays = clips.filter((c) => c.type === 'text')
  const media = clips.filter((c) => c.type !== 'text')
  const single = media.length === 1 ? media[0] : null
  const asset =
    single && single.assetId != null ? project.assets[single.assetId] : null

  if (single && asset && single.start === 0 && single.trimIn === 0) {
    // `exportImage` bakes ONE composited frame and repeats it, which is wrong
    // for overlays that have their own time windows — and a still has no audio
    // for the fast path to protect. So any text sends stills to the compositor.
    if (single.type === 'image' && overlays.length === 0) {
      return { path: 'image', clip: single, assetId: asset.id }
    }
    // Untrimmed full-length single video → fast path keeps audio.
    const full =
      asset.durationSec == null ||
      Math.abs(single.duration - asset.durationSec) < 0.1
    if (single.type === 'video' && full) {
      return { path: 'video', clip: single, assetId: asset.id, overlays }
    }
  }

  return { path: 'timeline' }
}

/**
 * Export the whole project, picking the best path: the fast single-source
 * encoders (which keep audio) for an untrimmed single clip plus any number of
 * text overlays, otherwise the frame-by-frame timeline compositor.
 */
export function exportProject(
  project: Project,
  opts?: { onProgress?: (fraction: number) => void },
): ExportHandle {
  const plan = planExport(project)

  if (plan.path === 'image') {
    return exportImage(project.assets[plan.assetId].file, {
      durationSec: plan.clip.duration,
      canvas: project.canvas,
      transform: plan.clip.transform,
      onProgress: opts?.onProgress,
    })
  }

  if (plan.path === 'video') {
    return exportVideo(project.assets[plan.assetId].file, {
      canvas: project.canvas,
      transform: plan.clip.transform,
      onProgress: opts?.onProgress,
      overlays: plan.overlays,
      // Safe because the plan requires start === 0 && trimIn === 0, so project
      // time is exactly the sample timestamp.
      timeOffset: 0,
    })
  }

  return exportTimeline(project, opts)
}
