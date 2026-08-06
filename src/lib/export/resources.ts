// LIFO teardown for the per-export decoders and bitmaps.
//
// Written because exportTimeline constructed one mediabunny `Input` per video
// clip INLINE and never retained it — so its decoders were never disposed and
// repeated exports in one session climbed in memory. (Sinks have no dispose of
// their own; `Input.dispose()` is what closes decoders and cancels in-flight
// sink operations, which is also why disposal must run only AFTER the frame
// loop has settled.)

export class ResourceBag {
  private teardowns: Array<() => void> = []

  add(dispose: () => void): void {
    this.teardowns.push(dispose)
  }

  /** Run every teardown, newest first. Errors are swallowed on purpose: on the
   *  failure path an already-disposed input throws, and that must not mask the
   *  real error. Idempotent. */
  disposeAll(): void {
    const list = this.teardowns
    this.teardowns = []
    for (let i = list.length - 1; i >= 0; i--) {
      try {
        list[i]()
      } catch {
        // best-effort
      }
    }
  }
}
