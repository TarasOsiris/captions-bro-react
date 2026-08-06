// ONE progress contract for all three export paths.
//
// Encoding frames covers 0…ENCODE_END; the remainder is the container finalize
// (writing the moov atom for `fastStart: 'in-memory'`, which is not free on a
// long export). `onProgress(1)` fires only once the result buffer exists.
//
// This exists because the three paths used to disagree: the image path scaled
// to 0.9, the timeline path to 0.95, and the fast path passed mediabunny's raw
// fraction — which reaches 1.0 BEFORE the container is finalized, so the ring
// sat at 100% for the last stretch of every fast export.

export const ENCODE_END = 0.95

/** Map a raw 0…1 encode fraction into the encode segment of the bar. */
export function encodeFraction(raw: number): number {
  const clamped = raw < 0 ? 0 : raw > 1 ? 1 : raw
  return ENCODE_END * clamped
}
