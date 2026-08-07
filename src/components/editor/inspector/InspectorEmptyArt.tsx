// The inspector's empty state, in the CapCut register: a stack of property
// cards with the cursor resting on the highlighted one — "pick a clip and this
// fills in".
//
// Colour is Tailwind `fill-*` / `stroke-*`, which resolve through the
// `--color-*` namespace that styles.css's `@theme inline` block populates.
// `inline` substitutes the raw `var(--accent)` / `var(--raised)` expression
// into the generated rule, so `.dark` flipping the raw token re-colours this
// drawing for free — no `dark:` classes, no second asset, no JS.
//
// GEOMETRY stays in SVG attributes. Tailwind's `stroke-*` namespace is shared
// between the colour and the stroke WIDTH, so an arbitrary value there is
// ambiguous; width is not theme-dependent and gains nothing from a utility.
//
// `max-w-32` is sized for the 224px floor: `INSPECTOR_WIDTH.min` minus the
// border, minus the scroll container's `px-3`, minus this state's `p-6` leaves
// 151px of content, so 128px keeps ~11px of air on each side.
//
// `aria-hidden`: it says nothing the sentence beneath it doesn't.

export function InspectorEmptyArt() {
  return (
    <svg
      viewBox="0 0 120 84"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="h-auto w-full max-w-32"
    >
      <rect
        x="6"
        y="4"
        width="108"
        height="13"
        rx="5"
        className="fill-raised"
      />

      {/* The property row: the card under the cursor, and its neighbour. */}
      <rect
        x="6"
        y="25"
        width="64"
        height="34"
        rx="8"
        strokeWidth="2"
        className="fill-accent/15 stroke-accent"
      />
      <rect
        x="78"
        y="25"
        width="36"
        height="34"
        rx="8"
        className="fill-raised"
      />

      <rect
        x="6"
        y="67"
        width="108"
        height="13"
        rx="5"
        className="fill-raised"
      />

      {/* Cursor, sized and placed so the whole arrow (x 38–50.6, y 33–52.2)
          stays inside the highlighted card (x 6–70, y 25–59) — its rim only
          reads if it never crosses onto the panel background.

          `paint-order: stroke` paints the halo UNDER the fill, so the
          surface-coloured outline sits around the arrow instead of eating half
          of it. Same arbitrary-property mechanism as `[container-type:size]`. */}
      <path
        d="M0 0 L0 17 L4.5 12.8 L7.1 19.2 L10.3 17.8 L7.7 11.4 L12.6 10.9 Z"
        transform="translate(38 33)"
        strokeWidth="3"
        strokeLinejoin="round"
        className="fill-accent stroke-surface [paint-order:stroke]"
      />
    </svg>
  )
}
