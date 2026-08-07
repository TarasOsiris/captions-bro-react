// Project-level canvas settings: the output ratio and the background colour.
//
// In the RAIL rather than the inspector, deliberately. The rail is served by
// ONE component at both layouts (MediaPanel at lg+, MobileDock below), whereas
// the mobile inspector is a sheet you can only reach with a clip selected — so
// a project-level setting would be unreachable on a phone, which is exactly
// where 9:16 matters most.

import { useEditorStore } from '@/store/editorStore'
import { CANVAS_PRESETS, canvasForRatio, ratioIdFor } from '@/lib/model/canvas'
import { ColorField } from '@/components/ui/color-field'
import { FieldBlock } from '@/components/ui/field'
import type { RatioId } from '@/lib/model/canvas'

export function CanvasPanel() {
  // Atomic reads: a string and a string, so this doesn't re-render on clip edits.
  const activeRatio = useEditorStore((s) => ratioIdFor(s.project.canvas))
  const background = useEditorStore((s) => s.project.canvas.background)

  const apply = (next: { ratio?: RatioId; background?: string }) => {
    const st = useEditorStore.getState()
    const current = st.project.canvas
    st.beginEdit()
    st.setCanvas(
      next.ratio
        ? canvasForRatio(next.ratio, next.background ?? current.background)
        : { ...current, background: next.background ?? current.background },
    )
  }

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      <FieldBlock label="Aspect ratio">
        {() => (
          <div className="grid grid-cols-2 gap-1.5">
            {CANVAS_PRESETS.map((preset) => {
              const active = preset.id === activeRatio
              // The swatch previews the SHAPE, which is the thing being picked —
              // "4:5" and "1:1" read alike as text at this size.
              const wide = preset.width >= preset.height
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    apply({ ratio: preset.id })
                  }}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                    active
                      ? 'border-accent bg-accent/10'
                      : 'border-edge hover:border-muted'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`shrink-0 rounded-[2px] border ${
                      active ? 'border-accent' : 'border-muted/60'
                    }`}
                    style={{
                      width: wide ? 22 : 22 * (preset.width / preset.height),
                      height: wide ? 22 / (preset.width / preset.height) : 22,
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-medium text-ink">
                      {preset.label}
                    </span>
                    <span className="block truncate text-[10px] text-muted/70">
                      {preset.hint}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </FieldBlock>

      <FieldBlock label="Background">
        {(id) => (
          <ColorField
            id={id}
            label="Canvas background"
            value={background}
            onChange={(v) => {
              apply({ background: v })
            }}
          />
        )}
      </FieldBlock>

      <p className="text-[10px] leading-relaxed text-muted/70">
        Changing the ratio re-frames every clip without moving it — placement is
        stored relative to the canvas, so switching back restores exactly what
        you had. Use the inspector&rsquo;s Fill button on a clip you want to
        crop to the new shape.
      </p>
    </div>
  )
}
