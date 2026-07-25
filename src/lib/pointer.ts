// Shared pointer-gesture mechanics. The rules here are cross-cutting — see the
// "Pointer gestures are exclusive and cancel-safe" section of CLAUDE.md — so
// every drag surface (timeline clips, trim handles, scrub, playhead, preview
// transform handles) imports them rather than restating them.

/**
 * Whether this press may START a gesture.
 *
 * A secondary mouse button must not: `contextmenu` fires with no matching
 * `pointerup`, so the gesture would stick and the next mouse move would drag.
 * Touch and pen have no meaningful `button` value here, so they always pass.
 */
export function isPrimaryPointer(e: React.PointerEvent): boolean {
  return e.pointerType !== 'mouse' || e.button === 0
}

/** Release an implicit/explicit pointer capture if this element holds it.
 *  Calling `releasePointerCapture` for a pointer we don't own throws. */
export function releaseCapture(el: Element, pointerId: number): void {
  if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId)
}
