// ONE filename policy for every export path.
//
// The name comes from the FIRST media asset in document order, falling back to
// the project name and then a generic stem. Rationale: `project.name` is always
// "Untitled project" (createProject takes no name from the UI and there is no
// rename affordance), so naming by project would make every multi-clip export
// `Untitled project-captions-bro.mp4`. Asset-first keeps the single-clip paths
// byte-identical to what they produced before and gives the timeline path a
// name that means something.

import { allClips } from '@/lib/model/selectors'
import type { Project } from '@/lib/model/types'

/** `"clip.mov"` → `"clip-captions-bro.mp4"`. */
export function mp4Name(base: string): string {
  const b = base.replace(/\.[^./\\]+$/, '') || 'video'
  return `${b}-captions-bro.mp4`
}

/** The suggested download name for a whole project. */
export function exportFileName(project: Project): string {
  for (const clip of allClips(project)) {
    if (clip.assetId == null) continue
    const asset = project.assets[clip.assetId] as { name?: string } | undefined
    if (asset?.name) return mp4Name(asset.name)
  }
  return mp4Name(project.name || 'video')
}
