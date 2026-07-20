# Captions Bro (web)

Web version of the **captions-bro** iOS app. The iOS app burns karaoke-style
captions into videos on-device (Apple Speech transcription → styled overlay →
AVFoundation H.264 export). This is the browser port.

**Current scope (MVP):** import a video → preview it → export a re-encoded
**H.264 + AAC MP4**, entirely client-side via WebCodecs. No transcription or
caption rendering yet — the export pipeline is built first because caption
burn-in plugs directly into it.

## Stack

- **TanStack Start** (SSR + Nitro server) — React 19, Vite 8, TypeScript
- **Tailwind CSS v4** (`@tailwindcss/vite`, tokens in `src/styles.css` via `@theme`)
- **mediabunny** — in-browser demux/decode/encode over WebCodecs
- Single route (`src/routes/index.tsx`); no backend logic, no database

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
