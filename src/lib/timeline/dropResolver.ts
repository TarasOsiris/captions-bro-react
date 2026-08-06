// Where a timeline drag would land — the rules behind the drop indicator AND
// the commit, so the two can never disagree (they call the same functions).
//
// Extracted from Timeline.tsx, where it was the largest body of untested domain
// logic in the app: closures over gesture refs, with the resolver reading the
// in-flight drag out of a ref rather than taking it as an argument (an ordering
// constraint invisible from the signature — the commit handler HAD to resolve
// before tearing the gesture down).
//
// The DOM half is split off deliberately: `laneRectsFor` gathers live rects
// (the only part that touches the document), `classifyLaneZone` is pure over
// them, and the resolvers below are pure over the zone.

import { insertionIndex } from '@/lib/model/selectors'
import { laneHasRoom, resolveLaneStart } from '@/lib/model/lanes'
import { boundaryX } from './ruler'
import type { Clip, Track } from '@/lib/model/types'

/** Half-gap (px) the seam indicator sits above a lane. */
export const SEAM_OFFSET_PX = 5

/**
 * Where an in-flight drag would land.
 * - `main`: the magnetic track — an insertion slot and its caret.
 * - `lane`: a free spot on an existing overlay lane (the outline shows the
 *   exact landing window, which may be clamped away from the pointer).
 * - `seam`: between lanes / above the stack — a NEW lane directly above
 *   `belowTrackId` (array order is z-order, so above = later in the array).
 */
export type DropTarget =
  | { kind: 'main'; trackId: string; index: number; caretX: number }
  | { kind: 'lane'; trackId: string; start: number; duration: number }
  | { kind: 'seam'; belowTrackId: string; seamY: number; start: number }

/** The pointer zone the vertical hit-test resolves: a lane body (with the
 *  seam-above-it position precomputed from the same rect read) or a gap. */
export type LaneZone =
  | { kind: 'main' | 'lane'; track: Track; seamYAbove: number }
  | { kind: 'seam'; belowTrackId: string; seamY: number }

/** One lane's live geometry, in the coordinate space the caller measured in. */
export interface LaneRect {
  track: Track
  top: number
  bottom: number
}

/** The seam drop directly above a zone's lane — where a new lane grows. */
export function seamOf(
  zone: { track: Track; seamYAbove: number },
  start: number,
): DropTarget {
  return {
    kind: 'seam',
    belowTrackId: zone.track.id,
    seamY: zone.seamYAbove,
    start,
  }
}

/** Land on the lane if the window fits, else stack onto a new lane above it —
 *  the shared tail of both drag resolvers. */
export function laneOrSeam(
  zone: { track: Track; seamYAbove: number },
  start: number,
  duration: number,
): DropTarget {
  return laneHasRoom(zone.track.clips, start, duration)
    ? { kind: 'lane', trackId: zone.track.id, start, duration }
    : seamOf(zone, start)
}

/**
 * Which lane (or seam between lanes) a Y coordinate is over.
 *
 * `lanes` must be in DOCUMENT order (z-order, bottom-up); this walks them
 * backwards, i.e. visually top-down. Everything above the top lane — the
 * sticky ruler included — is the "new topmost lane" seam; everything below the
 * bottom (main) lane still targets it. All Y values share one origin, which the
 * caller makes scroll-invariant by measuring against the scrub surface.
 */
export function classifyLaneZone(
  lanes: ReadonlyArray<LaneRect>,
  y: number,
  originY: number,
): LaneZone | null {
  let above: LaneRect | null = null
  for (let i = lanes.length - 1; i >= 0; i--) {
    const lane = lanes[i]
    if (y < lane.top) {
      // In the gap above this lane (above the whole stack when none is).
      const gapTop = above?.bottom ?? lane.top - 2 * SEAM_OFFSET_PX
      return {
        kind: 'seam',
        belowTrackId: lane.track.id,
        seamY: (gapTop + lane.top) / 2 - originY,
      }
    }
    if (y <= lane.bottom || i === 0) {
      return {
        kind: lane.track.type === 'video' ? 'main' : 'lane',
        track: lane.track,
        seamYAbove: lane.top - originY - SEAM_OFFSET_PX,
      }
    }
    above = lane
  }
  return null
}

/**
 * Where a dragged CLIP lands.
 *
 * `snappedStart` is the drag's proposed start, already snapped by the caller
 * (it comes from the drag DELTA, not the pointer, so the grab point inside the
 * clip stays under the finger). `timeAtPointer` is only used for the magnetic
 * insertion slot.
 */
export function resolveClipDrop(opts: {
  zone: LaneZone
  clip: Clip
  sourceTrackId: string
  snappedStart: number
  timeAtPointer: number
}): DropTarget {
  const { zone, clip, sourceTrackId, snappedStart, timeAtPointer } = opts

  // The everyday magnetic reorder needs no snap math — slot and caret only.
  if (zone.kind === 'main' && clip.type !== 'text') {
    const index = insertionIndex(zone.track.clips, timeAtPointer, clip.id)
    const others = zone.track.clips.filter((c) => c.id !== clip.id)
    return {
      kind: 'main',
      trackId: zone.track.id,
      index,
      caretX: boundaryX(others, index),
    }
  }
  if (zone.kind === 'seam') return { ...zone, start: snappedStart }
  // Text never joins the magnetic track — remap to the lowest overlay position,
  // a new lane directly above the main one.
  if (zone.kind === 'main') return seamOf(zone, snappedStart)
  // An overlay lane. Within its OWN lane a clip clamps flush against its
  // siblings (it never spawns a lane by sliding sideways); arriving from
  // elsewhere onto occupied time means "stack it" — a new lane above.
  if (sourceTrackId === zone.track.id) {
    return {
      kind: 'lane',
      trackId: zone.track.id,
      start: resolveLaneStart(
        zone.track.clips,
        snappedStart,
        clip.duration,
        clip.id,
      ),
      duration: clip.duration,
    }
  }
  return laneOrSeam(zone, snappedStart, clip.duration)
}

/** Where a dragged ASSET (from the media bin) lands. Same rules, except there
 *  is no clip yet — so no same-lane case and no text remap. */
export function resolveAssetDrop(opts: {
  zone: LaneZone | null
  mainTrack: Track
  duration: number
  snappedStart: number
  timeAtPointer: number
}): DropTarget {
  const { zone, mainTrack, duration, snappedStart, timeAtPointer } = opts
  if (!zone || zone.kind === 'main') {
    const index = insertionIndex(mainTrack.clips, timeAtPointer)
    return {
      kind: 'main',
      trackId: mainTrack.id,
      index,
      caretX: boundaryX(mainTrack.clips, index),
    }
  }
  if (zone.kind === 'seam') return { ...zone, start: snappedStart }
  // Occupied time on that lane ⇒ stack: a new lane directly above it.
  return laneOrSeam(zone, snappedStart, duration)
}

/** Drag indicators re-resolve at pointer rate (dragover restates an unchanged
 *  target continuously); value-compare so an unchanged target keeps its object
 *  identity and React bails out of the re-render. */
export function sameDropTarget(
  a: DropTarget | null,
  b: DropTarget | null,
): boolean {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind) return false
  switch (a.kind) {
    case 'main':
      return (
        b.kind === 'main' &&
        a.trackId === b.trackId &&
        a.index === b.index &&
        a.caretX === b.caretX
      )
    case 'lane':
      return (
        b.kind === 'lane' &&
        a.trackId === b.trackId &&
        a.start === b.start &&
        a.duration === b.duration
      )
    case 'seam':
      return (
        b.kind === 'seam' &&
        a.belowTrackId === b.belowTrackId &&
        a.seamY === b.seamY &&
        a.start === b.start
      )
  }
}
