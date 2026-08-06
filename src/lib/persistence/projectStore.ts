// The document JSON lives in localStorage (debounced). Runtime-only asset fields
// (the File, its object URL, filmstrip thumbs) are stripped before serializing and
// re-derived on load from the IndexedDB blob (see assetStore + usePersistence).
// Pure/SSR-safe: guarded localStorage access, no DOM.

import { CURRENT_VERSION, migrateStoredProject } from './migrations'
import type {
  CanvasSettings,
  MediaAsset,
  Project,
  Track,
} from '@/lib/model/types'

const KEY = 'cb-project'

/** The RUNTIME-ONLY fields of a MediaAsset — re-derived on load from the
 *  IndexedDB blob, never serialized. Named here so `StoredAsset` below is
 *  DERIVED from the live type: a new runtime-only field must be added to this
 *  list, and a new persisted field flows through automatically. Hand-restating
 *  the persisted subset let the two drift silently. */
type RuntimeAssetField = 'file' | 'url' | 'thumbs'

type StoredAsset = Omit<MediaAsset, RuntimeAssetField>

export interface StoredProject {
  version: number
  id: string
  name: string
  canvas: CanvasSettings
  tracks: Track[]
  assets: StoredAsset[]
}

/** Drop the runtime-only fields. Destructured rather than picked field-by-field
 *  so `StoredAsset`'s derivation and this function stay in step — a new
 *  persisted field is carried automatically. */
function storeAsset({ file, url, thumbs, ...rest }: MediaAsset): StoredAsset {
  void file
  void url
  void thumbs
  return rest
}

export function serializeProject(project: Project): StoredProject {
  return {
    version: CURRENT_VERSION,
    id: project.id,
    name: project.name,
    canvas: project.canvas,
    tracks: project.tracks,
    assets: Object.values(project.assets).map(storeAsset),
  }
}

/** Returns false when the write failed (quota exceeded / unavailable) so the
 *  caller can tell the user their work is not being saved — losing the save
 *  silently was the one persistence failure with real cost. */
export function saveProject(project: Project): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(serializeProject(project)))
    return true
  } catch {
    return false
  }
}

/** Minimal defensive validation, then versioned migration; returns null on
 *  anything unexpected (including a document from a future build). */
export function loadStoredProject(): StoredProject | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as StoredProject).tracks) ||
      !Array.isArray((parsed as StoredProject).assets)
    ) {
      return null
    }
    return migrateStoredProject(parsed as StoredProject)
  } catch {
    return null
  }
}

export function clearStoredProject(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
