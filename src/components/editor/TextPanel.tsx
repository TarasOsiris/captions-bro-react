// The Text rail tab: a preset picker that inserts a styled text clip at the
// playhead. All subsequent editing happens in the Inspector.
//
// `TextPresetBin` deliberately mirrors `MediaBin`'s contract — a header row plus
// a scrolling body, taking an `onPicked` the container supplies — so the SAME
// component serves the desktop sidebar column and the mobile sheet with no
// layout fork and no breakpoint check.
//
// Each tile previews the preset by rendering real DOM text in the preset's own
// family, weight, outline, shadow and background. Not a generated thumbnail:
// there is nothing to regenerate when the style model changes, and it can never
// go stale.

import { useEffect } from 'react'
import { Type } from 'lucide-react'
import { useEditorStore } from '@/store/editorStore'
import { useClipInsert } from '@/hooks/useClipInsert'
import { TEXT_PRESETS, presetStyle } from '@/lib/text/presets'
import { TEXT_FONTS } from '@/lib/text/fonts'
import { loadPreviewFaces } from '@/lib/text/fontLoader'
import { withAlpha } from '@/lib/model/text'
import type { TextPreset } from '@/lib/text/presets'
import type { TextStyle } from '@/lib/model/text'

/** CSS mirroring `paintText` closely enough for a thumbnail. Sizes are in `em`
 *  of the tile's own font-size, exactly as the style stores them. */
function previewStyle(style: TextStyle): React.CSSProperties {
  const shadow =
    style.shadowOpacity > 0
      ? `${style.shadowOffsetX}em ${style.shadowOffsetY}em ${style.shadowBlur}em ${withAlpha(style.shadowColor, style.shadowOpacity)}`
      : undefined
  return {
    fontFamily: `"${style.fontFamily}", system-ui, sans-serif`,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: style.underline ? 'underline' : 'none',
    textTransform:
      style.case === 'upper'
        ? 'uppercase'
        : style.case === 'capitalize'
          ? 'capitalize'
          : 'none',
    letterSpacing: `${style.letterSpacing}em`,
    color: withAlpha(style.color, style.opacity),
    backgroundColor:
      style.bgOpacity > 0
        ? withAlpha(style.bgColor, style.bgOpacity)
        : undefined,
    padding:
      style.bgOpacity > 0
        ? `${style.bgPaddingY}em ${style.bgPaddingX}em`
        : undefined,
    borderRadius: style.bgOpacity > 0 ? `${style.bgRadius}em` : undefined,
    textShadow: shadow,
    WebkitTextStrokeWidth:
      style.strokeWidth > 0 ? `${style.strokeWidth * 0.5}em` : undefined,
    WebkitTextStrokeColor:
      style.strokeWidth > 0 ? style.strokeColor : undefined,
    // Keep the stroke behind the fill, matching the canvas paint order.
    paintOrder: 'stroke fill',
  }
}

export function TextPresetBin({
  onEditStart,
  onPicked,
}: {
  /** Undo snapshot before the insert — the caller owns it, as with media. */
  onEditStart: () => void
  /** Fired after a preset is picked, so the mobile sheet can advance itself. */
  onPicked?: () => void
}) {
  const disabled = useEditorStore((s) => s.exportPhase === 'exporting')
  const { insertTextAtTime } = useClipInsert()

  // Every picker face in ONE request, the first time the tab is shown.
  useEffect(() => {
    void loadPreviewFaces(TEXT_FONTS.map((f) => f.family))
  }, [])

  const add = (preset: TextPreset) => {
    if (disabled) return
    onEditStart()
    insertTextAtTime(preset, useEditorStore.getState().currentTime)
    onPicked?.()
  }

  return (
    <>
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          Text
        </span>
        <span className="text-[10px] text-muted/70">Tap to add</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pt-1">
        {/* Same auto-fill grid as MediaBin: 3 columns in the 288px sidebar,
            4 in a full-width sheet, one class, no breakpoint. */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-2">
          {TEXT_PRESETS.map((preset) => {
            const style = presetStyle(preset)
            return (
              <button
                key={preset.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  add(preset)
                }}
                aria-label={`Add ${preset.label} text`}
                className="group flex flex-col gap-1 text-left disabled:opacity-40"
              >
                <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-md border border-edge/70 bg-black px-1 transition group-hover:border-accent/70">
                  <span
                    className="max-w-full truncate text-[13px] leading-none"
                    style={previewStyle(style)}
                  >
                    Aa
                  </span>
                </div>
                <span className="truncate text-[10px] text-muted group-hover:text-ink">
                  {preset.label}
                </span>
              </button>
            )
          })}
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted/70">
          <Type className="mt-px h-3 w-3 shrink-0" />
          Text is added at the playhead on its own lane, then styled in the
          inspector.
        </p>
      </div>
    </>
  )
}
