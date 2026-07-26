// Right-side inspector. The contents live in `inspector/InspectorBody` so the
// desktop column and the mobile sheet render exactly the same controls; this
// file is only the desktop shell and its resize handle.
//
// The column is ALWAYS mounted at lg+ — with or without a selection, since
// `InspectorBody` has its own empty state. It never appears or disappears, so
// selecting a clip can't resize the preview under the user (the centered video
// used to jump on select/deselect). Below lg it is dropped entirely (256px of
// dead space on a phone) and MobileDock shows the same body as a sheet.
//
// Resizing is `usePanelResize` — the same hook the media column uses, so the
// two edges behave identically. `lg:w-64` is the first-paint default; the hook
// writes the stored width straight to the DOM after mount.

import { InspectorBody } from './inspector/InspectorBody'
import { usePanelResize } from '@/hooks/usePanelResize'
import { INSPECTOR_WIDTH } from '@/lib/persistence/layoutPrefs'

export function InspectorPanel({ onEditStart }: { onEditStart: () => void }) {
  const { panelProps, handleProps } = usePanelResize(INSPECTOR_WIDTH, {
    edge: 'left',
    label: 'Resize inspector',
  })

  return (
    <aside
      {...panelProps}
      className="relative hidden shrink-0 flex-col border-l border-edge bg-surface lg:flex"
    >
      {/* First child: it sits on the LEFT edge, so this is also reading order. */}
      <div {...handleProps} />

      <InspectorBody variant="column" onEditStart={onEditStart} />
    </aside>
  )
}
