// The encode loop, driven with fakes — which is the point of its structural
// types: the cancellation state machine that used to be buried inside the
// WebCodecs-only paths is testable in the node env here.

import { describe, expect, it, vi } from 'vitest'
import { CancelToken } from './cancel'
import { ExportCancelledError, ExportInvalidFileError } from './errors'
import { runFrameLoop } from './frameLoop'
import { ENCODE_END } from './progress'

function fakes() {
  const added: Array<[number, number]> = []
  const sink = {
    add: (t: number, d: number) => {
      added.push([t, d])
      return Promise.resolve()
    },
  }
  const finalize = vi.fn(() => Promise.resolve())
  return { added, sink, output: { finalize } }
}

describe('runFrameLoop', () => {
  it('adds one frame per index at t = i/fps, then finalizes', async () => {
    const { added, sink, output } = fakes()
    await runFrameLoop({
      frames: 3,
      fps: 30,
      token: new CancelToken(),
      renderFrame: () => undefined,
      sink,
      output,
      wrapError: () => new Error('unused'),
    })
    expect(added).toEqual([
      [0, 1 / 30],
      [1 / 30, 1 / 30],
      [2 / 30, 1 / 30],
    ])
    expect(output.finalize).toHaveBeenCalledTimes(1)
  })

  it('renders each frame with its project time and index', async () => {
    const { sink, output } = fakes()
    const seen: Array<[number, number]> = []
    await runFrameLoop({
      frames: 2,
      fps: 2,
      token: new CancelToken(),
      renderFrame: (t, i) => {
        seen.push([t, i])
      },
      sink,
      output,
      wrapError: () => new Error('unused'),
    })
    expect(seen).toEqual([
      [0, 0],
      [0.5, 1],
    ])
  })

  it('reports monotonic progress ending at ENCODE_END', async () => {
    const { sink, output } = fakes()
    const seen: number[] = []
    await runFrameLoop({
      frames: 4,
      fps: 30,
      token: new CancelToken(),
      renderFrame: () => undefined,
      sink,
      output,
      onProgress: (f) => seen.push(f),
      wrapError: () => new Error('unused'),
    })
    expect(seen).toHaveLength(4)
    expect(seen[seen.length - 1]).toBeCloseTo(ENCODE_END)
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1])
    }
  })

  it('cancelling mid-loop tears down, throws, and stops encoding', async () => {
    const { added, sink, output } = fakes()
    const token = new CancelToken()
    const teardown = vi.fn(() => Promise.resolve())
    token.arm(teardown)
    await expect(
      runFrameLoop({
        frames: 10,
        fps: 30,
        token,
        renderFrame: (_t, i) => {
          if (i === 2) void token.cancel()
        },
        sink,
        output,
        wrapError: () => new Error('unused'),
      }),
    ).rejects.toBeInstanceOf(ExportCancelledError)
    expect(added.length).toBeLessThan(10)
    expect(teardown).toHaveBeenCalled()
    expect(output.finalize).not.toHaveBeenCalled()
  })

  it('a sink failure becomes the path error', async () => {
    const { output } = fakes()
    await expect(
      runFrameLoop({
        frames: 2,
        fps: 30,
        token: new CancelToken(),
        renderFrame: () => undefined,
        sink: {
          add: () => Promise.reject(new TypeError('encoder gone')),
        },
        output,
        wrapError: () =>
          new ExportInvalidFileError('The image could not be encoded.'),
      }),
    ).rejects.toThrow('The image could not be encoded.')
  })

  it('a sink failure while cancelled reports cancellation, not failure', async () => {
    const { output } = fakes()
    const token = new CancelToken()
    await token.cancel()
    await expect(
      runFrameLoop({
        frames: 2,
        fps: 30,
        token,
        renderFrame: () => undefined,
        sink: { add: () => Promise.reject(new TypeError('encoder gone')) },
        output,
        wrapError: () => new ExportInvalidFileError('nope'),
      }),
    ).rejects.toBeInstanceOf(ExportCancelledError)
  })
})
