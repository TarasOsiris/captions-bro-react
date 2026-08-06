// A clip's timeline window (start / duration) — a CLIP property, not a text
// one, which is why it lives outside TextInspector: the day a media inspector
// exists, it composes this section unchanged. On the magnetic main track the
// store's re-pack owns `start` (the field applies duration only); on an
// overlay lane both fields apply, clamped into a free gap.

import { useEditorStore } from '@/store/editorStore'
import { clipById } from '@/lib/model/selectors'
import { Field, Section } from '@/components/ui/field'
import { NumberField } from '@/components/ui/number-field'

export function TimingSection({
  clipId,
  group,
}: {
  clipId: string
  group: string
}) {
  const clip = useEditorStore((s) => clipById(s.project, clipId))
  if (!clip) return null

  const apply = (start: number, duration: number) => {
    const st = useEditorStore.getState()
    st.beginEdit()
    st.setClipWindow(clipId, start, duration)
  }

  return (
    <Section title="Timing" name={group}>
      <Field label="Start" hint="s">
        {(id) => (
          <NumberField
            id={id}
            aria-label="Start time in seconds"
            value={clip.start}
            min={0}
            step={0.1}
            onCommit={(v) => {
              apply(v, clip.duration)
            }}
          />
        )}
      </Field>
      <Field label="Duration" hint="s">
        {(id) => (
          <NumberField
            id={id}
            aria-label="Duration in seconds"
            value={clip.duration}
            min={0.1}
            step={0.1}
            onCommit={(v) => {
              apply(clip.start, v)
            }}
          />
        )}
      </Field>
    </Section>
  )
}
