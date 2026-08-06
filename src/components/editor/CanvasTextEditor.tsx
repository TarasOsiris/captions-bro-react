// Inline text editing on the preview canvas.
//
// THE TRICK: the textarea's own glyphs are transparent — only its CARET and
// native selection show. The canvas underneath keeps drawing the real text via
// the same `drawScene` the export uses, so what you edit is literally the
// exported pixels. No "hide this clip while editing" hook, and therefore no way
// for the editing view and the output to disagree.
//
// A real <textarea> rather than contentEditable, deliberately: `useEditorKeyboard`
// already skips its global shortcuts (undo included) for TEXTAREA targets, so
// Space, Delete and Cmd+Z stop fighting the editor for free — and emoji, IME
// composition and the mobile keyboard all just work.

import { useEffect, useLayoutEffect, useRef } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { clipById } from '@/lib/model/selectors'
import { withAlpha, withTextDefaults } from '@/lib/model/text'
import type { MediaRect } from '@/lib/transform'

export function CanvasTextEditor({
  clipId,
  rect,
  frameH,
  onClose,
}: {
  clipId: string
  /** The same rect the selection chrome uses, in frame CSS pixels. */
  rect: MediaRect
  /** Frame height, to resolve `fontSize` (a fraction of it) into pixels. */
  frameH: number
  onClose: () => void
}) {
  const clip = useEditorStore((s) => clipById(s.project, clipId))
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  // One undo entry per editing run: the store session opens on the first
  // keystroke (beginEditSession below) and ends when the editor goes away —
  // unmount covers every close path at once (blur, Escape, seek-away).
  useEffect(
    () => () => {
      useEditorStore.getState().endEditSession()
    },
    [],
  )

  // Escape and Cmd/Ctrl+Enter close; plain Enter inserts a newline, since
  // multi-line is a first-class feature here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' ||
        (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
      ) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  if (!clip || clip.type !== 'text') return null
  const style = withTextDefaults(clip.textStyle)
  const fontPx = style.fontSize * frameH

  return (
    <textarea
      ref={ref}
      value={clip.text ?? ''}
      onChange={(e) => {
        const st = useEditorStore.getState()
        st.beginEditSession()
        st.updateClip(clipId, { text: e.target.value })
      }}
      onBlur={onClose}
      // Stop the frame's own pointer handlers from starting a move gesture or
      // deselecting while the caret is being placed.
      onPointerDown={(e) => {
        e.stopPropagation()
      }}
      spellCheck={false}
      aria-label="Edit text"
      style={{
        left: `${(rect.cx - rect.w / 2).toFixed(2)}px`,
        top: `${(rect.cy - rect.h / 2).toFixed(2)}px`,
        width: `${rect.w.toFixed(2)}px`,
        height: `${rect.h.toFixed(2)}px`,
        transform: `rotate(${rect.rotationDeg.toString()}deg)`,
        transformOrigin: 'center',
        // Mirror the canvas typography so the caret and the native selection
        // rectangle land on the glyphs the compositor drew.
        fontFamily: `"${style.fontFamily}", system-ui, sans-serif`,
        fontWeight: style.bold ? 700 : 400,
        fontStyle: style.italic ? 'italic' : 'normal',
        fontSize: `${fontPx.toFixed(2)}px`,
        lineHeight: style.lineHeight,
        letterSpacing: `${(style.letterSpacing * fontPx).toFixed(2)}px`,
        textAlign: style.align,
        padding: `${(style.bgPaddingY * fontPx).toFixed(2)}px ${(style.bgPaddingX * fontPx).toFixed(2)}px`,
        textTransform:
          style.case === 'upper'
            ? 'uppercase'
            : style.case === 'capitalize'
              ? 'capitalize'
              : 'none',
        // Invisible glyphs, visible caret — the canvas is what you actually see.
        color: 'transparent',
        caretColor: withAlpha(style.color, 1),
      }}
      // `touch-auto` so a tap can place the caret inside the otherwise
      // `touch-none` preview frame.
      className="pointer-events-auto absolute z-30 touch-auto resize-none overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent outline-none selection:bg-accent/40"
    />
  )
}
