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
  PreviewStage, Timeline); `src/components/ui/` — shadcn primitives.
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

- `npm run dev` — Vite dev server on :3000
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
- `canExportH264()` gates the UI (Chromium/Safari 26+ can encode H.264; the button
  is disabled otherwise).

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
- **Caption burn-in (the reason this exists):** goes *inside* `export.ts`, via
  mediabunny's per-frame `video.process(sample) => CanvasImageSource` hook on the
  `Conversion`. Draw the styled captions onto a canvas per timestamp and return it;
  the rest of the pipeline (encode → MP4) is unchanged.

## Conventions

- Config mirrors the sibling **postoslav** app (TanStack Start on this machine):
  same `vite.config.ts` plugin order, `tsconfig.json`, prettier/eslint setup.
- `src/routeTree.gen.ts` is **generated** by `npm run generate-routes` — committed,
  never hand-edited.
- GA4 is added in `src/routes/__root.tsx`'s `head()` once the analytics property
  exists (see the `TODO(analytics)` marker).
