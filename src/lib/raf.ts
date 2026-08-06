/**
 * Coalesce rapid calls to at most one per animation frame, keeping the LATEST
 * arguments.
 *
 * Why the inspector needs this: `<input type="color">` fires `input`
 * continuously while the desktop picker is open, and a slider drag can emit
 * faster than 60Hz on a 120Hz screen. Every one of those writes a new immer
 * `project` object, which re-renders anything subscribed to it. Since the
 * preview only repaints on its own rAF loop, writing more often than once a
 * frame is invisible work.
 */
export function rafThrottle<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
): ((...args: TArgs) => void) & { cancel: () => void; flush: () => void } {
  let handle = 0
  let latest: TArgs | null = null

  const throttled = (...args: TArgs) => {
    latest = args
    if (handle !== 0) return
    handle = requestAnimationFrame(() => {
      handle = 0
      const next = latest
      latest = null
      if (next) fn(...next)
    })
  }

  throttled.cancel = () => {
    if (handle !== 0) cancelAnimationFrame(handle)
    handle = 0
    latest = null
  }

  /** Run the pending call NOW (or nothing, if none is pending). For commit
   *  points: the last throttled write must land inside the editing session
   *  that owns it, not on a frame after the session closed. */
  throttled.flush = () => {
    if (handle !== 0) cancelAnimationFrame(handle)
    handle = 0
    const next = latest
    latest = null
    if (next) fn(...next)
  }

  return throttled
}
