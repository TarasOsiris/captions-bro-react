// Cancellation, once, for all three export paths.
//
// The state lives in an instance field (not a closed-over `let`) so the
// mutation from `cancel()` is visible to the async body at every `await`
// boundary — the reason the original code used a `{ cancelled }` object.
//
// `reclassify` is also THE catch policy: cancel wins over any error, known
// export errors pass through, everything else becomes the path's own message.
// The three paths used to spell this out separately and in different orders.

import {
  ExportCancelledError,
  ExportInvalidFileError,
  ExportUnsupportedError,
} from './errors'
import type { ExportHandle, ExportResult } from './types'

export class CancelToken {
  private flag = false
  private teardown: (() => Promise<void>) | null = null

  get cancelled(): boolean {
    return this.flag
  }

  /** Register (or replace) the underlying teardown — `output.cancel()` or
   *  `conversion.cancel()` — once that resource exists. */
  arm(teardown: () => Promise<void>): void {
    this.teardown = teardown
  }

  /** `ExportHandle.cancel`: flag it, then tear down whatever is armed. */
  async cancel(): Promise<void> {
    this.flag = true
    if (this.teardown) await this.teardown()
  }

  /** Await-boundary checkpoint: if cancelled, release the armed resource and
   *  throw. Use inside loops and before starting expensive work. */
  async checkpoint(): Promise<void> {
    if (!this.flag) return
    if (this.teardown) await this.teardown()
    throw new ExportCancelledError()
  }

  /** Sync form, for after the resources are already released. */
  throwIfCancelled(): void {
    if (this.flag) throw new ExportCancelledError()
  }

  /** The one catch policy. Never returns. */
  reclassify(err: unknown, fallback: () => Error): never {
    if (this.flag || err instanceof ExportCancelledError) {
      throw new ExportCancelledError()
    }
    if (
      err instanceof ExportUnsupportedError ||
      err instanceof ExportInvalidFileError
    ) {
      throw err
    }
    throw fallback()
  }
}

export function toHandle(
  token: CancelToken,
  done: Promise<ExportResult>,
): ExportHandle {
  return { done, cancel: () => token.cancel() }
}
