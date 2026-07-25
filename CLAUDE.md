# Captions Bro (web)

Web version of the **captions-bro** iOS app. The iOS app burns karaoke-style
captions into videos on-device (Apple Speech transcription → styled overlay →
AVFoundation H.264 export). This is the browser port.

**Current scope (MVP):** import a video **or image** → preview it on a 16:9
canvas → export a re-encoded **H.264 + AAC MP4**, entirely client-side via
WebCodecs. Images become fixed-length still-frame clips (like the iOS app's
still→video). No transcription or caption rendering yet — the export pipeline is
built first because caption burn-in plugs directly into it.

`export.ts` has two entry points: `exportVideo` (decode→encode a video via
`Conversion`) and `exportImage` (encode a still onto a `CanvasSource` for a fixed
duration). Both return the same `ExportHandle`.

## Stack

- **TanStack Start** (SSR + Nitro server) — React 19, Vite 8, TypeScript
- **Tailwind CSS v4** (`@tailwindcss/vite`, tokens in `src/styles.css` via `@theme`)
- **mediabunny** — in-browser demux/decode/encode over WebCodecs
- **Zustand + immer** — the editor store (`src/store/`), sliced into
  document/playback/selection/export; read with atomic selectors, read
  imperatively in rAF/async via `useEditorStore.getState()`
- No backend logic, no database (persistence is client-side: localStorage +
  IndexedDB, planned in `src/lib/persistence/`)

### Layout

- `src/lib/model/` — the domain: `Project → Track[] → Clip[]` tree + a
  `MediaAsset` registry (`types.ts`), pure `factories.ts`/`selectors.ts`, and
  `scene.ts` (`resolveScene(project, t)` → the clips live at a time).
- `src/lib/render/compositor.ts` — `drawScene`, the ONE renderer (see below).
- `src/lib/transform.ts` — `mediaRect` placement math (shared geometry).
- `src/store/` — the Zustand store + slices.
- `src/lib/render/mediaPool.ts` — the live `<video>`/`<img>` decode+audio elements
  the preview draws from; `usePlayback` slaves them to the timeline clock.
- `src/lib/persistence/` — `assetStore.ts` (IndexedDB media blobs) + `projectStore.ts`
  (localStorage document JSON, blob-stripped); `usePersistence` hydrates + debounce-saves.
- `src/hooks/` — orchestration: `usePlayback` (virtual-timeline clock),
  `useMediaImport` (append clip + store blob), `useExport`, `useEditorKeyboard`,
  `useUndoRedo` (snapshot-based, over the document), `usePersistence`.
- `src/components/editor/` — the store-connected shell (TopBar, MediaPanel,
  PreviewStage, Timeline, InspectorPanel, MobileDock, ExportScreen);
  `src/components/ui/` — shadcn primitives. `MediaPanel.tsx` exports three
  pieces — `MediaRail`, `MediaBin` and the desktop `MediaPanel` — so the same UI
  serves both layouts without a JS breakpoint fork; `MobileDock` composes the
  first two below `lg`.
- `src/routes/index.tsx` — a thin shell that mounts the hooks and composes the
  shell; it holds no domain state.

### Commands (extra)

- `npm test` — Vitest unit tests (pure model/render/transform logic).

### Export

`src/lib/export.ts` → `exportProject(project)` picks the path: the fast
single-source encoder for an untrimmed single clip, else `exportTimeline` — a
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
  already-H.264 input) and `audio: { codec: 'aac' }` (no `forceTranscode`, so AAC
  sources packet-copy and export still works where there's no AAC encoder, e.g.
  Firefox). Output is MP4 with `fastStart: 'in-memory'` (moov atom at the front).
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

### Preview must always match export — one compositor

WYSIWYG is **structural**: there is a single renderer, `drawScene` in
`src/lib/render/compositor.ts`, and BOTH the preview and the export call it. The
preview (`PreviewStage`) draws it onto a `<canvas>` on a rAF loop, using hidden
`<video>`/`<img>` elements as decode + audio sources; the export (`export.ts`)
calls the same `drawScene` per frame (mediabunny's `video.process` hook for
video, `CanvasSource` for stills). Geometry comes from `mediaRect`
(`src/lib/transform.ts`); the output canvas is the project's `canvas`
(`project.canvas`, 16:9). Because both paths call one function, a new visual
feature is written once (as a `DrawItem`/layer) and cannot drift between preview
and export. The selection box/handles are a DOM overlay positioned by the same
`mediaRect` — chrome, never composited, so never exported.

### Upgrade paths

- **Large outputs:** the export uses mediabunny's `BufferTarget`, which holds the
  whole result in RAM (~2 GB practical ceiling). For bigger files, swap to a
  `StreamTarget` writing to disk / OPFS. Public API of `export.ts` need not change.
- **Caption burn-in (the reason this exists):** goes _inside_ `export.ts`, via
  mediabunny's per-frame `video.process(sample) => CanvasImageSource` hook on the
  `Conversion`. Draw the styled captions onto a canvas per timestamp and return it;
  the rest of the pipeline (encode → MP4) is unchanged.

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
- Why `lg` and not a tablet tier: desktop chrome is 608px of fixed side panels.
  At 1024 the preview still gets 416px; at 768 it gets 160px and is broken. A
  `md` tier could only shed the inspector, which renders `null` when nothing is
  selected — so shedding it at _every_ width below `lg` is free.

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
— a two-axis 16:9 contain fit against the `[container-type:size]` section. Four
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

Verify by _measuring_ computed `width/height` at 320/375/430/768/1024/1440 — it
must be 1.7778 at every one. Don't eyeball it.

### Touch-action is per-surface, never global

The timeline is simultaneously a horizontal scroller and a drag surface; touch
can't resolve that implicitly. `touch-action` is latched at gesture start from
the hit-test chain, so a `touch-none` descendant _does_ stop the ancestor
scroller panning.

| Surface                  | Setting                               | Why                                                                                    |
| ------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------- |
| scroll viewport          | `overscroll-x-contain`                | a swipe must not chain out to an iOS back-navigation                                   |
| scrub surface            | `[touch-action:pan-x_pinch-zoom]`     | native pan owns drags; pointerdown/up still fire, which is what makes tap-to-seek work |
| `ClipBox` root           | `selected ? touch-none : touch-pan-x` | unselected clips stay scroll-transparent so a long timeline is pannable anywhere       |
| trim bars, preview frame | `touch-none`                          | they own their gesture outright                                                        |

**The interaction model** (CapCut/iMovie, and the only resolution that doesn't
sacrifice one of the two gestures): _tap the ruler to seek, drag the playhead
knob to scrub precisely, tap a clip to select then drag it to reorder._ Desktop
drag-scrub is unchanged — the scrub handler branches on `pointerType`.

### Pointer gestures are exclusive and cancel-safe

Every gesture ref stores a `pointerId` and **every move/up/cancel handler must
compare it** — otherwise a second finger drives or ends someone else's gesture.
Also:

- `pointercancel` ≠ `pointerup`. Cancel means the gesture was taken away, so it
  must **never commit** (a cancelled clip drag used to run `moveClipToIndex`
  from the cancel event's `clientX`).
- Take the undo snapshot **immediately before the mutation**, not when a drag
  crosses its threshold — then an abandoned or cancelled drag leaves no entry.
- Guard `e.pointerType === 'mouse' && e.button !== 0`: `contextmenu` fires no
  `pointerup`, so a right-click otherwise starts a drag that sticks.

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
- Tooltips are hover/focus-only (Radix ignores touch by design). Any label that
  carries information available nowhere else must live in the control itself —
  e.g. the "SOON" badge on the inert rail items, and the always-visible export
  capability badge.

### Known mobile limitations (deliberate, not oversights)

- **No timeline zoom.** `TIMELINE_PX_PER_SEC = 40` is a constant, so a 3-minute
  project is 7200px — ~18 viewport-widths of panning on a phone. This is why the
  ±1s nudge buttons are load-bearing rather than a nicety. Making it dynamic
  means threading `pxPerSec` through `ClipBox` and decoupling filmstrip sampling.
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

## Conventions

- Config mirrors the sibling **postoslav** app (TanStack Start on this machine):
  same `vite.config.ts` plugin order, `tsconfig.json`, prettier/eslint setup.
- `src/routeTree.gen.ts` is **generated** by `npm run generate-routes` — committed,
  never hand-edited.
- GA4 (`G-9L6SRQ5WQV`) is wired in `src/routes/__root.tsx`'s `head().scripts` —
  the async `gtag.js` loader + the inline init snippet, server-rendered into
  `<head>` so the tag is present on load.
