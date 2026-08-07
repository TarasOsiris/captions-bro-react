// The inspector's contents, independent of where they are shown. Rendered twice
// — inside the desktop `InspectorPanel` column and inside the MobileDock sheet —
// so the two layouts can never drift apart.
//
// The scroll contract (`min-h-0 flex-1 overflow-y-auto overscroll-contain`) is
// the same one MediaBin uses, which is what makes it work unchanged in a 256px
// column and in a height-capped sheet.
//
// ONE deliberate divergence between the two layouts: the header's dismiss
// button. The sheet CLOSES itself (`setPanel(null)`); the desktop column
// COLLAPSES to its edge tab. Everything else is identical by construction.

import { X } from 'lucide-react'
import { useEditorStore } from '@/store/editorStore'
import { clipById } from '@/lib/model/selectors'
import { inspectorKindForClip, inspectorTitle } from '@/lib/model/inspector'
import { Button } from '@/components/ui/button'
import { InspectorEmptyArt } from './InspectorEmptyArt'
import { MediaInspector } from './MediaInspector'
import { TextInspector } from './TextInspector'
import { TimingSection } from './TimingSection'

export function InspectorBody({
  variant,
  closeRef,
}: {
  /** 'column' is the desktop sidebar; 'sheet' is the mobile overlay. They
   *  dismiss differently (see above) and need their own accordion groups. */
  variant: 'column' | 'sheet'
  /** The desktop column focuses this when it expands, so a collapse→expand
   *  round trip returns focus where it started rather than dropping it on
   *  <body> — where a stray Backspace reaches `useEditorKeyboard` and deletes
   *  the selected clip. */
  closeRef?: React.Ref<HTMLButtonElement>
}) {
  const clip = useEditorStore((s) => clipById(s.project, s.selectedClipId))
  const setPanel = useEditorStore((s) => s.setPanel)
  const setInspectorCollapsed = useEditorStore((s) => s.setInspectorCollapsed)
  const kind = inspectorKindForClip(clip)

  return (
    <>
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          {inspectorTitle(kind)}
        </span>
        {/* One control, two meanings — see the divergence note at the top. */}
        <Button
          ref={closeRef}
          variant="ghost"
          size="icon"
          aria-label={
            variant === 'sheet' ? 'Close inspector' : 'Hide inspector'
          }
          onClick={() => {
            if (variant === 'sheet') setPanel(null)
            else setInspectorCollapsed(true)
          }}
          className="h-6 w-6"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        {clip && (kind === 'text' || kind === 'media') ? (
          // Remount per clip so every section's local draft state resets.
          // Distinct accordion groups: both layout instances are in the DOM at
          // once, and a shared `name` would let one close the other's sections.
          <div key={clip.id} className="flex flex-col">
            {kind === 'text' ? (
              <TextInspector
                clipId={clip.id}
                group={`cb-inspector-${variant}`}
              />
            ) : (
              <MediaInspector
                clipId={clip.id}
                group={`cb-inspector-${variant}`}
              />
            )}
            {/* Clip timing is generic (see TimingSection); it renders after
                the type-specific sections, exactly where it always sat. */}
            <TimingSection clipId={clip.id} group={`cb-inspector-${variant}`} />
          </div>
        ) : (
          // `h-full`, not `flex-1`: the scroll container is a block, so a flex
          // child of it has no height to grow into and the empty state would
          // sit at the top of an always-visible column.
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <InspectorEmptyArt />
            <p className="max-w-[12rem] text-xs text-muted">
              {kind === 'unsupported'
                ? 'Properties for this clip are coming soon.'
                : 'Select a clip to edit its properties.'}
            </p>
          </div>
        )}
      </div>
    </>
  )
}
