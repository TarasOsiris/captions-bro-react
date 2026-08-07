// THE clip-level commands: split, trim-to-playhead, duplicate, delete, and
// cut/copy/paste. One definition, three renderings — the desktop toolbar, the
// mobile contextual pill and the keyboard all call these, so they cannot
// disagree about what "split" means or how many undo entries it costs.
//
// Before this, `Timeline.tsx` and `useEditorKeyboard.ts` each had their own copy
// of delete (begin-edit → remove → deselect), which is exactly the kind of
// duplication that drifts.
//
// A hook rather than store actions, for the reason useClipInsert states: these
// span the document, selection and clipboard slices, and src/hooks/ is this
// codebase's home for cross-slice orchestration. Every command reads state
// imperatively via `getState()` and returns a STABLE callback, so handing them
// to the memoized ClipBox costs nothing.

import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore } from '@/store/editorStore'
import { useClipInsert } from './useClipInsert'
import {
  clipAtTime,
  clipById,
  isFreeLane,
  clipSourceLen,
  trackOfClip,
  trimToTimeWindow,
  videoTrack,
} from '@/lib/model/selectors'
import { cloneClip } from '@/lib/model/factories'
import { MIN_CLIP_DURATION } from '@/lib/model/lanes'
import type { Clip } from '@/lib/model/types'
import type { EditorState } from '@/store/editorStore'

/** The clip a command acts on: the selection, else the clip under the playhead
 *  on the main track. The fallback is what makes Split usable straight after a
 *  scrub, without a select-then-act round trip. */
function targetClip(st: EditorState): Clip | null {
  return (
    clipById(st.project, st.selectedClipId) ??
    clipAtTime(videoTrack(st.project), st.currentTime)
  )
}

/** Whether `t` sits strictly inside the clip — the precondition every
 *  playhead-relative command shares. */
function playheadInside(clip: Clip | null, t: number): clip is Clip {
  return clip != null && t > clip.start && t < clip.start + clip.duration
}

export interface ClipCommands {
  split: () => void
  trimToPlayhead: (edge: 'left' | 'right') => void
  duplicate: () => void
  remove: () => void
  copy: () => void
  cut: () => void
  paste: () => void
  /** Whether each command would do anything right now — so a toolbar button's
   *  disabled state and the command itself read ONE rule. They diverged while
   *  the Timeline had its own `canSplit`: the button greyed out with nothing
   *  selected while the S shortcut happily split the clip under the playhead. */
  can: { split: boolean; act: boolean; paste: boolean }
}

export function useClipCommands(): ClipCommands {
  const { insertClipAtTime } = useClipInsert()

  const split = useCallback(() => {
    const st = useEditorStore.getState()
    const clip = targetClip(st)
    if (!playheadInside(clip, st.currentTime)) return
    st.beginEdit()
    const halves = st.splitClip(clip.id, st.currentTime)
    // Select the RIGHT half, as CapCut does — you cut, then keep working
    // forward. Deselecting instead (the old behaviour) dropped you into an
    // empty inspector immediately after an edit.
    if (halves) st.selectClip(halves.rightId)
  }, [])

  const trimToPlayhead = useCallback((edge: 'left' | 'right') => {
    const st = useEditorStore.getState()
    const clip = targetClip(st)
    if (!playheadInside(clip, st.currentTime)) return
    const next = trimToTimeWindow(
      edge,
      clip,
      st.currentTime,
      clipSourceLen(st.project, clip),
      MIN_CLIP_DURATION,
    )
    if (!next) return
    st.beginEdit()
    // Through `setClipTrimWindow`, so the commit inherits the magnetic ripple
    // and the free-lane clamp rather than restating either.
    st.setClipTrimWindow(clip.id, next)
  }, [])

  const duplicate = useCallback(() => {
    const st = useEditorStore.getState()
    const clip = targetClip(st)
    if (!clip) return
    st.beginEdit()
    const newId = st.duplicateClip(clip.id)
    if (newId) st.selectClip(newId)
  }, [])

  const remove = useCallback(() => {
    const st = useEditorStore.getState()
    // `targetClip`, like every other command — Delete used to require a
    // selection while Cmd+X was happy to act on the playhead clip, a
    // difference nothing announced.
    const clip = targetClip(st)
    if (!clip) return
    st.beginEdit()
    st.removeClips([clip.id])
    st.selectClip(null)
  }, [])

  const copy = useCallback(() => {
    const st = useEditorStore.getState()
    const clip = targetClip(st)
    if (!clip) return
    // Cloned at COPY time: the source may be deleted (or cut) before the paste.
    st.setClipboard(cloneClip(clip))
  }, [])

  // Literally copy-then-remove. `removeClips` being plural is what keeps that
  // one undo entry: undo restores the clip AND the re-pack in a single step.
  const cut = useCallback(() => {
    copy()
    remove()
  }, [copy, remove])

  const paste = useCallback(() => {
    const st = useEditorStore.getState()
    const source = st.clipboard
    if (!source) return
    // A clip copied FROM a free lane goes back to one even though it has an
    // asset — otherwise pasting a picture-in-picture overlay would drop it into
    // the main track and shove the whole edit along.
    const origin = trackOfClip(st.project, source.id)
    insertClipAtTime(
      source,
      st.currentTime,
      source.assetId != null && !(origin && isFreeLane(origin)),
    )
  }, [insertClipAtTime])

  // Subscribed, not read via getState(): these drive button DISABLED states, so
  // they have to re-render when the answer changes. Atomic — three booleans.
  const can = useEditorStore(
    useShallow((s) => {
      const clip = targetClip(s)
      return {
        split: playheadInside(clip, s.currentTime),
        act: clip != null,
        paste: s.clipboard != null,
      }
    }),
  )

  // Memoized so the object identity is stable: `useEditorKeyboard` has it in an
  // effect dep list, and a fresh literal per render would tear down and re-add
  // the global keydown listener on every frame of a slider drag.
  return useMemo(
    () => ({ split, trimToPlayhead, duplicate, remove, copy, cut, paste, can }),
    [split, trimToPlayhead, duplicate, remove, copy, cut, paste, can],
  )
}
