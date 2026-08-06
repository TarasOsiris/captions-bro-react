// Versioned migrations over the STORED document shape. `loadStoredProject`
// runs these before anything else sees the JSON, so the rest of the app only
// ever handles the current shape. Forward-compat normalization that must run
// on EVERY load — e.g. `withTextDefaults` filling style fields added within a
// version — lives in hydrate, not here: a migration runs once per document,
// a normalization runs always.

import { normalizeLaneOverlaps } from '@/lib/model/lanes'
import type { StoredProject } from './projectStore'

export const CURRENT_VERSION = 2

/** vN → vN+1 upgraders, keyed by the version they upgrade FROM. */
const MIGRATIONS: Partial<Record<number, (p: StoredProject) => StoredProject>> =
  {
    // v1 → v2: documents written before overlay lanes stopped overlapping could
    // stack clips on one lane; spread those across lanes once, on the way in.
    // normalizeLaneOverlaps reads only `tracks`, so the empty asset record is
    // fine — StoredProject and Project differ solely in that field.
    1: (p) => ({
      ...p,
      tracks: normalizeLaneOverlaps({
        id: p.id,
        name: p.name,
        canvas: p.canvas,
        tracks: p.tracks,
        assets: {},
      }).tracks,
    }),
  }

/**
 * Bring a stored document up to CURRENT_VERSION, one step at a time. Returns
 * null for a document written by a FUTURE build — don't guess at its shape,
 * and don't clear it either: a rollback must not destroy a newer build's work.
 */
export function migrateStoredProject(
  stored: StoredProject,
): StoredProject | null {
  // Every build has written `version: 1` since persistence shipped; treat a
  // missing field as v1 all the same.
  let version = typeof stored.version === 'number' ? stored.version : 1
  if (version > CURRENT_VERSION) return null
  let doc = stored
  while (version < CURRENT_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) return null
    doc = step(doc)
    version += 1
  }
  return { ...doc, version: CURRENT_VERSION }
}
