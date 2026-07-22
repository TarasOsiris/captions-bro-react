// Resolving the document to a specific time: which clips are live at project time
// `t`, in draw order (bottom track first, top track last). Pure + SSR-safe; the
// caller attaches the actual decoded source to each item (a <video>/<img> in the
// preview, a mediabunny frame in export) before handing the list to the compositor.

import { assetOf } from './selectors'
import type { Clip, MediaAsset, Project } from './types'

export interface SceneItem {
  clip: Clip
  asset: MediaAsset | null
  /** Time within the source (s): `trimIn + (t - start)`. Drives video seeking. */
  localTime: number
}

/** Clips visible at project time `t`, in draw order. Audio tracks are excluded.
 *  The interval is inclusive of the end so a clip paused at its final frame stays
 *  on screen (rather than the canvas going black); at an exact clip boundary the
 *  later/topmost clip wins by draw order. */
export function resolveScene(project: Project, t: number): SceneItem[] {
  const items: SceneItem[] = []
  for (const track of project.tracks) {
    if (track.type === 'audio') continue
    for (const clip of track.clips) {
      if (t >= clip.start && t <= clip.start + clip.duration) {
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
