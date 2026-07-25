// Every text property, as inspector sections.
//
// Each section subscribes to ONLY the fields it draws (via `useTextStyleField`),
// so dragging the letter-spacing slider re-renders that row and nothing else —
// see the note in useTextStyle.ts about immer handing out a new `project` on
// every write. Sections are native `<details>`, so their open/closed state lives
// in the DOM and costs no re-renders at all.

import { useRef } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CaseUpper,
  Italic,
  Underline,
} from 'lucide-react'
import { useEditorStore } from '@/store/editorStore'
import { clipById } from '@/lib/model/selectors'
import { useTextStyleField, useTextStylePatch } from '@/hooks/useTextStyle'
import { withAlpha, withTextDefaults } from '@/lib/model/text'
import { TEXT_PRESETS, presetStyle } from '@/lib/text/presets'
import { Field, FieldBlock, Section } from '@/components/ui/field'
import { Slider } from '@/components/ui/slider'
import { ColorField } from '@/components/ui/color-field'
import { NumberField } from '@/components/ui/number-field'
import { TextArea } from '@/components/ui/text-area'
import {
  SegmentedControl,
  ToggleButton,
  ToggleGroup,
} from '@/components/ui/toggle-group'
import { FontPicker } from './FontPicker'
import type { TextAlign, TextStyle } from '@/lib/model/text'

interface SectionProps {
  clipId: string
  onEditStart: () => void
  /** Distinct per layout instance, so the desktop column and the mobile sheet
   *  don't share one exclusive-accordion group (both are mounted at once). */
  group: string
}

/** Just the numeric style fields — so the sliders below are type-safe without a
 *  cast, and pointing one at `align` or `bold` is a compile error. */
type NumericStyleKey = {
  [K in keyof TextStyle]: TextStyle[K] extends number ? K : never
}[keyof TextStyle]

/** A slider bound to one numeric style field. */
function StyleSlider({
  clipId,
  onEditStart,
  field,
  label,
  min = 0,
  max = 1,
  step = 0.01,
  format,
}: {
  clipId: string
  onEditStart: () => void
  field: NumericStyleKey
  label: string
  min?: number
  max?: number
  step?: number
  format?: (v: number) => string
}) {
  const { value, set, commit } = useTextStyleField(clipId, field, onEditStart)
  return (
    <Field
      label={label}
      hint={format ? format(value) : `${Math.round(value * 100)}%`}
    >
      {(id) => (
        <Slider
          id={id}
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={set}
          onCommit={() => {
            commit()
          }}
        />
      )}
    </Field>
  )
}

function StyleSection({ clipId, onEditStart, group }: SectionProps) {
  const patch = useTextStylePatch(clipId, onEditStart)
  const current = useEditorStore(
    (s) => withTextDefaults(clipById(s.project, clipId)?.textStyle).fontFamily,
  )
  return (
    <Section title="Style" name={group} defaultOpen>
      {/* Horizontal strip rather than a grid: presets are a quick re-skin, and
          this keeps the section one row tall in the mobile sheet. */}
      <div className="-mx-0.5 flex gap-1.5 overflow-x-auto overscroll-x-contain px-0.5 pb-1">
        {TEXT_PRESETS.map((preset) => {
          const style = presetStyle(preset)
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                // A preset can never move or resize the clip — fontSize,
                // boxWidth and align are excluded from PresetStyle by type.
                patch(preset.style)
              }}
              aria-label={`Apply ${preset.label} style`}
              title={preset.label}
              className="flex h-9 w-12 shrink-0 items-center justify-center rounded-md border border-edge/70 bg-black transition hover:border-accent/70"
            >
              <span
                className="text-[12px] leading-none"
                style={{
                  fontFamily: `"${style.fontFamily}", system-ui, sans-serif`,
                  fontWeight: style.bold ? 700 : 400,
                  color: withAlpha(style.color, style.opacity),
                  backgroundColor:
                    style.bgOpacity > 0
                      ? withAlpha(style.bgColor, style.bgOpacity)
                      : undefined,
                  padding: style.bgOpacity > 0 ? '0.1em 0.3em' : undefined,
                  borderRadius: style.bgOpacity > 0 ? '0.2em' : undefined,
                  WebkitTextStrokeWidth:
                    style.strokeWidth > 0
                      ? `${style.strokeWidth * 0.5}em`
                      : undefined,
                  WebkitTextStrokeColor:
                    style.strokeWidth > 0 ? style.strokeColor : undefined,
                  paintOrder: 'stroke fill',
                }}
              >
                Aa
              </span>
            </button>
          )
        })}
      </div>
      <p className="text-[10px] text-muted/70">
        Applies the look only — size and position stay as you set them. Current
        font: {current}.
      </p>
    </Section>
  )
}

function ContentSection({ clipId, onEditStart, group }: SectionProps) {
  const text = useEditorStore((s) => clipById(s.project, clipId)?.text ?? '')

  return (
    <Section title="Content" name={group} defaultOpen>
      <FieldBlock>
        {(id) => (
          <ContentEditor
            id={id}
            clipId={clipId}
            value={text}
            onEditStart={onEditStart}
          />
        )}
      </FieldBlock>
    </Section>
  )
}

/** Split out so the focus-scoped undo snapshot has somewhere to live. */
function ContentEditor({
  id,
  clipId,
  value,
  onEditStart,
}: {
  id: string
  clipId: string
  value: string
  onEditStart: () => void
}) {
  // One snapshot per FOCUS SESSION, not per keystroke — 50 undo entries of
  // single characters would bury every real edit. A ref, not a local: this
  // component re-renders on every keystroke, which would reset a plain `let`.
  const snapshotted = useRef(false)
  return (
    <TextArea
      id={id}
      value={value}
      aria-label="Text content"
      placeholder="Type your text…"
      onFocus={() => {
        snapshotted.current = false
      }}
      onChange={(next) => {
        if (!snapshotted.current) {
          snapshotted.current = true
          onEditStart()
        }
        const st = useEditorStore.getState()
        st.updateClip(clipId, { text: next })
        st.resetExport()
      }}
      onBlur={() => {
        snapshotted.current = false
      }}
    />
  )
}

function FontSection({ clipId, onEditStart, group }: SectionProps) {
  const family = useTextStyleField(clipId, 'fontFamily', onEditStart)
  const size = useTextStyleField(clipId, 'fontSize', onEditStart)
  const bold = useTextStyleField(clipId, 'bold', onEditStart)
  const italic = useTextStyleField(clipId, 'italic', onEditStart)
  const underline = useTextStyleField(clipId, 'underline', onEditStart)
  const textCase = useTextStyleField(clipId, 'case', onEditStart)
  const spacing = useTextStyleField(clipId, 'letterSpacing', onEditStart)
  const lineHeight = useTextStyleField(clipId, 'lineHeight', onEditStart)
  const align = useTextStyleField(clipId, 'align', onEditStart)

  return (
    <Section title="Font" name={group} defaultOpen>
      <FieldBlock label="Family">
        {(id) => (
          <FontPicker
            id={id}
            value={family.value}
            onChange={(f) => {
              family.commit(f)
            }}
          />
        )}
      </FieldBlock>

      {/* Stored as a fraction of canvas height; shown in 1080p pixels, which is
          the number a user can reason about. */}
      <Field label="Size" hint={`${Math.round(size.value * 1080)} px`}>
        {(id) => (
          <Slider
            id={id}
            aria-label="Font size"
            min={0.02}
            max={0.4}
            step={0.002}
            value={size.value}
            onChange={(v) => {
              size.set(v)
            }}
            onCommit={() => {
              size.commit()
            }}
          />
        )}
      </Field>

      <div className="flex gap-1.5">
        <ToggleGroup label="Text style" className="flex-1">
          <ToggleButton
            label="Bold"
            pressed={bold.value}
            onPressedChange={(v) => {
              bold.commit(v)
            }}
          >
            <Bold className="h-3.5 w-3.5" />
          </ToggleButton>
          <ToggleButton
            label="Italic"
            pressed={italic.value}
            onPressedChange={(v) => {
              italic.commit(v)
            }}
          >
            <Italic className="h-3.5 w-3.5" />
          </ToggleButton>
          <ToggleButton
            label="Underline"
            pressed={underline.value}
            onPressedChange={(v) => {
              underline.commit(v)
            }}
          >
            <Underline className="h-3.5 w-3.5" />
          </ToggleButton>
          <ToggleButton
            label="Uppercase"
            pressed={textCase.value === 'upper'}
            onPressedChange={(v) => {
              textCase.commit(v ? 'upper' : 'none')
            }}
          >
            <CaseUpper className="h-4 w-4" />
          </ToggleButton>
        </ToggleGroup>
      </div>

      <Field label="Align">
        {() => (
          <SegmentedControl<TextAlign>
            label="Horizontal alignment"
            value={align.value}
            onChange={(v) => {
              align.commit(v)
            }}
            options={[
              {
                value: 'left',
                label: 'Left',
                icon: <AlignLeft className="h-3.5 w-3.5" />,
              },
              {
                value: 'center',
                label: 'Center',
                icon: <AlignCenter className="h-3.5 w-3.5" />,
              },
              {
                value: 'right',
                label: 'Right',
                icon: <AlignRight className="h-3.5 w-3.5" />,
              },
            ]}
          />
        )}
      </Field>

      {/* Clideo's -20…100 tracking slider, in our em units (units / 200). */}
      <Field label="Spacing" hint={`${Math.round(spacing.value * 200)}`}>
        {(id) => (
          <Slider
            id={id}
            aria-label="Letter spacing"
            min={-0.1}
            max={0.5}
            step={0.005}
            value={spacing.value}
            onChange={(v) => {
              spacing.set(v)
            }}
            onCommit={() => {
              spacing.commit()
            }}
          />
        )}
      </Field>

      <Field label="Line height" hint={lineHeight.value.toFixed(2)}>
        {(id) => (
          <Slider
            id={id}
            aria-label="Line height"
            min={0.8}
            max={2.5}
            step={0.05}
            value={lineHeight.value}
            onChange={(v) => {
              lineHeight.set(v)
            }}
            onCommit={() => {
              lineHeight.commit()
            }}
          />
        )}
      </Field>
    </Section>
  )
}

function ColorSection({ clipId, onEditStart, group }: SectionProps) {
  const color = useTextStyleField(clipId, 'color', onEditStart)
  return (
    <Section title="Colour" name={group}>
      <FieldBlock label="Text">
        {(id) => (
          <ColorField
            id={id}
            label="Text colour"
            value={color.value}
            onChange={(v) => {
              color.set(v)
            }}
            onCommit={() => {
              color.commit()
            }}
          />
        )}
      </FieldBlock>
      <StyleSlider
        clipId={clipId}
        onEditStart={onEditStart}
        field="opacity"
        label="Opacity"
      />
    </Section>
  )
}

function BackgroundSection({ clipId, onEditStart, group }: SectionProps) {
  const bgColor = useTextStyleField(clipId, 'bgColor', onEditStart)
  return (
    <Section title="Background" name={group}>
      <FieldBlock label="Colour">
        {(id) => (
          <ColorField
            id={id}
            label="Background colour"
            value={bgColor.value}
            onChange={(v) => {
              bgColor.set(v)
            }}
            onCommit={() => {
              bgColor.commit()
            }}
          />
        )}
      </FieldBlock>
      <StyleSlider
        clipId={clipId}
        onEditStart={onEditStart}
        field="bgOpacity"
        label="Opacity"
      />
      <StyleSlider
        clipId={clipId}
        onEditStart={onEditStart}
        field="bgPaddingX"
        label="Pad X"
        max={2}
        format={(v) => `${v.toFixed(2)}em`}
      />
      <StyleSlider
        clipId={clipId}
        onEditStart={onEditStart}
        field="bgPaddingY"
        label="Pad Y"
        max={2}
        format={(v) => `${v.toFixed(2)}em`}
      />
      <StyleSlider
        clipId={clipId}
        onEditStart={onEditStart}
        field="bgRadius"
        label="Radius"
        max={1.5}
        format={(v) => `${v.toFixed(2)}em`}
      />
    </Section>
  )
}

function OutlineSection({ clipId, onEditStart, group }: SectionProps) {
  const strokeColor = useTextStyleField(clipId, 'strokeColor', onEditStart)
  return (
    <Section title="Outline" name={group}>
      <StyleSlider
        clipId={clipId}
        onEditStart={onEditStart}
        field="strokeWidth"
        label="Width"
        max={0.3}
        step={0.005}
        format={(v) => `${v.toFixed(3)}em`}
      />
      <FieldBlock label="Colour">
        {(id) => (
          <ColorField
            id={id}
            label="Outline colour"
            value={strokeColor.value}
            onChange={(v) => {
              strokeColor.set(v)
            }}
            onCommit={() => {
              strokeColor.commit()
            }}
          />
        )}
      </FieldBlock>
    </Section>
  )
}

function ShadowSection({ clipId, onEditStart, group }: SectionProps) {
  const shadowColor = useTextStyleField(clipId, 'shadowColor', onEditStart)
  return (
    <Section title="Shadow" name={group}>
      <StyleSlider
        clipId={clipId}
        onEditStart={onEditStart}
        field="shadowOpacity"
        label="Opacity"
      />
      <StyleSlider
        clipId={clipId}
        onEditStart={onEditStart}
        field="shadowBlur"
        label="Blur"
        max={0.6}
        step={0.005}
        format={(v) => `${v.toFixed(3)}em`}
      />
      <StyleSlider
        clipId={clipId}
        onEditStart={onEditStart}
        field="shadowOffsetX"
        label="Offset X"
        min={-0.3}
        max={0.3}
        step={0.005}
        format={(v) => `${v.toFixed(3)}em`}
      />
      <StyleSlider
        clipId={clipId}
        onEditStart={onEditStart}
        field="shadowOffsetY"
        label="Offset Y"
        min={-0.3}
        max={0.3}
        step={0.005}
        format={(v) => `${v.toFixed(3)}em`}
      />
      <FieldBlock label="Colour">
        {(id) => (
          <ColorField
            id={id}
            label="Shadow colour"
            value={shadowColor.value}
            onChange={(v) => {
              shadowColor.set(v)
            }}
            onCommit={() => {
              shadowColor.commit()
            }}
          />
        )}
      </FieldBlock>
    </Section>
  )
}

function LayoutSection({ clipId, onEditStart, group }: SectionProps) {
  return (
    <Section title="Layout" name={group}>
      <StyleSlider
        clipId={clipId}
        onEditStart={onEditStart}
        field="boxWidth"
        label="Wrap width"
        min={0.05}
        max={1}
      />
      <p className="text-[10px] leading-relaxed text-muted/70">
        Where lines wrap, as a share of the frame. The side handles on the
        preview do the same thing.
      </p>
    </Section>
  )
}

function TimingSection({ clipId, onEditStart, group }: SectionProps) {
  const clip = useEditorStore((s) => clipById(s.project, clipId))
  if (!clip) return null

  const apply = (start: number, duration: number) => {
    onEditStart()
    const st = useEditorStore.getState()
    st.setClipWindow(clipId, start, duration)
    st.resetExport()
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

export function TextInspector({
  clipId,
  onEditStart,
  group,
}: {
  clipId: string
  onEditStart: () => void
  group: string
}) {
  const props = { clipId, onEditStart, group }
  return (
    <div className="flex flex-col">
      <StyleSection {...props} />
      <ContentSection {...props} />
      <FontSection {...props} />
      <ColorSection {...props} />
      <BackgroundSection {...props} />
      <OutlineSection {...props} />
      <ShadowSection {...props} />
      <LayoutSection {...props} />
      <TimingSection {...props} />
    </div>
  )
}
