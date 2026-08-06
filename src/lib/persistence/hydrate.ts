// Rebuild a live Project from its stored halves: the localStorage JSON
// (already migrated by loadStoredProject) + the IndexedDB media blobs. The
// I/O is injected — the same pattern as layout.ts's TextMeasurer — so the
// node test env can drive the whole transform without IndexedDB or object
// URLs. Its failure modes are DATA LOSS, which is why it reports what it
// dropped instead of discarding silently.

import { getAssetBlob } from './assetStore'
import { withTextDefaults } from '@/lib/model/text'
import type { MediaAsset, Project } from '@/lib/model/types'
import type { StoredProject } from './projectStore'

export interface HydrateDeps {
  loadBlob: (id: string) => Promise<Blob | undefined>
  createUrl: (file: File) => string
}

export interface HydrateResult {
  /** null = unrecoverable: the document had media and NONE of it survived. */
  project: Project | null
  /** Assets whose blobs were gone, and the clips dropped with them. */
  missingAssets: number
  droppedClips: number
}

const defaultDeps: HydrateDeps = {
  loadBlob: getAssetBlob,
  createUrl: (file) => URL.createObjectURL(file),
}

export async function hydrateProject(
  stored: StoredProject,
  deps: HydrateDeps = defaultDeps,
): Promise<HydrateResult> {
  const assets: Record<string, MediaAsset> = {}
  const missing = new Set<string>()
  for (const sa of stored.assets) {
    let blob: Blob | undefined
    try {
      blob = await deps.loadBlob(sa.id)
    } catch {
      blob = undefined
    }
    if (!blob) {
      missing.add(sa.id)
      continue
    }
    const file = new File([blob], sa.name, { type: blob.type })
    const url = deps.createUrl(file)
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
  // Drop clips whose media couldn't be restored (asset-less clips like text are
  // always kept), and normalize every text style so a document written by an
  // older build can never hand `undefined` to the layout engine.
  let droppedClips = 0
  const tracks = stored.tracks.map((t) => ({
    ...t,
    clips: t.clips
      .filter((c) => {
        const keep = c.assetId == null || !missing.has(c.assetId)
        if (!keep) droppedClips += 1
        return keep
      })
      .map((c) =>
        c.type === 'text'
          ? { ...c, textStyle: withTextDefaults(c.textStyle) }
          : c,
      ),
  }))
  const project: Project | null =
    stored.assets.length > 0 && Object.keys(assets).length === 0
      ? null
      : {
          id: stored.id,
          name: stored.name,
          canvas: stored.canvas,
          tracks,
          assets,
        }
  return { project, missingAssets: missing.size, droppedClips }
}
