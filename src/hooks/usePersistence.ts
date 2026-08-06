// Auto-save/restore the current document. The JSON goes to localStorage
// (debounced); media blobs go to IndexedDB. On mount we hydrate the saved
// project via lib/persistence/hydrate — re-creating each asset's File + object
// URL from its stored blob and dropping clips whose media is gone — then
// regenerate video filmstrips (not persisted). Loss is never silent: dropped
// clips, an unrecoverable document and a failing auto-save all get a toast.

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useEditorStore } from '@/store/editorStore'
import { hydrateProject } from '@/lib/persistence/hydrate'
import {
  clearStoredProject,
  loadStoredProject,
  saveProject,
} from '@/lib/persistence/projectStore'
import { generateFilmstrip } from '@/lib/thumbs'

/**
 * Returns `{ hydrated }` — false until the restore attempt has settled.
 *
 * It is exported because restore ends in `replaceProject`, which swaps the
 * document WHOLESALE: anything written before that lands is silently thrown
 * away. In-app edits can't hit that window (there is nothing to click yet), but
 * an OS-delivered file can — see `useLaunchFiles`, which waits on this.
 */
export function usePersistence(): { hydrated: boolean } {
  const [ready, setReady] = useState(false)

  // Restore on mount (once).
  useEffect(() => {
    const stored = loadStoredProject()
    if (!stored) {
      setReady(true)
      return
    }
    let alive = true
    hydrateProject(stored).then(
      ({ project, droppedClips }) => {
        if (!alive) return
        if (project) {
          useEditorStore.getState().replaceProject(project)
          if (droppedClips > 0) {
            toast.warning(
              droppedClips === 1
                ? 'One clip was removed — its media could not be restored.'
                : `${droppedClips.toString()} clips were removed — their media could not be restored.`,
            )
          }
          for (const asset of Object.values(project.assets)) {
            if (asset.kind !== 'video') continue
            const { id, url } = asset
            generateFilmstrip(url).then(
              (frames) => {
                if (frames.length === 0) return
                const cur = useEditorStore.getState().project.assets
                if (Object.hasOwn(cur, id) && cur[id].url === url) {
                  useEditorStore.getState().updateAsset(id, { thumbs: frames })
                }
              },
              () => {},
            )
          }
        } else {
          // The document had media and none of it survived. Clear it — an
          // unloadable document would otherwise be retried (and silently
          // fail) on every future visit.
          clearStoredProject()
          toast.error(
            "Couldn't restore your last project — its media is no longer available.",
          )
        }
        setReady(true)
      },
      () => {
        if (alive) setReady(true)
      },
    )
    return () => {
      alive = false
    }
  }, [])

  // Debounced save on document change — but never before the restore attempt, or
  // the fresh empty project would clobber the saved one. A failing save warns
  // ONCE (per failure streak, not per keystroke) — storage-full is exactly the
  // state where "your work is not being saved" must reach the user.
  const project = useEditorStore((s) => s.project)
  const saveFailedRef = useRef(false)
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => {
      const ok = saveProject(project)
      if (!ok && !saveFailedRef.current) {
        toast.warning(
          'Your project could not be auto-saved — storage is full or unavailable.',
        )
      }
      saveFailedRef.current = !ok
    }, 300)
    return () => {
      clearTimeout(t)
    }
  }, [project, ready])

  return { hydrated: ready }
}
