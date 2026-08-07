// Every media-clip property, as inspector sections — the video/image sibling of
// TextInspector, and structurally the same: each CONTROL owns its one-field
// subscription (via useClipFields), the sections subscribe to nothing, and the
// sections are native `<details>` so open/closed costs no re-render.
//
// These fields are the numeric twin of the preview's canvas gestures, not a
// second source of truth: both write `clip.transform` through the same store
// action, so a corner drag updates these numbers live and vice versa.

import {
  Crop,
  Maximize2,
  RotateCcw,
  Scan,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useEditorStore } from '@/store/editorStore'
import { clipAspect, clipById } from '@/lib/model/selectors'
import { clipCarriesAudio } from '@/lib/model/audio'
import {
  useClipNumberField,
  useClipPatch,
  useClipTransformField,
  useClipTransformPatch,
} from '@/hooks/useClipFields'
import {
  IDENTITY,
  MAX_SCALE,
  MIN_SCALE,
  clearCrop,
  fillTransform,
  fitTransform,
  hasCrop,
} from '@/lib/transform'
import { Field, FieldBlock, Section } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { NumberField } from '@/components/ui/number-field'
import { Slider } from '@/components/ui/slider'
import { ToggleButton } from '@/components/ui/toggle-group'

interface SectionProps {
  clipId: string
  /** Distinct per layout instance — see TextInspector. */
  group: string
}

/** Offsets are fractions of the canvas; ±2 canvases is well past the point the
 *  clip has left the frame entirely, so it is a generous but finite bound. */
const MAX_OFFSET = 2

/** A number field bound to one transform placement field, shown in `unit`
 *  terms. `toDisplay`/`fromDisplay` keep the STORED value canvas-relative — a
 *  px value in a transform would break resolution independence. */
function TransformNumber({
  clipId,
  field,
  label,
  hint,
  min,
  max,
  step,
  scale = 1,
  decimals = 1,
}: {
  clipId: string
  field: 'scale' | 'tx' | 'ty' | 'rotationDeg'
  label: string
  hint: string
  min: number
  max: number
  step: number
  /** Display value = stored × scale (100 for the fraction-as-percent fields). */
  scale?: number
  decimals?: number
}) {
  // The default IS the identity placement — a separate `fallback` prop was a
  // tenth argument that had to be kept in step with `Transform` by hand.
  const { value, commit } = useClipTransformField(
    clipId,
    field,
    IDENTITY[field],
  )
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <NumberField
          id={id}
          aria-label={label}
          value={value * scale}
          min={min}
          max={max}
          step={step}
          decimals={decimals}
          onCommit={(v) => {
            commit(v / scale)
          }}
        />
      )}
    </Field>
  )
}

function TransformSection({ clipId, group }: SectionProps) {
  const patch = useClipTransformPatch(clipId)
  // Atomic reads: primitives, so this component re-renders only when the media
  // aspect resolves or the project canvas changes — never on a drag.
  const aspect = useEditorStore((s) =>
    clipAspect(s.project, clipById(s.project, clipId) ?? null),
  )
  const canvasW = useEditorStore((s) => s.project.canvas.width)
  const canvasH = useEditorStore((s) => s.project.canvas.height)

  return (
    <Section title="Transform" name={group} defaultOpen>
      <TransformNumber
        clipId={clipId}
        field="scale"
        label="Scale"
        hint="%"
        min={MIN_SCALE * 100}
        max={MAX_SCALE * 100}
        step={5}
        scale={100}
        decimals={0}
      />
      <TransformNumber
        clipId={clipId}
        field="tx"
        label="X"
        hint="%"
        min={-MAX_OFFSET * 100}
        max={MAX_OFFSET * 100}
        step={1}
        scale={100}
      />
      <TransformNumber
        clipId={clipId}
        field="ty"
        label="Y"
        hint="%"
        min={-MAX_OFFSET * 100}
        max={MAX_OFFSET * 100}
        step={1}
        scale={100}
      />
      <TransformNumber
        clipId={clipId}
        field="rotationDeg"
        label="Rotate"
        hint="°"
        min={-360}
        max={360}
        step={15}
      />

      <FieldBlock>
        {() => (
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => {
                // A full reset, crop and rotation included — distinct from Fit,
                // which keeps the rotation the user chose.
                patch({ ...IDENTITY })
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={aspect === null}
              onClick={() => {
                patch((t) => fitTransform(t))
              }}
            >
              <Scan className="h-3.5 w-3.5" />
              Fit
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={aspect === null}
              onClick={() => {
                // Guarded by `disabled`, but the click could still race the
                // asset's metadata being revoked — do nothing rather than NaN.
                if (aspect === null) return
                patch((t) => fillTransform(t, aspect, canvasW, canvasH))
              }}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Fill
            </Button>
          </div>
        )}
      </FieldBlock>
      {aspect === null && (
        <p className="text-[10px] text-muted/70">
          Fit and Fill need the media&rsquo;s dimensions, which are still
          loading.
        </p>
      )}
    </Section>
  )
}

function OpacitySection({ clipId, group }: SectionProps) {
  const { value, set, commit } = useClipNumberField(clipId, 'opacity', 1)
  return (
    <Section title="Opacity" name={group}>
      <Field label="Opacity" hint={`${Math.round(value * 100)}%`}>
        {(id) => (
          <Slider
            id={id}
            aria-label="Opacity"
            min={0}
            max={1}
            step={0.01}
            value={value}
            onChange={set}
            onCommit={() => {
              commit()
            }}
          />
        )}
      </Field>
    </Section>
  )
}

function CropSection({ clipId, group }: SectionProps) {
  const patch = useClipTransformPatch(clipId)
  const cropped = useEditorStore((s) => {
    const clip = clipById(s.project, clipId)
    return clip ? hasCrop(clip.transform) : false
  })

  return (
    <Section title="Crop" name={group}>
      <FieldBlock>
        {() => (
          <Button
            variant="outline"
            size="sm"
            disabled={!cropped}
            onClick={() => {
              patch((t) => clearCrop(t))
            }}
          >
            <Crop className="h-3.5 w-3.5" />
            Reset crop
          </Button>
        )}
      </FieldBlock>
      <p className="text-[10px] text-muted/70">
        Drag the edge handles on the preview to crop.
      </p>
    </Section>
  )
}

function VolumeControl({ clipId }: { clipId: string }) {
  const { value, set, commit } = useClipNumberField(clipId, 'volume', 1)
  const muted = useEditorStore(
    (s) => clipById(s.project, clipId)?.muted ?? false,
  )
  return (
    <Field label="Volume" hint={`${Math.round(value * 100)}%`}>
      {(id) => (
        <Slider
          id={id}
          aria-label="Volume"
          min={0}
          max={1}
          step={0.01}
          value={value}
          // Muting preserves the volume rather than zeroing it (see `clipGain`),
          // so the slider goes inert instead of jumping to 0.
          disabled={muted}
          className="data-[disabled]:opacity-40"
          onChange={set}
          onCommit={() => {
            commit()
          }}
        />
      )}
    </Field>
  )
}

function MuteControl({ clipId }: { clipId: string }) {
  const patch = useClipPatch(clipId)
  const muted = useEditorStore(
    (s) => clipById(s.project, clipId)?.muted ?? false,
  )
  return (
    <Field label="Mute">
      {() => (
        <ToggleButton
          label="Mute this clip"
          pressed={muted}
          onPressedChange={(v) => {
            patch({ muted: v })
          }}
        >
          {muted ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </ToggleButton>
      )}
    </Field>
  )
}

function AudioSection({ clipId, group }: SectionProps) {
  return (
    <Section title="Audio" name={group}>
      <VolumeControl clipId={clipId} />
      <MuteControl clipId={clipId} />
    </Section>
  )
}

export function MediaInspector({ clipId, group }: SectionProps) {
  // The only whole-clip read here, and it is for a field that cannot change
  // without the selection changing — so it never re-renders on an edit.
  const carriesAudio = useEditorStore((s) => {
    const clip = clipById(s.project, clipId)
    return clip ? clipCarriesAudio(clip) : false
  })

  return (
    <>
      <TransformSection clipId={clipId} group={group} />
      <OpacitySection clipId={clipId} group={group} />
      <CropSection clipId={clipId} group={group} />
      {carriesAudio && <AudioSection clipId={clipId} group={group} />}
    </>
  )
}
