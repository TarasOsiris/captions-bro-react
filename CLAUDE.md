# Captions Bro (web)

Web version of the **captions-bro** iOS app. The iOS app burns karaoke-style
captions into videos on-device (Apple Speech transcription → styled overlay →
AVFoundation H.264 export). This is the browser port.

**Current scope:** import a video **or image** → add styled **text overlays** →
preview on a 16:9 / 9:16 / 1:1 / 4:5 canvas → export a re-encoded
**H.264 + AAC MP4**, entirely
client-side via WebCodecs. Images become fixed-length still-frame clips (like the
iOS app's still→video). No transcription yet — but the burn-in it needs is done,
so it only has to generate text clips (see "Text overlays").

`export.ts` has three entry points: `exportVideo` (decode→encode a video via
`Conversion`, compositing any text overlays in its per-frame hook), `exportImage`
(encode a still onto a `CanvasSource` for a fixed duration) and `exportTimeline`
(the multi-clip compositor). All return the same `ExportHandle`.

## Stack

- **TanStack Start** (SSR + Nitro server) — React 19, Vite 8, TypeScript
- **Tailwind CSS v4** (`@tailwindcss/vite`, tokens in `src/styles.css` via `@theme`)
- **mediabunny** — in-browser demux/decode/encode over WebCodecs
- **Zustand + immer** — the editor store (`src/store/`), sliced into
  document/history/playback/selection/export/ui/clipboard; read with atomic
  selectors, read
  imperatively in rAF/async via `useEditorStore.getState()`
- No backend logic, no database (persistence is client-side: localStorage +
  IndexedDB, planned in `src/lib/persistence/`)

### Layout

- `src/lib/model/` — the domain: `Project → Track[] → Clip[]` tree + a
  `MediaAsset` registry (`types.ts`), pure `factories.ts`/`selectors.ts`,
  `scene.ts` (`resolveScene(project, t)` → the clips live at a time), and the
  per-property semantics modules — `audio.ts` (`clipGain`, `clipCarriesAudio`,
  `intendsAudio`), `visual.ts` (`clipOpacity`), `inspector.ts` (which inspector
  a selection gets). Each exists so a rule the preview and the export both need
  is written ONCE.
- `src/lib/render/compositor.ts` — `drawScene`, the ONE renderer (see below).
- `src/lib/transform.ts` — placement math (shared geometry). `placeRect` is the
  primitive: it places a source of a given NATURAL size (canvas px). `mediaRect`
  is `placeRect ∘ containFit` — media contain-fits an aspect first; a laid-out
  text block reports its measured size and goes straight to `placeRect`. Never
  add a second placement path. `visibleRect` is `croppedRect ∘ placeRect` — the
  box the chrome, the hit test and a corner anchor all want. `placeRect` scales
  about the CENTER, so a corner drag resizes and then re-pins via `anchorRectAt`
  (see "Corner resize").
- `src/lib/text/` — the text layer: `layout.ts` (PURE — wrap/measure/paint, takes
  an injected `TextMeasurer` so it unit-tests in the node vitest env; don't inline
  `ctx.measureText` into it), `measure.ts` (the lazy canvas measurer + caches),
  `fonts.ts`/`fontLoader.ts` (the curated Google Fonts set, loaded on demand),
  `presets.ts`. `src/lib/model/text.ts` holds the `TextStyle` value object.
- `src/lib/render/textSource.ts` — `textSourceForClip`, the ONE text renderer,
  shared by the preview and BOTH export paths.
- `src/store/` — the Zustand store + slices.
- `src/lib/render/mediaPool.ts` — the live `<video>`/`<img>` decode+audio elements
  the preview draws from; `usePlayback` slaves them to the timeline clock.
- `src/lib/persistence/` — `assetStore.ts` (IndexedDB media blobs) + `projectStore.ts`
  (localStorage document JSON, blob-stripped); `usePersistence` hydrates + debounce-saves.
  `layoutPrefs.ts` is the side columns' widths — chrome, not document.
- `src/lib/pwa/` — the installable-app layer: `register.ts` (service worker
  registration + the update handshake), `shareTarget.ts` (the page half of the
  Web Share Target hand-off), `install.ts` (`beforeinstallprompt` / iOS
  detection), `constants.ts` (the literals `public/sw.js` repeats).
- `src/hooks/` — orchestration: `usePlayback` (virtual-timeline clock),
  `useMediaImport` (append clip + store blob), `useExport`, `useEditorKeyboard`
  (ALL shortcuts incl. Cmd+Z — undo/redo live in the store's history slice,
  `src/store/historySlice.ts`), `usePersistence`,
  `useFontLoader` (keeps the document's faces loaded across reload/undo),
  `useLiveField` (THE per-field atomic-selector + rAF-throttled-write +
  one-undo-snapshot-per-session machinery) with its two wrappers `useTextStyle`
  and `useClipFields`, `useClipCommands` (THE clip commands — split, trim to
  playhead, duplicate, delete, cut/copy/paste — shared by the toolbar, the
  mobile pill and the keyboard, plus the `can` predicates their disabled states
  read), `usePanelResize` (the two draggable side columns),
  `useIsomorphicLayoutEffect` (a layout effect that doesn't warn under SSR),
  `useServiceWorker` / `useLaunchFiles` / `useInstallPrompt` (see "PWA").
- `src/components/editor/` — the store-connected shell (TopBar, MediaPanel,
  PreviewStage, Timeline, InspectorPanel, MobileDock, ExportScreen);
  `src/components/ui/` — shadcn primitives. `MediaPanel.tsx` exports three
  pieces — `MediaRail`, `MediaBin` and the desktop `MediaPanel` — so the same UI
  serves both layouts without a JS breakpoint fork; `MobileDock` composes the
  first two below `lg`. `inspector/InspectorBody` is shared the same way by the
  desktop column and the mobile sheet.
- `src/routes/index.tsx` — a thin shell that mounts the hooks and composes the
  shell; it holds no domain state.

### Commands (extra)

- `npm test` — Vitest unit tests (pure model/render/transform logic).

### Export

`src/lib/export.ts` → `exportProject(project)` picks the path via the pure
`planExport`: the fast single-source encoder for an untrimmed single clip (plus
any number of text overlays), else `exportTimeline` — a
frame-by-frame composite through `drawScene` using a `VideoSampleSink` per clip.
Audio in the composite path is mixed from all clips with an `OfflineAudioContext`
(scheduled by `start`/`trimIn`/`duration`/`volume`) and encoded as AAC where an
encoder exists; `ExportResult.silent` flags the case where audio existed but no
AAC encoder was available (e.g. Firefox).

## Commands

- `npm run dev` — Vite dev server on :3000 (`--host`, so a phone on the LAN can
  reach it for real-device testing; remote-debug via Safari's Develop menu)
- `npm run build` — production build (Nitro output in `.output/`)
- `npm run start` — run the built server (`node .output/server/index.mjs`)
- `npm run preview` — preview the build
- `npm run generate-routes` — regenerate `src/routeTree.gen.ts` (`tsr generate`)
- `npm run lint` / `npm run format` / `npm run check`

## Export pipeline — the one place video is touched

All video processing is **client-side**. `src/lib/export.ts` is the single seam:

- **mediabunny is imported dynamically, inside functions only** (`await import('mediabunny')`)
  — never at module top level. This keeps anything WebCodecs-touching out of the
  SSR/Nitro server bundle's evaluation path (the route is server-rendered).
- `exportVideo(file)` runs a real decode → encode: `Conversion.init` with
  `video: { codec: 'avc', forceTranscode: true }` (a genuine re-encode even for
  already-H.264 input). Audio is resolved by the pure `fastAudioMode`
  (`export/audioFast.ts`): at full volume it stays `{ codec: 'aac' }` with no
  `forceTranscode`, so AAC sources PACKET-COPY and export still works where
  there's no AAC encoder (e.g. Firefox) — that arm must stay byte-identical; a
  muted clip becomes `{ discard: true }` (exact silence, no encoder needed); and
  only a genuine partial volume decodes → scales → re-encodes, via an audio
  `process` hook. Output is MP4 with `fastStart: 'in-memory'` (moov atom at the
  front).
- `exportCapability()` gates the UI (Chromium/Safari 26+ can encode H.264; the
  button is disabled otherwise). It wraps `canExportH264()` and adds user-facing
  remediation copy, which is **platform-aware on purpose**: on iOS every browser
  is WebKit, so "try Chrome" is wrong there — the gate is the OS version. The
  capability itself is always feature-detected; `isAppleWebKit()`
  (`src/lib/platform.ts`) only picks _which advice_ to show.
- **Saving on iOS:** the post-export auto-download is skipped on Apple WebKit.
  That `<a download>` click comes from a promise continuation with no user
  activation, so Safari either ignores it or navigates the tab to the blob —
  destroying the editor session it exists to protect. `ExportScreen`'s explicit
  Share (first, where `canShare({files})` is true) / Download buttons are the
  save path there.
- **The export screen shows the render happening**, because every path reports
  its compositing canvas through one optional `onSurface` callback
  (`exportProject` → the three paths, each right after `makeOutputSurface`).
  `useExport` parks it in a ref — a live DOM object has no place in a store that
  must stay serializable — and `ExportPreview` MIRRORS it. The mirror **pulls**
  on a rAF at ~12fps rather than the encoder **pushing** a frame per composite:
  the encode is what's under time pressure, and a push would tie preview cost to
  whatever rate mediabunny happens to drain samples at. It never clears before
  drawing, so the stretch before the first composite (a dynamic import plus a
  font load) leaves the gradient underneath showing through instead of flashing
  black — `drawScene` fills the whole frame, so every real frame is opaque and
  covers the last one. The surface ref is dropped at `done`; a 1080p canvas is
  not worth pinning behind the result `<video>`.

### Preview must always match export — one compositor

WYSIWYG is **structural**: there is a single renderer, `drawScene` in
`src/lib/render/compositor.ts`, and BOTH the preview and the export call it. The
preview (`PreviewStage`) draws it onto a `<canvas>` on a rAF loop, using hidden
`<video>`/`<img>` elements as decode + audio sources; the export (`export.ts`)
calls the same `drawScene` per frame (mediabunny's `video.process` hook for
video, `CanvasSource` for stills). Geometry comes from `placeRect`
(`src/lib/transform.ts`); the output canvas is the project's `canvas`
(`project.canvas`, whose ratio the user picks). Because both paths call one
function, a new visual
feature is written once (as a `DrawItem`/layer) and cannot drift between preview
and export. The selection box/handles are a DOM overlay positioned by the same
`placeRect` — chrome, never composited, so never exported.

A `RenderSource` reports its size one of two ways, and the union's `never` arms
make it a compile error to set both: `{ aspect }` (media — contain-fit to the
canvas) or `{ size }` (a natural size already in the target canvas's pixels —
text). Contain-fitting a text box would stretch it to fill the frame, which is
why the second arm exists.

**Text is resolution-independent by construction**, because the preview canvas is
`clientWidth × DPR` while the export is 1920×1080. `TextStyle.fontSize` is a
fraction of canvas HEIGHT, `boxWidth` a fraction of canvas WIDTH, and everything
else (padding, radius, outline, shadow, tracking, line height) is in `em`. Never
store a px value in a `TextStyle`. Two further traps, both encoded in `layout.ts`:

- **Measure at `REF_FONT_PX`, never at the final size.** Font hinting makes
  `measureText` non-linear in size, so measuring at the real size yields
  DIFFERENT LINE BREAKS in a 400px preview and a 1080px export.
  `layout.test.ts` asserts identical breaks across canvas sizes — that test is
  the WYSIWYG guarantee.
- **Canvas shadows are device-space.** `ctx.scale(k)` does NOT scale
  `shadowBlur`/`shadowOffset*`; they are multiplied by `k` by hand. `lineWidth`
  IS user-space and must not be. Get this wrong and the shadow is right in the
  preview and wrong in the export.

### Upgrade paths

- **Large outputs:** the export uses mediabunny's `BufferTarget`, which holds the
  whole result in RAM (~2 GB practical ceiling). For bigger files, swap to a
  `StreamTarget` writing to disk / OPFS. Public API of `export.ts` need not change.

- **Automatic captions:** the burn-in half is DONE (see "Text overlays" below) —
  a caption is a text clip with a start and a duration. Transcription only has to
  _generate_ those clips; rendering, styling, preview and export already work.

### Text overlays & stacked lanes

The Text rail tab inserts a styled text clip at the playhead; the Inspector edits
every property. Clips stack into as many tracks as needed (the CapCut model).
Three structural rules:

- **Overlay tracks are FREE-POSITIONED, plural, and never self-overlap.**
  `repackTrack` (`documentSlice.ts`) lays a track gapless from t=0 — the magnetic
  model, right for the ONE main video track (`tracks[0]`, always) and wrong for
  overlays, which sit at arbitrary times. The `if (track.type === 'overlay')
return` guard at the top of `repackTrack` is the ONE place that distinction
  lives; it covers add/move/trim/duplicate/cross-track moves at once. Overlay
  lanes at `tracks[1..n]` hold text AND media (picture-in-picture); array order
  is z-order bottom-up, and the Timeline renders lanes REVERSED so the top lane
  draws on top with the main track at the bottom. Within one lane clips never
  overlap in time — the pure geometry in `lib/model/lanes.ts` clamps every
  free-lane commit (`resolveLaneStart`/`clampTrimToLane`), the timeline's drop
  resolver uses the same helpers so preview and commit can't disagree, and a
  drop onto occupied time stacks onto a new lane instead (the seam gesture;
  `moveClipToTrack`/`moveClipToNewTrack`). Text never joins the magnetic track.
  Lanes are created lazily on insert (`pickOverlayLane` bottom-up, else
  `addOverlayTrack`) and pruned when their last clip goes;
  `normalizeLaneOverlaps` migrates pre-lane saved documents at hydration.
- **`fontSize` is the single authority for size; `transform.scale` stays 1 for
  text.** The preview's corner handles write `fontSize`, not `scale`, so the
  Inspector's Size field and the canvas can never disagree. Because every metric
  is em-relative, scaling the font scales the whole block identically. Side
  handles set `boxWidth` (the wrap width); text has no crop and no honest
  vertical resize, so those handles don't exist for it.
- **A text clip must not cost the fast export path.** `planExport` (pure, and
  unit-tested in `export.test.ts`) partitions clips into text vs media, so a
  single untrimmed video PLUS any number of captions still goes through
  `exportVideo`, which burns them in via the `process(sample)` hook and keeps its
  AAC **packet-copy**. Falling back to `exportTimeline` there would export silent
  wherever there is no AAC encoder (Firefox). Fonts must be resolved BEFORE
  `Conversion.init`, since that hook is synchronous and cannot await.

Inline editing on the canvas is a real `<textarea>` with transparent glyphs over
the canvas-drawn text — so what is edited is literally what exports. It must stay
a textarea, not `contentEditable`: `useEditorKeyboard` already skips its global
shortcuts (undo included) for TEXTAREA targets, which is what stops Space,
Delete and Cmd+Z fighting the editor.

Google Fonts is the first runtime third-party fetch besides GA4 — a deliberate
exception to "no backend". It degrades cleanly: a blocked or offline load
resolves anyway and the family falls back to the system stack.

## Responsive & touch — the editor runs on phones

The editor is a real mobile app, not a scaled-down desktop one. The rules below
are load-bearing; several encode bugs that were expensive to find.

### One DOM tree, CSS-only breakpoints

**Never** put `useMediaQuery`/`matchMedia` in a render path. The route is
SSR'd (a media-query read during render is a hydration mismatch), and
`PreviewStage` owns the `MediaPool` `<video>` elements, a rAF compositor loop and
a `ResizeObserver` — a JS breakpoint fork would tear all three down on rotate,
dropping playback position. Panels don't move on mobile, they stop rendering
(`display:none`); the mobile replacements are `fixed` overlays or `shrink-0` flex
siblings.

- **A single `lg:` (1024px) structural fork.** Below it the media rail+bin and
  the inspector are dropped and `MobileDock` takes over. `sm:` is for text
  density only, never structure. No custom breakpoints — don't add
  `--breakpoint-*` to `@theme`.
- Why `lg` and not a tablet tier: desktop chrome starts at 608px of side panels.
  At 1024 the preview still gets 416px; at 768 it gets 160px and is broken. A
  `md` tier could only shed the inspector, which is mostly an empty state when
  nothing is selected — so shedding it at _every_ width below `lg` is free. The
  desktop collapse (below) is the manual version of the same argument.

### Both side columns are user-resizable — `usePanelResize`

At `lg+` the media column and the inspector are dragged by a `role="separator"`
handle on their outer edge, through ONE hook (`src/hooks/usePanelResize.ts`), so
the two edges cannot drift apart. The rules that keep it cheap and safe:

- **The width is written to the DOM, never to React state**, and the writes are
  rAF-coalesced. A state write per pointermove would re-render the panel's
  subtree — every inspector control, every bin tile — at pointer rate; each DOM
  write already costs a `PreviewStage` re-render through its `ResizeObserver`,
  so one per frame is the floor, not something to optimise away later.
- **`preferred` ≠ rendered.** The stored preference is the user's choice; the
  rendered width is what currently fits. Only `preferred` is persisted, and only
  a gesture that actually MOVED persists anything — otherwise a click on a
  cramped window would quietly rewrite a wider preference chosen on a big
  monitor. Cancel and no-move both restore it and save nothing.
- **The preview floor is enforced on the PAIR, in the pure `fitPanels`.** Two
  widths that are each legal alone still starve the preview once the window
  narrows, so the panels share a module-level registry and re-fit on `resize`,
  each giving up the same fraction of its slack above its own minimum. The
  re-fit is therefore reversible: widening the window restores both preferences
  exactly. `layoutPrefs.test.ts` pins that, including the both-at-minimum floor.
- **`spec.initial` is the ONLY default width.** The panel renders
  `style={{ width: spec.initial }}` — there is no `w-*` class mirroring it, or
  the two would drift and the column would jump a frame after hydration. The
  restore runs in a layout effect (SSR-guarded), before paint, or every load
  flashes the default width first.
- **The hit area grows INWARD.** A `::after` that overhangs the neighbouring
  `PreviewStage` punches a hole in the app's drop target, and a file dropped on
  a non-target navigates the tab away from the editor — session gone.
- **The separator is a real widget, and a hostile one if half-built.** It takes
  focus explicitly on pointerdown (the `preventDefault` that stops text
  selection also stops focus), and it CONSUMES every key `useEditorKeyboard`
  handles — that listener is on `window` and only skips INPUT/TEXTAREA, so an
  unconsumed Backspace on a focused splitter deletes the selected clip, and an
  unconsumed `S` splits it. The list is `EDITOR_BARE_KEY_CODES`, exported from
  `useEditorKeyboard` and matched on `event.code`: restating it here as `e.key`
  characters silently disagreed on every non-QWERTY layout (on Dvorak the
  physical `KeyS` reports `key: 'o'`). Tab and the Cmd-modified shortcuts still
  pass through. ←/→ nudge, Home/End go to the bounds, Enter and double-click
  reset.
- Each handle is the DOM child adjacent to the edge it sits on (last for the
  media column, first for the inspector), so tab order matches the eye.
- The bins reflow by themselves: `repeat(auto-fill,minmax(4.75rem,1fr))` turns a
  wider column into more tiles per row (2 at the minimum width, 5 at the
  maximum) with no breakpoint and no JS.
- The inspector column is always MOUNTED at `lg+`, empty state included, so
  selecting a clip never resizes the preview under the user. It can be hidden
  only by an EXPLICIT user action — its header `X` sets `uiSlice`'s
  `inspectorCollapsed` and the column becomes `display:none` — and **nothing
  reopens it but the user.** "Reopen the inspector when a clip is selected" is
  the obvious next idea and it is exactly the rule above, broken: it would put a
  preview resize back on the selection. The width change has to stay a thing the
  user asked for.
- **The collapsed column's edge tab is a real `shrink-0` flex sibling**
  (`INSPECTOR_TAB_W`, 20px), not an absolutely-positioned strip — an overlay
  over `PreviewStage` sits outside its dragover/drop subtree, which is the
  drop-target hole the `::after` rule above exists to avoid. For the same reason
  it is a plain `<button>`, not the `icon` `Button`, whose `after:-inset-2` would
  overhang it. Its width is a TS constant rather than a `w-*` class, per
  `spec.initial` above. It is invisible to `fitPanels`, which is safe because
  collapsing frees at least `INSPECTOR_WIDTH.min`; `layoutPrefs.test.ts` pins
  the arithmetic so raising `MEDIA_WIDTH.max` can't quietly eat the preview.
- **Collapsing and expanding hand focus over explicitly.** Both controls hide
  _themselves_, so without the handoff every toggle drops focus on `<body>` —
  where `useEditorKeyboard`'s window listener is live and a stray Backspace
  deletes the selected clip. `usePanelResize`'s `hidden` option owns the other
  half: a panel leaving the row re-fits the remaining ones in a LAYOUT effect,
  since `isLive` stops counting it on the class flip but nothing else re-fits
  (`unregister` doesn't either).

### Fixed chrome geometry lives in `styles.css`

`--timeline-h`, `--rail-h` and `--toast-offset-bottom` are the single source of
truth. The Timeline's height, the mobile sheet's anchor and the sonner offset all
read them. **Never hardcode a matching number** — `sonner.tsx` used to carry a
magic `19rem` that silently drifted from the timeline it was supposed to clear.
`--timeline-h` is `18rem` at `lg+` (byte-for-byte the old `h-72`) and
`clamp(9.5rem, 30dvh, 15rem)` below — fluid on _height_, because a landscape
phone clears every width breakpoint and still has no vertical room.

### The PreviewStage container-query contract

`PreviewStage.tsx`'s frame is `h-[min(100cqh,56.25cqw)] w-[min(100cqw,177.778cqh)]`
— a two-axis contain fit against the `[container-type:size]` section, with the
two numbers interpolated from `canvasAspect(project.canvas)` (the `min()` pair on
each axis is the contract; only the constants change). Five
invariants:

1. **The middle row in `routes/index.tsx` must stay a row-direction `flex` with
   `min-h-0`.** If its height ever becomes content-driven, `container-type: size`
   implies `contain: size`, contents contribute 0, and **the preview collapses to
   nothing.** This is the one catastrophic failure mode here.
2. **The `MobileDock` sheet must be `fixed`, never a flex sibling.** In flow it
   would shrink the section on open, changing `100cqh`, resizing the frame
   mid-session and re-firing the `ResizeObserver`.
3. The mobile rail must be `shrink-0` — it claims height once, at mount.
4. Never regress the frame to a one-axis fit (`h-full` + `max-w-full` silently
   squishes it). Padding on the section is safe: `cq*` units resolve against the
   content box, so padding is already excluded.
5. **Fullscreen promotes the section IN PLACE — never remounts or reparents
   it.** `usePreviewCompositor` captures the canvas and its 2D context once
   (deps `[canvasRef, poolRef]`, both stable refs, so the effect never re-runs)
   and `MediaSources` must stay mounted in this exact DOM position, so a second
   preview component, a portal or a conditional subtree all produce a black
   canvas plus lost audio and a lost WebKit `play()` grant. The same `<section>`
   simply swaps `STAGE_INLINE` for `STAGE_FULLSCREEN` and the container query
   starts resolving against the viewport — no new geometry. Two traps inside
   that: the swap is a WHOLE-CHUNK ternary, because `twMerge` only resolves
   conflicts within one variant (an appended `p-0` loses to `sm:p-3`/`lg:p-5`,
   and `bg-black` never clears a `bg-[radial-gradient(…)]`); and the box is
   `fixed inset-x-0 top-0 h-dvh`, not `inset-0`, because a fixed box pinned by
   `bottom:0` sizes against iOS's LARGE viewport and would put the control bar
   behind Safari's toolbar.

`container-type: size` implies `contain: layout` as well, which makes the
section a containing block for its own `position: fixed` descendants. Nothing
rendered inside PreviewStage may use `fixed` expecting viewport coordinates —
that is why `ClipContextMenu`'s virtual anchor lives in the Timeline, and why
`PreviewFullscreenControls` is `absolute`. `contain: size` stays inert in both
states because the box is extrinsically sized either way (by `flex-1` in flow,
by `top/h-dvh` out of it) — which is the same guarantee invariant 1 protects,
from a different source.

Verify by _measuring_ computed `width/height` at 320/375/430/768/1024/1440 —
in BOTH states — it must equal `canvasAspect(project.canvas)` at every one.
Don't eyeball it.

### The output canvas is a per-project choice

`CANVAS_ASPECT = 16/9` is gone. The ratio is DERIVED from `project.canvas` via
`canvasAspect` (`lib/model/canvas.ts`), because 9:16 and 1:1 are the point of a
social video editor — and a global constant living alongside a per-project value
is the `19rem` drift failure mode waiting to happen. Four rules:

- **Preset dimensions are EVEN INTEGERS, written out, never derived from a float
  ratio.** H.264 needs even dimensions and `outputCanvas` rounds to get them —
  but rounding a derived size changes the ratio: `1080 * 9/16` is 607.5, which
  becomes 606 and puts the export 0.25% off what the preview composed at.
  `canvas.test.ts` pins that `outputCanvas` is the identity on every preset.
- **`setCanvas` does NOT rewrite clip transforms.** Every field of a `Transform`
  is a fraction of the canvas, so `placeRect` re-frames each clip correctly by
  construction. Rewriting them would be a second placement path, and it would be
  LOSSY — 16:9 → 9:16 → 16:9 has to return the exact framing the user tuned
  (`documentSlice.test.ts` pins that round trip). The answer to "my clip is
  letterboxed now" is the inspector's explicit per-clip **Fill**, which is one
  undo entry and reversible.
- **No migration.** `CanvasSettings` was always persisted verbatim and the aspect
  is derived, so per `migrations.ts`'s own rule this is hydrate-time
  normalization: `normalizeCanvas` in `hydrate.ts`. `CURRENT_VERSION` stays 2.
  That also closed an older hole — `projectStore` validated `tracks` and `assets`
  but never the canvas, so a corrupt one reached `drawScene` as NaN geometry.
- **Text does not rescale either**, for the same fractional reason: `fontSize`
  stays a fraction of canvas HEIGHT and `boxWidth` a fraction of WIDTH. Accept
  the consequence — going 1920×1080 → 1080×1920 grows glyph pixels 1.78× while
  nearly halving the wrap width, so a one-line caption can become three. Making
  `fontSize` relative to the SHORT side would fix that and is backward-compatible
  (every 16:9 document has height as its short side), but it changes a stated
  invariant and belongs in its own commit.

The panel lives in the RAIL (`Panel = … | 'canvas'`), not the inspector: the rail
is served by one component at both layouts, whereas the mobile inspector sheet is
only reachable with a clip selected — so a project-level setting would be
unreachable exactly where 9:16 matters most.

### The clip context menu

`ClipContextMenu` is a Radix **Popover** over a virtual 1×1 `fixed` anchor, not
`@radix-ui/react-context-menu`: no new dependency, and `ui/popover.tsx` already
solves the hazard this needs — its outside-press must not reach PreviewStage's
frame handler, which would deselect the clip the menu is acting on. Three ways in,
one definition (the items ARE `useClipCommands`):

1. `onContextMenu` on the ClipBox (mouse). `isPrimaryPointer` already stops a
   right-press from starting a drag.
2. The `⋯` button in the mobile pill — the DISCOVERABLE touch path, and the
   reason the menu is shippable on touch at all. An affordance reachable only by
   an invisible gesture doesn't count.
3. Long-press, implemented INSIDE the existing `clipDragRef` bookkeeping (a timer
   armed on pointerdown for non-mouse, cleared past `DRAG_THRESHOLD` and by the
   one `releaseClipDrag` teardown). A parallel gesture would race the drag for
   the same pointer.

`onOpenAutoFocus` is prevented: on touch the press that opened the menu is still
in flight, and Radix focusing the content would dismiss on that same press.

### Touch-action is per-surface, never global

The timeline is simultaneously a horizontal scroller and a drag surface; touch
can't resolve that implicitly. `touch-action` is latched at gesture start from
the hit-test chain, so a `touch-none` descendant _does_ stop the ancestor
scroller panning.

| Surface                  | Setting                                 | Why                                                                                    |
| ------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------- |
| scroll viewport          | `overscroll-contain`                    | a swipe must not chain out to an iOS back-navigation                                   |
| scrub surface            | `[touch-action:pan-x_pan-y_pinch-zoom]` | native pan owns drags; pointerdown/up still fire, which is what makes tap-to-seek work |
| `ClipBox` root           | `selected ? touch-none : [pan-x_pan-y]` | unselected clips stay scroll-transparent so a long timeline is pannable anywhere       |
| trim bars, preview frame | `touch-none`                            | they own their gesture outright                                                        |
| slider root              | `touch-none`                            | same — a drag on it is never a scroll                                                  |
| fullscreen scrub bar     | `touch-none`                            | same; its hit area grows via `after:-inset-y-3`, not by thickening the line            |
| canvas text editor       | `touch-auto`                            | a tap must place the caret inside the otherwise `touch-none` frame                     |
| popover content          | `overscroll-contain`                    | the font list's scroll must not chain out to the mobile sheet                          |

Both timeline axes pan because extra lanes (text and PiP overlays) can exist: rather
than growing `--timeline-h`, extra lanes **scroll vertically inside the fixed
height**, with the ruler `sticky top-0` and the playhead knob riding it so it
stays grabbable at any scroll offset. Raising the height floor instead would
leave a landscape phone ~90px of preview, which is what `styles.css` guards.

**The interaction model** (CapCut/iMovie, and the only resolution that doesn't
sacrifice one of the two gestures): _tap the ruler to seek, drag the playhead
knob to scrub precisely, tap a clip to select then drag it to reorder._ Desktop
drag-scrub is unchanged — the scrub handler branches on `pointerType`. On an
overlay lane a drag sets an absolute time (snapped to nearby clip edges and the
playhead) rather than an index — there are no slots to reorder into. The drag is
two-axis: `resolveClipDrop` classifies the pointer against the live lane rects
into main / lane / seam (between lanes, above the stack — a NEW lane), the ONE
resolver both the indicator and the commit use. Same-lane drags clamp flush
against siblings; cross-lane drops onto occupied time stack a new lane instead.

### Timeline scale — zoom is a parameter, not a constant

`TIMELINE_PX_PER_SEC` is gone. The scale is `uiSlice.pxPerSec`, and every
px↔time function takes it EXPLICITLY (`timeToX`, `xToTime`, `tickStep`,
`tickModel` in `lib/timeline/ruler.ts`) with no default — a default is how a
stale call site survives the switch while still measuring at the old fixed
scale, silently, and only visibly once you zoom. The bounds and the scroll
arithmetic are pure in `lib/timeline/zoom.ts` (`clampZoom`, `zoomBy`, `fitZoom`,
`anchorScrollLeft`, `zoomAnchorTime`, `snapToleranceSec`), all unit-tested.

Five rules carry it:

- **Zoom is SESSION state, in `uiSlice` — never in `Project`.** In the document
  it would be captured by every undo snapshot (so Cmd+Z would un-zoom), saved
  into the file, and would dirty the autosave on every wheel tick. It is
  deliberately not persisted either: restoring a scale without its scroll
  offset is disorienting, and the scale was chosen for a different project's
  duration. **This is the general rule for chrome state**, not a fact about
  zoom: `inspectorCollapsed` lives in `uiSlice` on the same reasoning (plus one
  of its own — it drives a `className` on an SSR'd route, so a value restored
  from localStorage would be a hydration mismatch).
- **The pivot is captured by the COMMAND, restored before PAINT.** Once
  `pxPerSec` has changed the old scale is gone and the anchor can no longer be
  computed, so `applyZoom` stores it in a ref first; a `useIsomorphicLayoutEffect`
  then writes `scrollLeft` before the browser paints. In a plain effect the
  timeline visibly lurches sideways for one frame on every zoom step.
- **Playhead-follow is mandatory, not a nicety.** At 500px/s the playhead leaves
  a laptop viewport in about two seconds. It is a store subscription writing
  `scrollLeft` imperatively, rAF-coalesced, suppressed while any gesture is live
  — and it reads the ResizeObserver's tracked width rather than `clientWidth`,
  because it runs right after React commits the playhead's `style.left` and a
  layout read there forces a flush every frame.
- **The scroll offset lives in `RulerTicks`, not in `Timeline`.** It is the only
  thing that changes at pointer rate during a plain pan, so holding it in the
  Timeline's state re-renders every `ClipBox` and both tool rows on every frame
  of the one gesture a long timeline is made of. The tick window is also
  quantized to `SCROLL_BUCKET_PX`, so even that row re-renders per bucket of
  travel rather than per frame.
- **A zoom re-renders every `ClipBox` by construction** (they all resize), so
  the wheel handler is rAF-coalesced and one render per frame is the floor —
  the documented exception to "a continuous edit must not re-render the
  timeline", which is about document mutation.

Filmstrip sampling is decoupled from it: `FILMSTRIP_SEC_PER_FRAME` in
`thumbs.ts` is a rate in SECONDS, since the strip is generated once at import
and a px-derived rate would bake whatever zoom was active into the asset. The
renderer caps `tileCount` at the strip's length and stretches the tiles past
that, rather than repeating frames in a stutter.

### Pointer gestures are exclusive and cancel-safe

Every gesture ref stores a `pointerId` and **every move/up/cancel handler must
compare it** — otherwise a second finger drives or ends someone else's gesture.
Also:

- `pointercancel` ≠ `pointerup`. Cancel means the gesture was taken away, so it
  must **never commit** (a cancelled clip drag used to run `moveClipToIndex`
  from the cancel event's `clientX`).
- Announce the edit **before mutating** — `beginEdit()` for a discrete edit,
  `beginEditSession()`/`endEditSession()` around a drag (store history slice).
  The snapshot itself is LAZY (taken at the first real mutation), so an
  abandoned or cancelled drag leaves no entry by construction.
- Guard `e.pointerType === 'mouse' && e.button !== 0`: `contextmenu` fires no
  `pointerup`, so a right-click otherwise starts a drag that sticks.
- **Mounting a focusable element from inside a `pointerdown` handler needs
  `e.preventDefault()`.** Otherwise that same press's default action then moves
  focus to the element under the cursor, blurring what you just focused. The
  double-tap-to-edit text editor closed itself the instant it opened until this
  was added — and it fails silently, because the state IS set, just reverted a
  tick later by the blur handler.

### Corner resize is anchored on the OPPOSITE corner

`transform.tx/ty` place the box by its CENTER, so scaling alone grows it in every
direction at once — the corner you grabbed and the one across from it both run
away from the pointer. Every editor instead pins the opposite corner. The gesture
is therefore three steps, and the middle one is the whole trick:

1. The drag factor is `dist(pointer, anchor) / dist(pointer₀, anchor)` — measured
   from the pinned corner, never from the center (`anchorDist` in `PreviewStage`;
   it needs live client coords, so it's the one step not in `transform.ts`).
2. Resize: `applyScale` for media, `fontSize` for text.
3. `anchorRectAt` slides the result until the anchor's fractional point is back
   where it was. Re-pinning AFTER the fact rather than predicting the translation
   is what keeps it exact when either clamp refuses part of the drag.

`anchorRectAt` re-derives the box from a natural size passed in, which is why it
survives text: a bigger font at a fixed `boxWidth` **re-wraps**, so the block's
new height is not a multiple of the old one and no similarity-transform shortcut
works. The handler therefore measures the RESIZED clip before placing it, and
writes resize + placement in ONE `updateClip` — two writes let the rAF compositor
draw a frame at the new size in the old spot, which reads as jitter. The anchor
is stored in FRAME-local px (a scroll mid-gesture must not move it) and is a
point on the VISIBLE box, so a trimmed media rect pins its cropped corner.

**Media and text share ONE `corner` gesture**, not two parallel ones. Everything
about the drag — anchor, factor, re-pin, the single write — is identical; the
only difference is which field absorbs the factor, and that is one ternary on
`startFontSize`. Adding aspect-lock or snapping should stay a single edit. The
side/edge handles are deliberately untouched: `crop` already anchors its opposite
edge by construction (`croppedRect` shifts the center toward the kept side), and
`wrap` still widens about the center.

### Hit areas grow via a transparent `::after`, not size bumps

Trim bars, preview scale/crop handles and the rotate button mark _exact geometric
edges_ — growing the visual moves where the user reads the edge to be, and the
trim bars would visually swallow neighbours on a gapless-packed track. A
transparent `after:-inset-*` lifts the hit area with zero visual change, no extra
DOM, and `pointer-events` inherited from the host (so `setPointerCapture` still
works). The `Button` `icon` variant does the same, fixing ~20 call sites at once.

Deliberately **not** `@media (pointer: coarse)` size bumps: bigger targets are
right for every input, and coarse misfires on hybrids (touchscreen laptops,
iPad + trackpad).

### Other rules

- **All bin→timeline insertion goes through `useClipInsert`**, so the desktop
  drag-and-drop path and the touch tap-to-add path cannot diverge. HTML5 DnD
  does not exist on touch, so the `+` affordance on a bin tile is the only way to
  insert into the middle of a timeline on a phone.
- **iOS: `play()` must be issued inside the gesture's own task** — see
  `primeAndPlay` in `usePlayback.ts`. The rAF clock calls `play()` from a later
  task, which WebKit refuses; the rejection used to be swallowed, so the playhead
  advanced over a frozen frame while the export came out fine. Never swallow
  `NotAllowedError` — stop the clock and say so.
- **Safe areas:** the viewport meta carries `viewport-fit=cover` (without it
  every `env(safe-area-inset-*)` is 0), and the manifest declares
  `display: standalone`, so an installed PWA owns the full screen. The mobile
  rail is the single owner of `env(safe-area-inset-bottom)`.
- **Grid cells that can be `display:none` need explicit placement.** A hidden
  grid item is removed from the grid entirely, so its siblings auto-place into
  _its_ track — which is why the Timeline transport carries `col-start-2`.
- **The z budget tops out at 60, and 50 is shared.** `ExportScreen`, the mobile
  rail, popovers and tooltips are all `z-50`; the fullscreen stage is `z-[60]`
  because it must cover the rail, which is later in the DOM. That means z-order
  cannot also express "below the export screen" — so the two are made mutually
  exclusive at RENDER time (`routes/index.tsx` passes
  `fullscreen={previewFullscreen && exportPhase === 'idle'}`), not by an effect.
  An effect runs after paint, which is one frame of preview over the screen that
  owns the finished MP4 on iOS.
- Tooltips are hover/focus-only (Radix ignores touch by design). Any label that
  carries information available nowhere else must live in the control itself —
  e.g. the "SOON" badge on the inert rail items, the `role="tab"`/`aria-selected`
  on the rail, and the always-visible export capability badge.
- **A continuous edit must not re-render the timeline, and must not spam undo.**
  immer hands out a new `project` on every mutation, and both `Timeline` and
  `PreviewStage` subscribe to it wholesale — so a slider drag would otherwise
  re-render every `ClipBox` at 60fps. Three defences, and all three are load-
  bearing: `ClipBox` is `memo`'d (which needs every handler prop to be a stable
  `useCallback`, hence `selectClipAt` reading `currentTime` via `getState()`
  rather than closing over it); inspector controls subscribe per-FIELD through
  `useLiveField` (via `useTextStyleField` / `useClipFields`); and writes are
  rAF-throttled. Undo takes ONE snapshot per
  editing session — `beginEditSession()` on the first write of a drag,
  `endEditSession()` on commit/blur (the store's history slice; never per frame
  or keystroke). Every document mutation flows through `documentSlice`'s
  `mutate` wrapper, which also bumps `documentRevision` and clears a stale
  finished export (`store/touch.ts`) — never call `resetExport` for that.
  `usePersistence`'s 300ms debounce already collapses a whole
  drag into a single save; don't "optimise" it.

### Known mobile limitations (deliberate, not oversights)

- **No pinch-to-zoom on the timeline.** Zoom itself exists (see "Timeline
  scale"), but reaching it by pinch would mean dropping `pinch-zoom` from the
  scrub surface's `touch-action`, which is kept deliberately so the PAGE stays
  zoomable for accessibility. The −/+/Fit buttons and ⌘+/−/0 are the whole
  story; a pinch would need its own CLAUDE.md amendment.
- **No pinch-to-scale / two-finger rotate** on the preview. Reachable via the
  corner handles and rotate button; pinch needs centroid-preserving geometry in
  `transform.ts` (with tests), which is a feature, not a fix.
- **One `<video>` element per clip stays mounted.** iOS caps simultaneously
  decodable media elements, so a many-clip project may fail on an iPhone. The fix
  is a windowed pool in `mediaPool.ts`.
- **Export holds the whole MP4 in RAM** (`BufferTarget`); mobile Safari discards
  tabs far below the ~2 GB desktop ceiling. See the `StreamTarget`/OPFS upgrade
  path above. A screen wake lock is held during export to reduce the odds of the
  tab being discarded.
- **The software keyboard can cover the inline text editor.** Double-tap-to-edit
  on the canvas is the FAST path; the Inspector's Content field (reachable from
  the timeline's contextual Edit button) is the reliable one. Both write through
  the same store action, so they cannot diverge.
- **No per-line caption backgrounds** (the Instagram look) — the background box
  wraps the whole block. Per-line boxes need the layout to emit one rect per
  line, which is a feature, not a fix.
- **iPhone Safari has no `Element.requestFullscreen`**, so the fullscreen
  preview there is the CSS overlay alone — the video fills the app, the browser
  chrome stays. That is the whole intended fallback, and `lib/fullscreen.ts`
  feature-detects rather than branching on `isAppleWebKit` (which exists to pick
  copy, never capability). **Never** reach for
  `HTMLVideoElement.webkitEnterFullscreen` on a pool `<video>` to "fix" it: it
  hands the raw decoded source to the native player — no compositor, no text
  overlays, no WYSIWYG. It is the tempting wrong answer.

## PWA — the editor installs and runs offline

Nothing about this app needs a server at runtime, so "installable, offline,
receives files from the OS" is the honest shape for it, not a badge. Four parts:
`public/site.webmanifest`, `public/sw.js`, `src/lib/pwa/` and the three hooks
mounted by `routes/index.tsx` (`useServiceWorker`, `useLaunchFiles`, plus
`useInstallPrompt` behind `TopBar`'s `InstallButton`).

### The service worker must never be the thing that goes stale

`public/sw.js` is served verbatim from `public/` — plain JS, no build step, no
bundler, no precache manifest. It is therefore **byte-identical across deploys**,
and the caching strategy is designed so that doesn't matter:

- **Documents are network-first** (3.5s timeout → cached shell). Online you
  always boot the current HTML. A stale-while-revalidate shell would be faster
  and would hand out HTML pointing at a previous build's asset hashes for one
  load after every deploy.
- **`/assets/*` is cache-first**, because Vite content-hashes it: immutable URLs
  mean cache-first can't serve a wrong version. That cache is trimmed by entry
  count (oldest-first), never purged on version bump — so a previously cached
  build still boots offline.
- `CACHE_VERSION` exists only to force a clean sweep when the STRATEGY changes.
  Bump it then. **Do not bump it per release** — nothing depends on it.
- Google Fonts are cached (SWR for the UA-varying stylesheet, cache-first for the
  immutable woff2), which is what makes text render in the right face offline.
  GA4 is deliberately never cached and simply fails offline.
- **Install scrapes `/assets/…\.(js|css)` out of the shell HTML** and caches those
  chunks itself. Without it, offline only works from the SECOND visit: the first
  page load happens before the worker controls the client, so its asset requests
  never reach the fetch handler. Lazily-imported chunks (mediabunny, inside
  `export.ts`) are still picked up by the runtime rule on the first online export.
- **Precache into the cache the fetch handler READS.** The document goes to
  `SHELL_CACHE` because that's where `networkFirstDocument` looks; icons and the
  manifest go to `STATIC_CACHE` because that's where `isStaticAsset` routes them.
  Putting the icons in `SHELL_CACHE` (as this originally did) is dead bytes — it
  looks precached, and the TopBar logo still breaks on a first-visit-then-offline
  reload. The `?v=2` suffixes matter too: `Cache.match` keys on the full URL.
- **A 5xx falls back to the cached shell**, a 4xx does not. The origin being
  unwell says nothing about an app that runs entirely client-side, so a deploy
  blip should serve the shell rather than the host's error page; a 404 is an
  answer, not an outage.
- Range requests (`<video>` seeking) and non-GET are passed straight through.

### The update handshake never interrupts an export

The worker **does not call `skipWaiting()` on its own**. A new build taking over
mid-session would swap the asset set under a running encode. Instead `register.ts`
reports a `waiting` worker, `useServiceWorker` shows a toast, and only the user's
click posts `SKIP_WAITING` and reloads on `controllerchange`. `onUpdate` fires
only when a controller already exists — the first visit is an install, not an
update, and must not prompt a reload.

**The toast tracks `exportPhase` for its whole life, not just at show time.** It
is `duration: Infinity`, sonner floats above `ExportScreen`'s `z-50`, and
`--toast-offset-bottom` puts it exactly over the Share/Download row — so a toast
raised while idle and left up is a mis-tap away from reloading over a running
encode. A store subscription dismisses it when the phase leaves `idle` and
re-raises it on the way back; the waiting worker stays waiting throughout, so
nothing is lost by hiding the offer.

**In DEV the hook does the opposite and unregisters everything.** `npm run dev`,
`preview` and `start` all share `localhost:3000`, so a worker installed by a
production build would keep serving cached prod assets over the dev server and
make source edits look like they did nothing.

### OS entry points funnel into the one importer — and must be gated by hand

`file_handlers` (Open with → Captions Bro) and `share_target` (the Android /
ChromeOS share sheet) both end at the same `handleImport` the picker and the drop
target use — via `useLaunchFiles`.

**This is the one import path with no UI in front of it, so it carries its own
guards.** Every in-app path inherits safety from the chrome: `ExportScreen`
covers the editor whenever `exportPhase !== 'idle'`, the panels disable
themselves, `useEditorKeyboard` takes `enabled`. The OS calls in from outside all
of that, and `focus-existing` guarantees it lands in a RUNNING session. So
`routes/index.tsx` passes `ready: hydrated && exportPhase === 'idle'`, and
anything arriving early is HELD and flushed when the gate opens:

- **Not before hydration.** `usePersistence` restores asynchronously and installs
  the result with `replaceProject`, which swaps the document wholesale — an
  import that lands first is silently erased. That's why `usePersistence` returns
  `{ hydrated }` at all.
- **Not during an export.** Importing mutates the document, and any document
  mutation at phase `done` clears the finished export (the store's
  `touchDocument` seam) — unmounting `ExportScreen` and stranding the finished
  MP4, which on iOS is reachable ONLY from that screen. Mid-encode it would
  edit the project out from under the running encode.

Two more things are load-bearing:

- **`launch_handler: focus-existing`.** The default (`navigate-existing`) would
  reload the open editor, dropping the very session the file is meant to join.
- **Share target has no server route.** `sw.js` intercepts the POST, parks the
  files in a Cache and 303s to `/?share-target=1`; `lib/pwa/shareTarget.ts` reads
  that inbox. **The INBOX is the trigger, not the `?share-target=1` flag** —
  under `focus-existing` a share into an already-open app focuses the window
  without navigating, so no flag ever appears; flag-only detection silently
  dropped those. `useLaunchFiles` drains on mount, on a launch whose `targetURL`
  carries the flag, and on `visibilitychange`. Reading and deleting are also
  separate (`peekSharedFiles` / `discardSharedFiles`): the delete happens only
  once the files reach the importer, because the OS keeps no copy to re-share.
  Entries expire after `SHARE_TTL_MS` on both sides — the inbox holds whole video
  files, and an abandoned share would otherwise pin gigabytes against the origin
  quota until IndexedDB persistence started failing.
  A Cache is the only storage the worker and the page both reach without agreeing
  on an IndexedDB schema.

**The three-file contract is test-enforced, not comment-enforced.** The share
path, cache name, inbox prefix and theme colour have to exist as literals in
`constants.ts`, `public/sw.js` (plain JS, cannot import) and
`site.webmanifest` (JSON, same problem). `lib/pwa/constants.test.ts` reads the
latter two as TEXT and fails if any value drifts — otherwise this is the `19rem`
failure mode again, invisible until a real share-to-app breaks on someone's
phone. Everything that _can_ be imported, is: `lib/seo.ts` takes its SSR
`theme-color` from `THEME_COLOR` in `lib/theme.ts` rather than repeating the hex.

### Install affordance, icons, colour

- Chromium's `beforeinstallprompt` is captured (suppressing the mini-infobar) and
  replayed from `InstallButton`. **iOS has no API at all**, so the same button
  opens a popover describing Share → Add to Home Screen — a popover, not a
  tooltip, because Radix tooltips are hover/focus-only and would be unreachable on
  exactly the devices that need them. Same rule as the export gate: platform
  detection picks the COPY, never the capability.
- **Maskable icons are a separate pair of files.** `app-icon-*.png` is the iOS-style
  rounded square; feeding that to Android's adaptive mask clips its corners.
  `app-icon-maskable-*.png` is the same art at 66% on a full-bleed gradient whose
  ramp continues the artwork's own, so the inner square's edge is invisible and
  everything sits inside the 80% safe circle.
- **The theme colour tracks `--surface`, NOT `--bg`**, because the status bar sits
  directly above the `bg-surface` TopBar. `THEME_COLOR` in `lib/theme.ts` is the
  source of truth; `lib/seo.ts` imports it and the manifest's copy is checked by
  `constants.test.ts` (see above). `apple-mobile-web-app-status-bar-style`
  is `default` on purpose: it makes WebKit tint the status bar from `theme-color`
  (which `theme.ts` rewrites per theme), whereas `black-translucent` would force
  white status text over a white light-theme TopBar.
- The manifest's `screenshots` are real captures of a seeded demo project. If the
  chrome changes materially, re-shoot them — a stale screenshot in the install
  dialog is worse than none.

## Conventions

- Config mirrors the sibling **postoslav** app (TanStack Start on this machine):
  same `vite.config.ts` plugin order, `tsconfig.json`, prettier/eslint setup.
- `src/routeTree.gen.ts` is **generated** by `npm run generate-routes` — committed,
  never hand-edited.
- GA4 (`G-9L6SRQ5WQV`) is wired in `src/routes/__root.tsx`'s `head().scripts` —
  the async `gtag.js` loader + the inline init snippet, server-rendered into
  `<head>` so the tag is present on load.
