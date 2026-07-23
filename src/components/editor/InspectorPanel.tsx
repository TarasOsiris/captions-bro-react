// Right-side inspector for the selected clip. The column width is reserved whether
// or not a clip is selected, so toggling it never resizes the preview (the centered
// video would otherwise jump on select/deselect). Placeholder for now — clip property
// controls (transform, timing, volume, captions…) will live here.

import { SlidersHorizontal } from 'lucide-react'
import { useEditorStore } from '@/store/editorStore'
import { clipById } from '@/lib/model/selectors'

export function InspectorPanel() {
  const clip = useEditorStore((s) => clipById(s.project, s.selectedClipId))

  // Always reserve the width; blend the empty state into the stage backdrop.
  return (
    <div className="w-64 shrink-0 bg-stage">
      {clip && (
        <aside className="flex h-full w-full flex-col border-l border-edge bg-surface">
          <div className="flex h-10 shrink-0 items-center px-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              Inspector
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-raised text-muted/70">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <p className="max-w-[12rem] text-xs text-muted">
              Clip properties will appear here.
            </p>
          </div>
        </aside>
      )}
    </div>
  )
}
