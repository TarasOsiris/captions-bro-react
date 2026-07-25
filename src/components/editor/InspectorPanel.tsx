// Right-side inspector for the selected clip. The contents live in
// `inspector/InspectorBody` so the desktop column and the mobile sheet render
// exactly the same controls; this file is only the desktop shell.
//
// AT lg+ the column width is reserved whether or not a clip is selected, so
// toggling it never resizes the preview (the centered video would otherwise jump
// on select/deselect). That reservation is width-specific and does NOT transfer
// below lg: there the panel is dropped entirely (256px of dead space on a phone)
// and MobileDock shows the same body as a full-width sheet, where there is
// nothing to reserve.

import { useEditorStore } from '@/store/editorStore'
import { clipById } from '@/lib/model/selectors'
import { InspectorBody } from './inspector/InspectorBody'

export function InspectorPanel({ onEditStart }: { onEditStart: () => void }) {
  const hasClip = useEditorStore(
    (s) => clipById(s.project, s.selectedClipId) != null,
  )

  // Always reserve the width; blend the empty state into the stage backdrop.
  return (
    <div className="hidden w-64 shrink-0 bg-stage lg:block">
      {hasClip && (
        <aside className="flex h-full w-full flex-col border-l border-edge bg-surface">
          <InspectorBody variant="column" onEditStart={onEditStart} />
        </aside>
      )}
    </div>
  )
}
