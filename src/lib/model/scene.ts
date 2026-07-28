// Resolving the document to a specific time: which clips are live at project time
// `t`, in draw order (bottom track first, top track last). Pure + SSR-safe; the
// caller attaches the actual decoded source to each item (a <video>/<img> in the
// preview, a mediabunny frame in export) before handing the list to the compositor.

import { assetOf, clipIsLiveAt, projectDuration } from './selectors'
import type { Clip, MediaAsset, Project } from './types'

export interface SceneItem {
  clip: Clip
  asset: MediaAsset | null
  /** Time within the source (s): `trimIn + (t - start)`. Drives video seeking. */
  localTime: number
}

/** Clips visible at project time `t`, in draw order. Audio tracks are excluded.
 *  Liveness is the half-open `clipIsLiveAt` window, so at a packed boundary only
 *  the later clip is live — two clips sharing an edge never both draw. The one
 *  exception is the exact timeline end (`t === projectDuration`): the clip ending
 *  there is held on screen so the canvas doesn't flash to black on the final
 *  frame. Nothing starts at that instant, so the hold can never overlap. */
export function resolveScene(project: Project, t: number): SceneItem[] {
  const items: SceneItem[] = []
  const end = projectDuration(project)
  for (const track of project.tracks) {
    if (track.type === 'audio') continue
    for (const clip of track.clips) {
      const live =
        clipIsLiveAt(clip, t) ||
        (t === end && clip.start + clip.duration === end)
      if (live) {
        items.push({
          clip,
          asset: assetOf(project, clip),
          localTime: clip.trimIn + (t - clip.start),
        })
      }
    }
  }
  return items
}
