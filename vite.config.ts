import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

// ── Release identity ─────────────────────────────────────────────────────────
// Baked in at BUILD time through `define` (a literal text substitution), never
// read at runtime. Two reasons that has to be the shape:
//   - The route is SSR'd. A value the server derives and the client re-derives
//     is a hydration mismatch waiting to happen; a substituted literal is
//     byte-identical in the server bundle and the client bundle by construction.
//   - The deployed container has no git and no repo — only the bundle it was
//     handed — so nothing can be asked about the commit after the build.
// `src/lib/buildInfo.ts` is the only reader.

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./package.json', import.meta.url)),
    'utf8',
  ),
) as { version?: string }

function git(...args: Array<string>): string {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      // Swallow git's own stderr: outside a checkout this is an expected miss,
      // not a build problem, and the fallbacks below cover it.
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

// A deploy usually builds from an export with no `.git` at all (this app ships
// through Coolify/nixpacks), but every platform hands the sha over in the
// environment. Those win: where one is set, the working tree either doesn't
// exist or isn't the thing being released.
const commitFromEnv =
  process.env.SOURCE_COMMIT ||
  process.env.COOLIFY_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.CF_PAGES_COMMIT_SHA ||
  ''

const commit = commitFromEnv || git('rev-parse', 'HEAD')
// Only ask when the sha came from a working tree we can actually inspect —
// otherwise "clean" would be an assumption dressed up as a fact.
const dirty =
  !commitFromEnv && commit !== '' && git('status', '--porcelain') !== ''

const config = defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
    __GIT_COMMIT__: JSON.stringify(commit),
    __GIT_DIRTY__: JSON.stringify(dirty),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), nitro(), tailwindcss(), tanstackStart(), viteReact()],
})

export default config
