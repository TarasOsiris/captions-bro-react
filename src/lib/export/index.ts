// The single seam for the client-side video pipeline.
//
// `mediabunny` is imported DYNAMICALLY, inside functions only — never at module
// top level — so nothing WebCodecs-touching is evaluated during SSR (this
// module is reached from the route, which is server-rendered). The compositor
// and model modules are pure (SSR-safe), so they're imported statically.
//
// The output is a composition on the project's canvas: every frame is drawn
// with `drawScene` — the SAME renderer the preview uses — so the export matches
// the preview by construction (see the invariant in CLAUDE.md).
//
// Layout of this directory:
//   plan            which path to take (pure, tested)
//   imagePath /     the three encoders; each is orchestration only, over the
//   videoPath /     shared pieces below
//   timelinePath
//   cancel          CancelToken: the cancellation state machine + catch policy
//   frameLoop       the render→encode→finalize loop (structural types, no mb)
//   resources       LIFO teardown for decoders/bitmaps
//   canvas          even dimensions + the output surface
//   filename        one naming policy
//   progress        one 0…1 contract
//   result          buffer → ExportResult, discarded-track policy
//   audioMix        OfflineAudioContext shell over lib/model/audio's pure plan
//   capability      can this browser encode H.264, and what to tell the user

import { exportFileName } from './filename'
import { exportImage } from './imagePath'
import { planExport } from './plan'
import { exportTimeline } from './timelinePath'
import { exportVideo } from './videoPath'
import { intendsAudio } from '@/lib/model/audio'
import type { ExportHandle } from './types'
import type { Project } from '@/lib/model/types'

export {
  ExportCancelledError,
  ExportInvalidFileError,
  ExportUnsupportedError,
} from './errors'
export { canExportH264, exportCapability } from './capability'
export { planExport } from './plan'
export { exportFileName } from './filename'
export { ENCODE_END } from './progress'
export type { ExportCapability } from './capability'
export type { ExportPlan } from './plan'
export type { ExportHandle, ExportResult } from './types'

/**
 * Export the whole project, picking the best path: the fast single-source
 * encoders (which keep audio) for an untrimmed single clip plus any number of
 * text overlays, otherwise the frame-by-frame timeline compositor.
 */
export function exportProject(
  project: Project,
  opts?: { onProgress?: (fraction: number) => void },
): ExportHandle {
  const plan = planExport(project)
  // ONE naming policy, resolved here rather than per path — the fast paths used
  // to name by source file and the timeline path by project name, so the same
  // content exported under two different names depending on the plan.
  const fileName = exportFileName(project)

  if (plan.path === 'image') {
    return exportImage(project.assets[plan.assetId].file, {
      durationSec: plan.clip.duration,
      canvas: project.canvas,
      fileName,
      media: plan.clip,
      onProgress: opts?.onProgress,
    })
  }

  if (plan.path === 'video') {
    return exportVideo(project.assets[plan.assetId].file, {
      canvas: project.canvas,
      fileName,
      media: plan.clip,
      audio: plan.clip,
      onProgress: opts?.onProgress,
      overlays: plan.overlays,
      // Safe because the plan requires start === 0 && trimIn === 0, so project
      // time is exactly the sample timestamp.
      timeOffset: 0,
      hasAudio: intendsAudio(project),
    })
  }

  return exportTimeline(project, { fileName, onProgress: opts?.onProgress })
}
