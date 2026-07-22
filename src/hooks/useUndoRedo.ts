// Snapshot-based undo/redo over the document, ported from screenshot-bro's
// useUndoRedo. The undoable unit is the whole `Project`; session state
// (playhead/selection/export) is deliberately not captured.
//
// Convention: a mutating interaction calls `saveUndo()` BEFORE it mutates (once
// per gesture, not per frame). immer produces frozen project snapshots, so
// stashing the reference is safe.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorStore } from '@/store/editorStore'
import type { Project } from '@/lib/model/types'

const UNDO_LIMIT = 50

export function useUndoRedo() {
  const undoStack = useRef<Project[]>([])
  const redoStack = useRef<Project[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const saveUndo = useCallback(() => {
    const current = useEditorStore.getState().project
    const stack = undoStack.current
    // immer only makes a new project reference on real change, so an identical
    // top means nothing happened since the last save (e.g. a click that selected
    // but didn't move) — don't stack a no-op entry.
    if (stack.length > 0 && stack[stack.length - 1] === current) return
    undoStack.current = [...stack.slice(-(UNDO_LIMIT - 1)), current]
    redoStack.current = []
    setCanUndo(true)
    setCanRedo(false)
  }, [])

  const undo = useCallback(() => {
    const stack = undoStack.current
    if (stack.length === 0) return
    const prev = stack[stack.length - 1]
    undoStack.current = stack.slice(0, -1)
    redoStack.current = [...redoStack.current, useEditorStore.getState().project]
    useEditorStore.getState().replaceProject(prev)
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(true)
  }, [])

  const redo = useCallback(() => {
    const stack = redoStack.current
    if (stack.length === 0) return
    const next = stack[stack.length - 1]
    redoStack.current = stack.slice(0, -1)
    undoStack.current = [...undoStack.current, useEditorStore.getState().project]
    useEditorStore.getState().replaceProject(next)
    setCanUndo(true)
    setCanRedo(redoStack.current.length > 0)
  }, [])

  /** Drop history — call on document load, where old snapshots point at revoked URLs. */
  const reset = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    setCanUndo(false)
    setCanRedo(false)
  }, [])

  // Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z = redo.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
    }
  }, [undo, redo])

  return { saveUndo, undo, redo, reset, canUndo, canRedo }
}
