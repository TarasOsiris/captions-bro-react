import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Standalone Vitest config (no app plugins). The `@` alias mirrors tsconfig —
// it is the project's ONLY path alias, so an import that resolves in the editor
// resolves here too.
//
// Two projects, because the suite has two genuinely different needs:
//   node  — the pure model / render / transform / store logic (the bulk).
//   dom   — modules that touch the document (jsdom), e.g. the persistence
//           boundary. Opt in per file with `// @vitest-environment jsdom`
//           is NOT used: the split is by path, so a test's environment is
//           obvious from where it lives rather than from a magic comment.
//
// Both include `.tsx`, so a component test no longer falls outside the glob
// the way every one of them silently did before.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  test: {
    projects: [
      {
        resolve: {
          alias: { '@': resolve(import.meta.dirname, 'src') },
        },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/**/*.dom.test.{ts,tsx}'],
        },
      },
      {
        resolve: {
          alias: { '@': resolve(import.meta.dirname, 'src') },
        },
        test: {
          name: 'dom',
          environment: 'jsdom',
          // An explicit http origin: jsdom only exposes localStorage for a
          // non-opaque origin, and the default document URL doesn't qualify.
          environmentOptions: { jsdom: { url: 'http://localhost:3000/' } },
          setupFiles: ['src/test/jsdom-setup.ts'],
          include: ['src/**/*.dom.test.{ts,tsx}'],
        },
      },
    ],
  },
})
