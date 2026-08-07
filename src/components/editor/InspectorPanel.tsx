// Right-side inspector. The contents live in `inspector/InspectorBody` so the
// desktop column and the mobile sheet render exactly the same controls; this
// file is only the desktop shell, its resize handle and its collapse.
//
// The column is always MOUNTED at lg+ — with or without a selection, since
// `InspectorBody` has its own empty state — so selecting a clip can't resize
// the preview under the user (the centered video used to jump on select/
// deselect). It can be hidden only by an EXPLICIT user action: the header's X
// collapses it to a narrow edge tab, and only that tab brings it back.
//
// That is why there is no reopen-on-select: it would put the width change back
// on the selection and undo the whole point. If you are tempted to add it, this
// comment is the reason not to.
//
// Below lg the column is dropped entirely (256px of dead space on a phone) and
// MobileDock shows the same body as a sheet — collapsed or not, so the mobile
// layout never sees this state.
//
// Resizing is `usePanelResize` — the same hook the media column uses, so the
// two edges behave identically. It also owns the re-fit when this panel leaves
// the row, via its `hidden` option.

import { useRef } from 'react'
import { ChevronLeft } from 'lucide-react'
import { InspectorBody } from './inspector/InspectorBody'
import { usePanelResize } from '@/hooks/usePanelResize'
import { useIsomorphicLayoutEffect } from '@/hooks/useIsomorphicLayoutEffect'
import { INSPECTOR_TAB_W, INSPECTOR_WIDTH } from '@/lib/persistence/layoutPrefs'
import { useEditorStore } from '@/store/editorStore'
import { cn } from '@/lib/utils'

export function InspectorPanel() {
  const collapsed = useEditorStore((s) => s.inspectorCollapsed)
  const setInspectorCollapsed = useEditorStore((s) => s.setInspectorCollapsed)
  const { panelProps, handleProps } = usePanelResize(INSPECTOR_WIDTH, {
    edge: 'left',
    label: 'Resize inspector',
    hidden: collapsed,
  })

  const tabRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const firstRun = useRef(true)

  // Focus handoff. Both controls hide THEMSELVES, so without this every toggle
  // drops focus on <body> — where `useEditorKeyboard`'s window listener is live
  // and a stray Backspace deletes the selected clip. The two buttons are one
  // control in two positions, so the handoff is symmetric and unconditional:
  // they are the only two writers of `inspectorCollapsed`.
  //
  // Skipping the first run matters: `collapsed` starts false, so acting on
  // mount would steal focus on every page load.
  useIsomorphicLayoutEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const next = collapsed ? tabRef.current : closeRef.current
    next?.focus({ preventScroll: true })
  }, [collapsed])

  return (
    <>
      <aside
        {...panelProps}
        className={cn(
          'relative hidden shrink-0 flex-col border-l border-edge bg-surface',
          // `hidden` is unconditional; only `lg:flex` brings it back. Collapsed
          // is therefore the same `display:none` the sub-lg layout already
          // uses, which is exactly what `usePanelResize`'s `isLive` tests for.
          //
          // Kept MOUNTED rather than conditionally rendered: unmounting would
          // destroy the accordion sections' open state and any in-flight
          // `useLiveField` draft, and `unregister` doesn't re-fit the row.
          !collapsed && 'lg:flex',
        )}
      >
        {/* First child: it sits on the LEFT edge, so this is also reading order. */}
        <div {...handleProps} />

        <InspectorBody variant="column" closeRef={closeRef} />
      </aside>

      {/* The collapsed column's only way back. A REAL flex sibling with a real
          width, never an absolutely-positioned strip: an overlay overhanging
          PreviewStage would sit outside its dragover/drop subtree, so a file
          dropped there navigates the tab away from the editor — session gone.
          Same reason the resize handle's ::after only grows inward, and the
          same reason this is a plain <button> rather than the `icon` Button,
          whose after:-inset-2 would overhang by 8px. */}
      <button
        ref={tabRef}
        type="button"
        style={{ width: INSPECTOR_TAB_W }}
        onClick={() => {
          setInspectorCollapsed(false)
        }}
        aria-label="Show inspector"
        title="Show inspector"
        className={cn(
          'hidden shrink-0 cursor-pointer items-center justify-center border-l border-edge bg-surface text-muted transition-colors',
          'hover:bg-raised hover:text-ink',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70',
          collapsed && 'lg:flex',
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
    </>
  )
}
