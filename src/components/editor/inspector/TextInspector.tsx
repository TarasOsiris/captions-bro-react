// Every text property, as inspector sections.
//
// Each CONTROL subscribes to ONLY the field it draws (via `useTextStyleField`
// inside StyleSlider/StyleColor/StyleToggle and friends), so dragging the
// letter-spacing slider re-renders that row and nothing else — see the note in
// useTextStyle.ts about immer handing out a new `project` on every write. The
// sections themselves subscribe to nothing. Sections are native `<details>`,
// so their open/closed state lives in the DOM and costs no re-renders at all.
//
// Clip TIMING is deliberately not here — it isn't a text property. See
// ./TimingSection, composed alongside this by InspectorBody.

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
  /** Distinct per layout instance, so the desktop column and the mobile sheet
   *  don't share one exclusive-accordion group (both are mounted at once). */
  group: string
}

/** Just the numeric style fields — so the sliders below are type-safe without a
 *  cast, and pointing one at `align` or `bold` is a compile error. */
type NumericStyleKey = {
  [K in keyof TextStyle]: TextStyle[K] extends number ? K : never
}[keyof TextStyle]

/** The boolean style fields, for StyleToggle. */
type BooleanStyleKey = {
  [K in keyof TextStyle]: TextStyle[K] extends boolean ? K : never
}[keyof TextStyle]

/** A slider bound to one numeric style field. */
function StyleSlider({
  clipId,
  field,
  label,
  min = 0,
  max = 1,
  step = 0.01,
  format,
}: {
  clipId: string
  field: NumericStyleKey
  label: string
  min?: number
  max?: number
  step?: number
  format?: (v: number) => string
}) {
  const { value, set, commit } = useTextStyleField(clipId, field)
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

/** A color well bound to one color-string style field. */
function StyleColor({
  clipId,
  field,
  label,
  blockLabel,
}: {
  clipId: string
  field: 'color' | 'bgColor' | 'strokeColor' | 'shadowColor'
  label: string
  blockLabel: string
}) {
  const { set, commit, value } = useTextStyleField(clipId, field)
  return (
    <FieldBlock label={blockLabel}>
      {(id) => (
        <ColorField
          id={id}
          label={label}
          value={value}
          onChange={set}
          onCommit={() => {
            commit()
          }}
        />
      )}
    </FieldBlock>
  )
}

/** A toggle button bound to one boolean style field. */
function StyleToggle({
  clipId,
  field,
  label,
  children,
}: {
  clipId: string
  field: BooleanStyleKey
  label: string
  children: React.ReactNode
}) {
  const { value, commit } = useTextStyleField(clipId, field)
  return (
    <ToggleButton label={label} pressed={value} onPressedChange={commit}>
      {children}
    </ToggleButton>
  )
}

/** Uppercase is `case: 'upper' | 'none'` under a boolean-shaped control. */
function CaseToggle({ clipId }: { clipId: string }) {
  const { value, commit } = useTextStyleField(clipId, 'case')
  return (
    <ToggleButton
      label="Uppercase"
      pressed={value === 'upper'}
      onPressedChange={(v) => {
        commit(v ? 'upper' : 'none')
      }}
    >
      <CaseUpper className="h-4 w-4" />
    </ToggleButton>
  )
}

function FamilyControl({ clipId }: { clipId: string }) {
  const { value, commit } = useTextStyleField(clipId, 'fontFamily')
  return (
    <FieldBlock label="Family">
      {(id) => <FontPicker id={id} value={value} onChange={commit} />}
    </FieldBlock>
  )
}

function AlignControl({ clipId }: { clipId: string }) {
  const { value, commit } = useTextStyleField(clipId, 'align')
  return (
    <Field label="Align">
      {() => (
        <SegmentedControl<TextAlign>
          label="Horizontal alignment"
          value={value}
          onChange={commit}
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
  )
}

function StyleSection({ clipId, group }: SectionProps) {
  const patch = useTextStylePatch(clipId)
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

function ContentSection({ clipId, group }: SectionProps) {
  const text = useEditorStore((s) => clipById(s.project, clipId)?.text ?? '')

  return (
    <Section title="Content" name={group} defaultOpen>
      <FieldBlock>
        {(id) => (
          <TextArea
            id={id}
            value={text}
            aria-label="Text content"
            placeholder="Type your text…"
            // One undo entry per FOCUS RUN, not per keystroke: the store's
            // editing session snapshots on the first keystroke; blur ends it.
            onChange={(next) => {
              const st = useEditorStore.getState()
              st.beginEditSession()
              st.updateClip(clipId, { text: next })
            }}
            onBlur={() => {
              useEditorStore.getState().endEditSession()
            }}
          />
        )}
      </FieldBlock>
    </Section>
  )
}

function FontSection({ clipId, group }: SectionProps) {
  // Composition only — every control below owns its one-field subscription,
  // so a change to any single field re-renders that control, not the section.
  return (
    <Section title="Font" name={group} defaultOpen>
      <FamilyControl clipId={clipId} />

      {/* Stored as a fraction of canvas height; shown in 1080p pixels, which is
          the number a user can reason about. */}
      <StyleSlider
        clipId={clipId}
        field="fontSize"
        label="Size"
        min={0.02}
        max={0.4}
        step={0.002}
        format={(v) => `${Math.round(v * 1080)} px`}
      />

      <div className="flex gap-1.5">
        <ToggleGroup label="Text style" className="flex-1">
          <StyleToggle clipId={clipId} field="bold" label="Bold">
            <Bold className="h-3.5 w-3.5" />
          </StyleToggle>
          <StyleToggle clipId={clipId} field="italic" label="Italic">
            <Italic className="h-3.5 w-3.5" />
          </StyleToggle>
          <StyleToggle clipId={clipId} field="underline" label="Underline">
            <Underline className="h-3.5 w-3.5" />
          </StyleToggle>
          <CaseToggle clipId={clipId} />
        </ToggleGroup>
      </div>

      <AlignControl clipId={clipId} />

      {/* Clideo's -20…100 tracking slider, in our em units (units / 200). */}
      <StyleSlider
        clipId={clipId}
        field="letterSpacing"
        label="Spacing"
        min={-0.1}
        max={0.5}
        step={0.005}
        format={(v) => `${Math.round(v * 200)}`}
      />

      <StyleSlider
        clipId={clipId}
        field="lineHeight"
        label="Line height"
        min={0.8}
        max={2.5}
        step={0.05}
        format={(v) => v.toFixed(2)}
      />
    </Section>
  )
}

function ColorSection({ clipId, group }: SectionProps) {
  return (
    <Section title="Colour" name={group}>
      <StyleColor
        clipId={clipId}
        field="color"
        label="Text colour"
        blockLabel="Text"
      />
      <StyleSlider clipId={clipId} field="opacity" label="Opacity" />
    </Section>
  )
}

function BackgroundSection({ clipId, group }: SectionProps) {
  return (
    <Section title="Background" name={group}>
      <StyleColor
        clipId={clipId}
        field="bgColor"
        label="Background colour"
        blockLabel="Colour"
      />
      <StyleSlider clipId={clipId} field="bgOpacity" label="Opacity" />
      <StyleSlider
        clipId={clipId}
        field="bgPaddingX"
        label="Pad X"
        max={2}
        format={(v) => `${v.toFixed(2)}em`}
      />
      <StyleSlider
        clipId={clipId}
        field="bgPaddingY"
        label="Pad Y"
        max={2}
        format={(v) => `${v.toFixed(2)}em`}
      />
      <StyleSlider
        clipId={clipId}
        field="bgRadius"
        label="Radius"
        max={1.5}
        format={(v) => `${v.toFixed(2)}em`}
      />
    </Section>
  )
}

function OutlineSection({ clipId, group }: SectionProps) {
  return (
    <Section title="Outline" name={group}>
      <StyleSlider
        clipId={clipId}
        field="strokeWidth"
        label="Width"
        max={0.3}
        step={0.005}
        format={(v) => `${v.toFixed(3)}em`}
      />
      <StyleColor
        clipId={clipId}
        field="strokeColor"
        label="Outline colour"
        blockLabel="Colour"
      />
    </Section>
  )
}

function ShadowSection({ clipId, group }: SectionProps) {
  return (
    <Section title="Shadow" name={group}>
      <StyleSlider clipId={clipId} field="shadowOpacity" label="Opacity" />
      <StyleSlider
        clipId={clipId}
        field="shadowBlur"
        label="Blur"
        max={0.6}
        step={0.005}
        format={(v) => `${v.toFixed(3)}em`}
      />
      <StyleSlider
        clipId={clipId}
        field="shadowOffsetX"
        label="Offset X"
        min={-0.3}
        max={0.3}
        step={0.005}
        format={(v) => `${v.toFixed(3)}em`}
      />
      <StyleSlider
        clipId={clipId}
        field="shadowOffsetY"
        label="Offset Y"
        min={-0.3}
        max={0.3}
        step={0.005}
        format={(v) => `${v.toFixed(3)}em`}
      />
      <StyleColor
        clipId={clipId}
        field="shadowColor"
        label="Shadow colour"
        blockLabel="Colour"
      />
    </Section>
  )
}

function LayoutSection({ clipId, group }: SectionProps) {
  return (
    <Section title="Layout" name={group}>
      <StyleSlider
        clipId={clipId}
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

export function TextInspector({
  clipId,
  group,
}: {
  clipId: string
  group: string
}) {
  const props = { clipId, group }
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
    </div>
  )
}
