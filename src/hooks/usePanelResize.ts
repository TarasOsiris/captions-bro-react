// Drag-to-resize for the two desktop side columns (media on the left, inspector
// on the right). ONE implementation, so the two edges cannot drift apart — the
// same reason `useClipInsert` exists for the two insertion paths.
//
// Four rules carry this file:
//
//   - **The width is written to the DOM, never to React state.** A state write
//     per pointermove would re-render the panel's subtree — every inspector
//     control, every bin tile — at pointer rate. Same defence as the
//     rAF-throttled sliders; the writes themselves are rAF-coalesced too, since
//     a 1000Hz mouse fires pointermove far faster than the screen updates.
//   - **`preferred` is the user's choice; the rendered width is what fits.**
//     They are different numbers, and only `preferred` is ever persisted. A
//     narrow window renders a panel smaller than the user picked, and touching
//     the handle there must not overwrite the wider preference behind their back.
//   - **The preview floor is enforced on the PAIR.** Each panel is legal on its
//     own and the two together are not, so the panels share a module-level
//     registry and re-fit through the pure `fitPanels` on every window resize.
//   - **The separator is a real widget.** It takes focus on press (the
//     `preventDefault` that stops text selection would otherwise stop focus
//     too), and it CONSUMES every key `useEditorKeyboard` listens for — that
//     hook's window listener only skips INPUT/TEXTAREA, so an unconsumed
//     Backspace on a focused splitter deletes the selected clip.
//   - **A panel that leaves the row hands its budget back.** `isLive` stops
//     counting a `display:none` panel the moment its class flips, but nothing
//     re-fits on a class change — `unregister` doesn't either — so the
//     neighbouring column would keep whatever squeezed width it last had. The
//     `hidden` option exists to close that: pass it and the hook re-fits.
//
// The gesture follows the project's pointer rules: exclusive (a second pointer
// can't hijack a running drag), `pointercancel` restores instead of committing,
// and `isPrimaryPointer` keeps a right-press from starting a stuck drag.

import { useCallback, useEffect, useRef } from 'react'
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect'
import { EDITOR_BARE_KEY_CODES } from './useEditorKeyboard'
import { isPrimaryPointer } from '@/lib/pointer'
import {
  clampPanelWidth,
  fitPanels,
  loadPanelWidth,
  savePanelWidth,
} from '@/lib/persistence/layoutPrefs'
import type { PanelWidthSpec } from '@/lib/persistence/layoutPrefs'

/** ←/→ step on the focused separator (px). */
const KEY_STEP = 16

/** Keys the separator acts on itself, so they must reach its switch rather
 *  than being swallowed by the global-shortcut guard above it. */
const SEPARATOR_HANDLED_CODES: readonly string[] = [
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
]

interface Entry {
  el: HTMLElement
  handle: HTMLElement | null
  spec: PanelWidthSpec
  /** What the user picked. Persisted; may exceed what currently fits. */
  preferred: number
}

interface Drag {
  pointerId: number
  startX: number
  /** Rendered width when the press landed. */
  startW: number
  /** Stored preference when the press landed — restored if nothing happens. */
  startPreferred: number
  maxW: number
  /** Latest target width, written on the next frame. */
  pendingW: number
  moved: boolean
}

// ---------------------------------------------------------------------------
// The shared row budget. Both panels are in the same flex row, so the only
// place that can honour the preview's minimum is one that sees them together.

const panels = new Set<Entry>()
let resizeRaf = 0

function isLive(e: Entry): boolean {
  // `display:none` below `lg` — a hidden panel takes no space and must not eat
  // any of the budget.
  return e.el.getClientRects().length > 0
}

function writeWidth(e: Entry, px: number): void {
  e.el.style.width = `${px}px`
  e.handle?.setAttribute('aria-valuenow', String(px))
}

/** Re-fit every visible panel into its row. Reads `preferred`, never writes it. */
function relayout(): void {
  const live = [...panels].filter(isLive)
  if (live.length === 0) return
  const row = live[0].el.parentElement?.clientWidth ?? window.innerWidth
  const fitted = fitPanels(
    live.map((e) => ({ ...e.spec, preferred: e.preferred })),
    row,
  )
  live.forEach((e, i) => {
    writeWidth(e, fitted[i])
  })
}

function onWindowResize(): void {
  if (resizeRaf) return
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0
    relayout()
  })
}

function register(entry: Entry): void {
  if (panels.size === 0) window.addEventListener('resize', onWindowResize)
  panels.add(entry)
  relayout()
}

function unregister(entry: Entry): void {
  panels.delete(entry)
  if (panels.size === 0) {
    window.removeEventListener('resize', onWindowResize)
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf)
      resizeRaf = 0
    }
  }
}

// ---------------------------------------------------------------------------

export interface PanelResize {
  /** Spread onto the element whose width is being changed. */
  panelProps: {
    ref: React.RefObject<HTMLElement | null>
    style: { width: number }
  }
  /** Spread onto the separator element — ref, a11y, handlers and its own class. */
  handleProps: React.ComponentPropsWithRef<'div'>
}

export function usePanelResize(
  spec: PanelWidthSpec,
  {
    edge,
    label,
    hidden = false,
  }: {
    /** Which edge of the panel the handle sits on. Dragging AWAY from the panel
     *  widens it. */
    edge: 'left' | 'right'
    /** Accessible name for the separator, e.g. "Resize inspector". */
    label: string
    /** True while the caller has taken this panel out of the row (collapsed).
     *  The caller still flips its own `display`; this only tells the hook when
     *  to hand the freed width back to the other panels. */
    hidden?: boolean
  },
): PanelResize {
  const panelRef = useRef<HTMLElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const entryRef = useRef<Entry | null>(null)
  const drag = useRef<Drag | null>(null)
  const writeRaf = useRef(0)

  // A left-edge handle widens as the pointer moves left (negative dx).
  const sign = edge === 'left' ? -1 : 1

  useIsomorphicLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const entry: Entry = {
      el,
      handle: handleRef.current,
      spec,
      preferred: loadPanelWidth(spec) ?? spec.initial,
    }
    entryRef.current = entry
    register(entry)
    return () => {
      unregister(entry)
      entryRef.current = null
    }
  }, [spec])

  // Re-fit when this panel joins or leaves the row. A LAYOUT effect: it runs
  // after React has committed the caller's class change (so `getClientRects()`
  // already reads zero) and before paint — in a plain effect the neighbouring
  // column visibly lurches for one frame on every toggle.
  //
  // Deliberately a SECOND effect rather than `collapsed` in the register
  // effect's deps: re-registering on every toggle would discard the in-memory
  // `preferred` and re-read localStorage, losing an unsaved re-fit.
  useIsomorphicLayoutEffect(() => {
    relayout()
  }, [hidden])

  useEffect(
    () => () => {
      if (writeRaf.current) cancelAnimationFrame(writeRaf.current)
    },
    [],
  )

  const renderedWidth = useCallback(
    () => panelRef.current?.offsetWidth ?? spec.initial,
    [spec.initial],
  )

  /** Set the width the user is asking for: clamped to the panel's own bounds,
   *  recorded as the preference, and written to the DOM. */
  const setPreferred = useCallback(
    (px: number) => {
      const entry = entryRef.current
      const w = clampPanelWidth(spec, px)
      if (entry) {
        entry.preferred = w
        writeWidth(entry, w)
      }
      return w
    },
    [spec],
  )

  /** The live ceiling: the row minus the preview's floor minus whatever the
   *  OTHER panels currently render at. Measured, so it can't drift from the
   *  actual chrome. */
  const maxWidth = useCallback(() => {
    const entry = entryRef.current
    const el = panelRef.current
    if (!entry || !el) return spec.max
    const row = el.parentElement?.clientWidth ?? window.innerWidth
    const others = [...panels]
      .filter((e) => e !== entry && isLive(e))
      .reduce((a, e) => a + e.el.offsetWidth, 0)
    const budget = fitPanels(
      [{ ...spec, preferred: spec.max }],
      row - others,
    )[0]
    return Math.max(spec.min, Math.min(spec.max, budget))
  }, [spec])

  const flushWrite = useCallback(() => {
    writeRaf.current = 0
    const d = drag.current
    if (d) setPreferred(d.pendingW)
  }, [setPreferred])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Exclusive: a second pointer must not take over a running drag.
    if (!isPrimaryPointer(e) || drag.current) return
    const startW = renderedWidth()
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startW,
      // The preference as it stands, which is NOT `startW` on a window too
      // narrow to render it. An abandoned or cancelled gesture restores this.
      startPreferred: entryRef.current?.preferred ?? startW,
      maxW: maxWidth(),
      pendingW: startW,
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    // preventDefault stops the press selecting text across whatever it drags
    // over — but it also suppresses the focus that the compatibility mousedown
    // would have given the separator, so focus it by hand. Without this the
    // arrow keys reach `useEditorKeyboard` instead and seek the playhead.
    e.preventDefault()
    e.currentTarget.focus()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const next = Math.min(d.maxW, d.startW + (e.clientX - d.startX) * sign)
    if (next === d.pendingW) return
    d.pendingW = next
    d.moved = true
    // One DOM write per frame: each one resizes the PreviewStage, whose
    // ResizeObserver re-renders the stage.
    if (!writeRaf.current) writeRaf.current = requestAnimationFrame(flushWrite)
  }

  const endDrag = (commit: boolean) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (writeRaf.current) {
      cancelAnimationFrame(writeRaf.current)
      writeRaf.current = 0
    }
    // A press that never moved, or a cancelled one, is not a resize: put the
    // PREFERENCE back and save nothing. Committing the rendered width here is
    // how a click on a cramped window would quietly shrink a wider preference.
    if (!commit || !d.moved) {
      if (entryRef.current) entryRef.current.preferred = d.startPreferred
      relayout()
      return
    }
    // Persist the preference, not `offsetWidth` — same reason.
    savePanelWidth(spec, setPreferred(d.pendingW))
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return
    endDrag(true)
  }

  // Cancel ≠ up: the gesture was taken away, so it must not commit the dragged
  // width — put it back where the drag started.
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return
    endDrag(false)
  }

  /** Keys the separator OWNS, either because it acts on them or because letting
   *  them through would hit `useEditorKeyboard` (play/seek/jump/DELETE THE
   *  SELECTED CLIP) from a focused splitter. Everything else — Tab, Cmd+Z —
   *  passes through untouched. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Consumed with no effect: a separator does nothing on these, and the
    // global handler must not see them either. `useEditorKeyboard` listens on
    // WINDOW and only skips INPUT/TEXTAREA, so anything left unconsumed acts on
    // the timeline while the user is resizing a panel — an unconsumed
    // Backspace deleted the selected clip, and S/Q/W would split or trim it.
    //
    // Matched on `code`, the same namespace the list is defined in: comparing
    // `e.key` characters here disagreed with the listener on any non-QWERTY
    // layout. Keys the separator itself ACTS on fall through to the switch.
    if (
      EDITOR_BARE_KEY_CODES.includes(e.code) &&
      !SEPARATOR_HANDLED_CODES.includes(e.code)
    ) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    // Every surviving case assigns; `default` returns.
    let next: number
    switch (e.key) {
      case 'ArrowLeft':
        next = renderedWidth() - KEY_STEP * sign
        break
      case 'ArrowRight':
        next = renderedWidth() + KEY_STEP * sign
        break
      case 'Home':
        next = spec.min
        break
      case 'End':
        next = maxWidth()
        break
      case 'Enter':
        next = spec.initial
        break
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
    savePanelWidth(spec, setPreferred(Math.min(maxWidth(), next)))
  }

  return {
    panelProps: { ref: panelRef, style: { width: spec.initial } },
    handleProps: {
      ref: handleRef,
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': label,
      'aria-valuemin': spec.min,
      'aria-valuemax': spec.max,
      'aria-valuenow': spec.initial,
      tabIndex: 0,
      title: 'Drag to resize — double-click to reset',
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onKeyDown,
      onDoubleClick: () => {
        savePanelWidth(spec, setPreferred(spec.initial))
      },
      className: handleClass(edge),
    },
  }
}

/** The separator's look. The hit area is widened by a transparent `::after`
 *  rather than by growing the visual — same rule as the trim bars: the handle
 *  marks an exact edge. It grows INWARD only: overhanging the neighbouring
 *  PreviewStage would punch a hole in the app's drop target, and a file dropped
 *  there navigates the tab away from the editor. */
function handleClass(edge: 'left' | 'right'): string {
  const base =
    "absolute inset-y-0 z-10 w-1 cursor-col-resize touch-none transition-colors after:absolute after:inset-y-0 after:content-[''] hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
  return edge === 'left'
    ? `${base} left-0 after:left-0 after:-right-3`
    : `${base} right-0 after:right-0 after:-left-3`
}
