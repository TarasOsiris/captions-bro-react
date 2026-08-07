// Which inspector a selection gets. Pure, and its own module rather than a
// ternary inside InspectorBody, so the routing table is unit-testable in the
// node env — there is no component test harness in this project.

import type { Clip } from './types'

export type InspectorKind =
  /** Nothing selected. */
  | 'empty'
  /** A generated text clip → TextInspector. */
  | 'text'
  /** A video or image clip → MediaInspector. */
  | 'media'
  /** A clip type with no inspector yet (audio clips, once they exist). */
  | 'unsupported'

export function inspectorKindForClip(
  clip: Clip | null | undefined,
): InspectorKind {
  if (!clip) return 'empty'
  switch (clip.type) {
    case 'text':
      return 'text'
    case 'video':
    case 'image':
      return 'media'
    default:
      return 'unsupported'
  }
}

/** The inspector header label for a kind. A record rather than a switch: still
 *  exhaustive by type, and half the lines. */
const TITLES: Record<InspectorKind, string> = {
  empty: 'Inspector',
  text: 'Text',
  media: 'Media',
  unsupported: 'Inspector',
}

export function inspectorTitle(kind: InspectorKind): string {
  return TITLES[kind]
}
