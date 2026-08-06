// The encode loop shared by the image and timeline paths: render frame i at
// t = i/fps, hand it to the sink, report progress, finalize.
//
// The sink/output types are STRUCTURAL, not mediabunny imports — this module
// must stay free of anything WebCodecs-touching (SSR), and it makes the whole
// cancellation state machine testable in the node env with plain fakes.

import { encodeFraction } from './progress'
import type { CancelToken } from './cancel'

export interface FrameSink {
  add: (timestamp: number, duration: number) => Promise<void>
}

export interface FinalizableOutput {
  finalize: () => Promise<void>
}

export async function runFrameLoop(opts: {
  /** ≥1 — callers apply `Math.max(1, Math.round(total * fps))`. */
  frames: number
  fps: number
  /** Teardown must already be armed on the token. */
  token: CancelToken
  /** Draw frame `index` (project time `t = index / fps`) onto the canvas the
   *  sink is bound to. Sync for the still path, async for the timeline path. */
  renderFrame: (t: number, index: number) => void | Promise<void>
  sink: FrameSink
  output: FinalizableOutput
  /** Receives the mapped 0…ENCODE_END fraction. */
  onProgress?: (fraction: number) => void
  /** Wrap for an unknown failure — the path's own user-facing message. */
  wrapError: () => Error
}): Promise<void> {
  const { frames, fps, token, renderFrame, sink, output, wrapError } = opts
  const step = 1 / fps
  try {
    for (let i = 0; i < frames; i++) {
      await token.checkpoint()
      await renderFrame(i * step, i)
      await sink.add(i * step, step)
      opts.onProgress?.(encodeFraction((i + 1) / frames))
    }
    await output.finalize()
  } catch (err) {
    token.reclassify(err, wrapError)
  }
}
