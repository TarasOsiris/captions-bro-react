// The inspector's contents, independent of where they are shown. Rendered twice
// — inside the desktop `InspectorPanel` column and inside the MobileDock sheet —
// so the two layouts can never drift apart.
//
// The scroll contract (`min-h-0 flex-1 overflow-y-auto overscroll-contain`) is
// the same one MediaBin uses, which is what makes it work unchanged in a 256px
// column and in a height-capped sheet.

import { SlidersHorizontal, X } from 'lucide-react'
import { useEditorStore } from '@/store/editorStore'
import { clipById } from '@/lib/model/selectors'
import { Button } from '@/components/ui/button'
import { TextInspector } from './TextInspector'

export function InspectorBody({
  variant,
  onEditStart,
}: {
  /** 'column' is the desktop sidebar; 'sheet' is the mobile overlay, which
   *  needs its own dismiss control and its own accordion group. */
  variant: 'column' | 'sheet'
  onEditStart: () => void
}) {
  const clip = useEditorStore((s) => clipById(s.project, s.selectedClipId))
  const setPanel = useEditorStore((s) => s.setPanel)

  return (
    <>
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          {clip?.type === 'text' ? 'Text' : 'Inspector'}
        </span>
        {variant === 'sheet' && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close inspector"
            onClick={() => {
              setPanel(null)
            }}
            className="h-6 w-6"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        {clip?.type === 'text' ? (
          <TextInspector
            // Remount per clip so every section's local draft state resets.
            key={clip.id}
            clipId={clip.id}
            onEditStart={onEditStart}
            // Distinct accordion groups: both instances are in the DOM at once,
            // and a shared `name` would let one close the other's sections.
            group={`cb-inspector-${variant}`}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-raised text-muted/70">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <p className="max-w-[12rem] text-xs text-muted">
              {clip
                ? 'Properties for this clip are coming soon.'
                : 'Select a clip to edit its properties.'}
            </p>
          </div>
        )}
      </div>
    </>
  )
}
