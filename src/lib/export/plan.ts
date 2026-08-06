// Which encoder `exportProject` will use, and with what — PURE, so the rule
// (subtle, and silently costly to get wrong) is inspectable and unit-tested
// without touching WebCodecs.

import { allClips } from '@/lib/model/selectors'
import type { Clip, Project } from '@/lib/model/types'

export type ExportPlan =
  | { path: 'image'; clip: Clip; assetId: string }
  | { path: 'video'; clip: Clip; assetId: string; overlays: Clip[] }
  | { path: 'timeline' }

/**
 * Text overlays are composited by the fast path itself, so they do NOT
 * disqualify it — only the MEDIA clips decide which encoder can be used. Without
 * that split, adding one caption would drop every project onto `exportTimeline`,
 * which needs an AAC encoder and so exports SILENT on Firefox.
 */
export function planExport(project: Project): ExportPlan {
  const clips = allClips(project)
  // `allClips` walks tracks in order, so this preserves draw order.
  const overlays = clips.filter((c) => c.type === 'text')
  const media = clips.filter((c) => c.type !== 'text')
  const single = media.length === 1 ? media[0] : null
  const asset =
    single && single.assetId != null ? project.assets[single.assetId] : null

  if (single && asset && single.start === 0 && single.trimIn === 0) {
    // `exportImage` bakes ONE composited frame and repeats it, which is wrong
    // for overlays that have their own time windows — and a still has no audio
    // for the fast path to protect. So any text sends stills to the compositor.
    if (single.type === 'image' && overlays.length === 0) {
      return { path: 'image', clip: single, assetId: asset.id }
    }
    // Untrimmed full-length single video → fast path keeps audio.
    const full =
      asset.durationSec == null ||
      Math.abs(single.duration - asset.durationSec) < 0.1
    if (single.type === 'video' && full) {
      return { path: 'video', clip: single, assetId: asset.id, overlays }
    }
  }

  return { path: 'timeline' }
}
