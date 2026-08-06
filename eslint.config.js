//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    rules: {
      // ON: the layering (components → hooks → store → lib, lib importing
      // none of them) is otherwise discipline-only, and a cycle here shows up
      // as an undefined import at module-init time — the hardest class of bug
      // to read back from a stack trace.
      'import/no-cycle': 'error',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
  {
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      'vite.config.ts',
      '.output',
      '.nitro',
      '.tanstack',
      'dist',
      'src/routeTree.gen.ts',
      // Unbundled service worker: served verbatim from public/, so it is a
      // classic script in a ServiceWorkerGlobalScope, not a module in src/.
      'public/sw.js',
    ],
  },
]
