// The release identity shown in the TopBar: which version, built from which
// commit, when.
//
// The values arrive as build-time literals substituted by `define` in
// vite.config.ts (see the comment there for why it has to be a substitution and
// not a runtime lookup). This module is the ONLY reader of those globals — every
// consumer goes through `BUILD_INFO` and the formatters below, so the string in
// the bar and the string in its tooltip can't drift into two different ideas of
// what a version looks like.

// Ambient, module-scoped: `declare` emits nothing, so the identifiers stay free
// for `define` to replace, while TypeScript still types them.
declare const __APP_VERSION__: string
declare const __GIT_COMMIT__: string
declare const __GIT_DIRTY__: boolean
declare const __BUILD_TIME__: string

export interface BuildInfo {
  /** `package.json`'s version. */
  version: string
  /** Full sha, or '' where the build had neither a checkout nor a CI env var. */
  commit: string
  /** The first 7 of `commit`, or `unknown`. */
  shortCommit: string
  /** The tree had uncommitted changes at build time — i.e. this is NOT `commit`. */
  dirty: boolean
  /** ISO timestamp, or '' if it wasn't injected. */
  builtAt: string
}

const UNKNOWN_COMMIT = 'unknown'

/** Display form of a sha: 7 chars, or a word rather than an empty gap. */
export function shortenCommit(commit: string): string {
  return commit ? commit.slice(0, 7) : UNKNOWN_COMMIT
}

// The `typeof` guards are for the unit tests and nothing else: vitest.config.ts
// is a standalone config with no `define`, so the identifiers are genuinely
// absent there. In every real build all four are substituted and these fold away.
const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
const commit = typeof __GIT_COMMIT__ === 'string' ? __GIT_COMMIT__ : ''
const dirty = typeof __GIT_DIRTY__ === 'boolean' ? __GIT_DIRTY__ : false
const builtAt = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''

export const BUILD_INFO: BuildInfo = {
  version,
  commit,
  shortCommit: shortenCommit(commit),
  dirty,
  builtAt,
}

/** `v0.1.0 · 33ae6ab` — the full label. The `+` marks a dirty tree. */
export function releaseLabel(info: BuildInfo = BUILD_INFO): string {
  return `v${info.version} · ${commitLabel(info)}`
}

/** `33ae6ab` — just the build identity, for widths that can't afford the rest. */
export function commitLabel(info: BuildInfo = BUILD_INFO): string {
  return `${info.shortCommit}${info.dirty ? '+' : ''}`
}

/** The long form, for the title/tooltip: full sha, and when it was built. */
export function releaseDetail(info: BuildInfo = BUILD_INFO): string {
  const parts = [
    `Version ${info.version}`,
    `commit ${info.commit || UNKNOWN_COMMIT}${info.dirty ? ' (+ uncommitted changes)' : ''}`,
  ]
  if (info.builtAt) parts.push(`built ${formatBuiltAt(info.builtAt)}`)
  return parts.join(' · ')
}

/**
 * `2026-08-20 15:31 UTC`.
 *
 * Formatted by hand in UTC rather than through `toLocaleString`: the bar is
 * server-rendered, and a locale/zone-dependent string is exactly the kind of
 * value that renders one way in Node and another in the browser. UTC is also
 * the right frame for "which build is deployed" — the reader and the builder
 * are rarely in the same zone.
 */
export function formatBuiltAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
  )
}
