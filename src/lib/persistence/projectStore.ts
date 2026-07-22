// The document JSON lives in localStorage (debounced). Runtime-only asset fields
// (the File, its object URL, filmstrip thumbs) are stripped before serializing and
// re-derived on load from the IndexedDB blob (see assetStore + usePersistence).
// Pure/SSR-safe: guarded localStorage access, no DOM.

import type { CanvasSettings, MediaKind, Project, Track } from '@/lib/model/types'

const KEY = 'cb-project'
const VERSION = 1

interface StoredAsset {
  id: string
  kind: MediaKind
  name: string
  sizeBytes: number
  naturalWidth: number
  naturalHeight: number
  durationSec: number | null
}

export interface StoredProject {
  version: number
  id: string
  name: string
  canvas: CanvasSettings
  tracks: Track[]
  assets: StoredAsset[]
}

export function serializeProject(project: Project): StoredProject {
  return {
    version: VERSION,
    id: project.id,
    name: project.name,
    canvas: project.canvas,
    tracks: project.tracks,
    assets: Object.values(project.assets).map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      sizeBytes: a.sizeBytes,
      naturalWidth: a.naturalWidth,
      naturalHeight: a.naturalHeight,
      durationSec: a.durationSec,
    })),
  }
}

export function saveProject(project: Project): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(serializeProject(project)))
  } catch {
    // Quota exceeded / unavailable — persistence is best-effort.
  }
}

/** Minimal defensive validation; returns null on anything unexpected. */
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
    return parsed as StoredProject
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
