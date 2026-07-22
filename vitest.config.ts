import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Standalone Vitest config (no app plugins) — unit tests target the pure model /
// render / transform logic and run in Node. The `@` alias mirrors tsconfig.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
