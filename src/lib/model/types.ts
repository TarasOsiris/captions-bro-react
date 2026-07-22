// The editor's domain model — a nested document tree (Project → Track → Clip)
// plus an asset registry. Follows the monorepo convention of a single "fat"
// interface keyed by a `type` string with per-type optional props (cf.
// screenshot-bro's Shape, fakechat's Message), not a strict discriminated union.
//
// Persistence boundary: fields marked RUNTIME-ONLY are re-derived on load (from
// the IndexedDB blob) and stripped before the document is serialized to
// localStorage. See src/lib/persistence/.

import type { Transform } from '@/lib/transform'
import type { MediaKind } from '@/lib/media'

export type { Transform }
export type { MediaKind }

export type ClipType = 'video' | 'image' | 'text' | 'audio'
export type TrackType = 'video' | 'audio' | 'overlay'

/** An imported source file. One asset can back many clips (split/duplicate). */
export interface MediaAsset {
  id: string
  kind: MediaKind
  name: string
  sizeBytes: number
  /** RUNTIME-ONLY: the decodable source (kept for export + re-persist to IndexedDB). */
  file: File
  /** RUNTIME-ONLY: object URL, re-created from the blob on load. */
  url: string
  /** Natural pixel dimensions (0 until metadata/load resolves them). */
  naturalWidth: number
  naturalHeight: number
  /** Video: intrinsic duration (s). Image: null (uses the default clip length). */
  durationSec: number | null
  /** RUNTIME-ONLY: filmstrip frames for the timeline; empty while generating. */
  thumbs: string[]
}

/** A placement of media (or generated content) on the timeline. */
export interface Clip {
  id: string
  type: ClipType
  /** Ref into `Project.assets`; null for asset-less clips (e.g. text). */
  assetId: string | null
  /** Timeline position, seconds from project start. */
  start: number
  /** On-timeline duration, seconds. */
  duration: number
  /** Source in-point, seconds (video/audio trimming). */
  trimIn: number
  /** Placement on the 16:9 canvas — see src/lib/transform.ts. */
  transform: Transform
  // Per-type optional props:
  text?: string
  fontSize?: number
  color?: string
  volume?: number
  muted?: boolean
}

export interface Track {
  id: string
  type: TrackType
  clips: Clip[]
}

export interface CanvasSettings {
  width: number
  height: number
  background: string
}

/** The whole editable document — the serializable + undoable unit. */
export interface Project {
  id: string
  name: string
  canvas: CanvasSettings
  tracks: Track[]
  assets: Record<string, MediaAsset>
}
