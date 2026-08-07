// Clip VISUAL semantics, pure — the sibling of ./audio.ts, and here for the
// same reason: a rule spelled out separately in the preview and the export
// paths is a rule that will eventually diverge in one of them.

import { clamp } from '@/lib/math'
import type { Clip } from './types'

/** Effective layer alpha for a clip: absent is fully opaque, and anything out
 *  of range clamps rather than reaching `globalAlpha` as a NaN (which paints
 *  NOTHING, silently, and only in the export). */
export function clipOpacity(clip: Pick<Clip, 'opacity'>): number {
  const raw = clip.opacity
  if (raw === undefined || !Number.isFinite(raw)) return 1
  return clamp(raw, 0, 1)
}
