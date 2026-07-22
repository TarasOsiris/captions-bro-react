// Auto-save/restore the current document. The JSON goes to localStorage
// (debounced); media blobs go to IndexedDB. On mount we hydrate the saved project
// — re-creating each asset's File + object URL from its stored blob and dropping
// clips whose media is gone — then regenerate video filmstrips (not persisted).

import { useEffect, useState } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { getAssetBlob } from '@/lib/persistence/assetStore'
import { loadStoredProject, saveProject } from '@/lib/persistence/projectStore'
import { generateFilmstrip } from '@/lib/thumbs'
import type { MediaAsset, Project } from '@/lib/model/types'
import type { StoredProject } from '@/lib/persistence/projectStore'

async function hydrate(stored: StoredProject): Promise<Project | null> {
  const assets: Record<string, MediaAsset> = {}
  const missing = new Set<string>()
  for (const sa of stored.assets) {
    let blob: Blob | undefined
    try {
      blob = await getAssetBlob(sa.id)
    } catch {
      blob = undefined
    }
    if (!blob) {
      missing.add(sa.id)
      continue
    }
    const file = new File([blob], sa.name, { type: blob.type })
    const url = URL.createObjectURL(file)
    assets[sa.id] = {
      id: sa.id,
      kind: sa.kind,
      name: sa.name,
      sizeBytes: sa.sizeBytes,
      file,
      url,
      naturalWidth: sa.naturalWidth,
      naturalHeight: sa.naturalHeight,
      durationSec: sa.durationSec,
      thumbs: sa.kind === 'image' ? [url] : [],
    }
  }
  // Drop clips whose media couldn't be restored.
  const tracks = stored.tracks.map((t) => ({
    ...t,
    clips: t.clips.filter((c) => c.assetId == null || !missing.has(c.assetId)),
  }))
  if (stored.assets.length > 0 && Object.keys(assets).length === 0) return null
  return {
    id: stored.id,
    name: stored.name,
    canvas: stored.canvas,
    tracks,
    assets,
  }
}

export function usePersistence() {
  const [ready, setReady] = useState(false)

  // Restore on mount (once).
  useEffect(() => {
    const stored = loadStoredProject()
    if (!stored) {
      setReady(true)
      return
    }
    let alive = true
    hydrate(stored).then(
      (project) => {
        if (!alive) return
        if (project) {
          useEditorStore.getState().replaceProject(project)
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
  // the fresh empty project would clobber the saved one.
  const project = useEditorStore((s) => s.project)
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => {
      saveProject(project)
    }, 300)
    return () => {
      clearTimeout(t)
    }
  }, [project, ready])
}
