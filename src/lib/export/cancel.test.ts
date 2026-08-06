import { describe, expect, it, vi } from 'vitest'
import { CancelToken } from './cancel'
import {
  ExportCancelledError,
  ExportInvalidFileError,
  ExportUnsupportedError,
} from './errors'

describe('CancelToken', () => {
  it('checkpoint is a no-op until cancelled', async () => {
    const token = new CancelToken()
    await expect(token.checkpoint()).resolves.toBeUndefined()
  })

  it('cancel runs the armed teardown', async () => {
    const token = new CancelToken()
    const teardown = vi.fn(() => Promise.resolve())
    token.arm(teardown)
    await token.cancel()
    expect(token.cancelled).toBe(true)
    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it('cancel before anything is armed still flags', async () => {
    const token = new CancelToken()
    await token.cancel()
    expect(token.cancelled).toBe(true)
    // A teardown armed AFTER the cancel is still released by the next
    // checkpoint — the resource was created by an in-flight async body.
    const teardown = vi.fn(() => Promise.resolve())
    token.arm(teardown)
    await expect(token.checkpoint()).rejects.toBeInstanceOf(
      ExportCancelledError,
    )
    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it('checkpoint releases then throws once cancelled', async () => {
    const token = new CancelToken()
    const teardown = vi.fn(() => Promise.resolve())
    token.arm(teardown)
    await token.cancel()
    await expect(token.checkpoint()).rejects.toBeInstanceOf(
      ExportCancelledError,
    )
    // once from cancel(), once from the checkpoint
    expect(teardown).toHaveBeenCalledTimes(2)
  })

  it('throwIfCancelled is the sync form', () => {
    const token = new CancelToken()
    expect(() => {
      token.throwIfCancelled()
    }).not.toThrow()
  })

  describe('reclassify', () => {
    it('cancel wins over any error', async () => {
      const token = new CancelToken()
      await token.cancel()
      expect(() => {
        token.reclassify(new Error('encoder blew up'), () => new Error('x'))
      }).toThrow(ExportCancelledError)
    })

    it('passes an ExportCancelledError through even when not flagged', () => {
      const token = new CancelToken()
      expect(() => {
        token.reclassify(new ExportCancelledError(), () => new Error('x'))
      }).toThrow(ExportCancelledError)
    })

    it('rethrows the known export errors unchanged', () => {
      const token = new CancelToken()
      const unsupported = new ExportUnsupportedError()
      expect(() => {
        token.reclassify(unsupported, () => new Error('x'))
      }).toThrow(unsupported)
      const invalid = new ExportInvalidFileError('specific message')
      expect(() => {
        token.reclassify(invalid, () => new Error('x'))
      }).toThrow(invalid)
    })

    it('wraps anything else in the path fallback', () => {
      const token = new CancelToken()
      expect(() => {
        token.reclassify(
          new TypeError('undefined is not a function'),
          () =>
            new ExportInvalidFileError('The timeline could not be encoded.'),
        )
      }).toThrow('The timeline could not be encoded.')
    })
  })
})
