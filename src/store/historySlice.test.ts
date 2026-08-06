// Drives the real store, like documentSlice.test.ts. History is snapshot-
// before-mutation: beginEdit (discrete) / beginEditSession…endEditSession
// (continuous, one snapshot per session no matter how many writes).

import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './editorStore'
import { selectCanRedo, selectCanUndo } from './historySlice'
import { createProject, createTextClip } from '@/lib/model/factories'

const st = () => useEditorStore.getState()

/** Fresh project with one overlay text clip to edit. */
function seed(): string {
  st().replaceProject(createProject('history-test'))
  const laneId = st().addOverlayTrack()
  const clip = createTextClip({ start: 0, duration: 2, content: 'seed' })
  st().addClip(clip, laneId)
  // The seeding edits above are not part of the scenario under test.
  useEditorStore.setState({
    undoStack: [],
    redoStack: [],
    snapshotPending: false,
    editSessionOpen: false,
  })
  return clip.id
}

const clipText = (id: string) => {
  for (const t of st().project.tracks)
    for (const c of t.clips) if (c.id === id) return c.text
  return undefined
}

describe('historySlice', () => {
  let clipId = ''
  beforeEach(() => {
    clipId = seed()
  })

  it('beginEdit → mutate → undo restores → redo reapplies', () => {
    st().updateClip(clipId, { text: 'one' })
    st().beginEdit()
    st().updateClip(clipId, { text: 'two' })
    expect(selectCanUndo(st())).toBe(true)
    st().undo()
    expect(clipText(clipId)).toBe('one')
    expect(selectCanRedo(st())).toBe(true)
    st().redo()
    expect(clipText(clipId)).toBe('two')
  })

  it('arming without mutating stacks nothing (snapshot is lazy)', () => {
    st().beginEdit()
    st().updateClip(clipId, { text: 'x' })
    st().beginEdit() // armed…
    st().beginEdit() // …and re-armed, but no mutation ever lands
    expect(st().undoStack).toHaveLength(1)
  })

  it('an un-armed (background) mutation creates no undo entry', () => {
    // The real case: PreviewStage.onVideoMeta correcting a placeholder
    // duration — nobody called beginEdit, so nothing stacks.
    st().updateClip(clipId, { text: 'background' })
    expect(st().undoStack).toHaveLength(0)
  })

  it('any content mutation clears a pending redo (the branch is stale)', () => {
    st().beginEdit()
    st().updateClip(clipId, { text: 'x' })
    st().undo()
    expect(selectCanRedo(st())).toBe(true)
    st().updateClip(clipId, { text: 'unrelated' }) // background write
    expect(selectCanRedo(st())).toBe(false)
  })

  it('a no-op gesture preserves a pending redo', () => {
    st().beginEdit()
    st().updateClip(clipId, { text: 'x' })
    st().undo()
    expect(selectCanRedo(st())).toBe(true)
    st().beginEdit() // e.g. a click that selected but didn't move
    expect(selectCanRedo(st())).toBe(true)
  })

  it('a session collapses N writes into ONE undo entry', () => {
    st().beginEditSession()
    st().updateClip(clipId, { text: 'a' })
    st().beginEditSession() // per-move calls are free while the session is open
    st().updateClip(clipId, { text: 'ab' })
    st().updateClip(clipId, { text: 'abc' })
    st().endEditSession()
    expect(st().undoStack).toHaveLength(1)
    st().undo()
    expect(clipText(clipId)).toBe('seed')
  })

  it('a second session gets its own entry', () => {
    st().beginEditSession()
    st().updateClip(clipId, { text: 'a' })
    st().endEditSession()
    st().beginEditSession()
    st().updateClip(clipId, { text: 'b' })
    st().endEditSession()
    expect(st().undoStack).toHaveLength(2)
    st().undo()
    expect(clipText(clipId)).toBe('a')
  })

  it('beginEdit self-heals a leaked session', () => {
    st().beginEditSession()
    st().updateClip(clipId, { text: 'dragged' }) // …and the blur never fired
    st().beginEdit()
    expect(st().editSessionOpen).toBe(false)
    st().updateClip(clipId, { text: 'clicked' })
    st().undo()
    expect(clipText(clipId)).toBe('dragged')
  })

  it('endEditSession is idempotent', () => {
    st().endEditSession()
    st().endEditSession()
    expect(st().editSessionOpen).toBe(false)
  })

  it('undo/redo on empty stacks are no-ops', () => {
    const before = st().project
    st().undo()
    st().redo()
    expect(st().project).toBe(before)
  })

  it('caps the stack at 50, dropping the oldest', () => {
    for (let i = 0; i < 60; i++) {
      st().beginEdit()
      st().updateClip(clipId, { text: `v${i.toString()}` })
    }
    expect(st().undoStack).toHaveLength(50)
    // Undo all the way down: the floor is v9's snapshot (v0–v8 dropped).
    while (selectCanUndo(st())) st().undo()
    expect(clipText(clipId)).toBe('v9')
  })

  it('replaceProject clears history — the hydration regression', () => {
    st().beginEdit()
    st().updateClip(clipId, { text: 'edited' })
    expect(selectCanUndo(st())).toBe(true)
    st().replaceProject(createProject('restored'))
    expect(selectCanUndo(st())).toBe(false)
    expect(selectCanRedo(st())).toBe(false)
    st().undo() // must be a no-op, not a restore of the dead document
    expect(st().project.name).toBe('restored')
  })

  it('undo invalidates a finished export', () => {
    st().beginEdit()
    st().updateClip(clipId, { text: 'edited' })
    useEditorStore.setState({
      exportPhase: 'done',
      downloadUrl: 'blob:x',
      downloadName: 'x.mp4',
    })
    st().undo()
    expect(st().exportPhase).toBe('idle')
    expect(st().downloadUrl).toBeNull()
  })
})
