import { describe, expect, it } from 'vitest'
import {
  commitLabel,
  formatBuiltAt,
  releaseDetail,
  releaseLabel,
  shortenCommit,
} from '@/lib/buildInfo'
import type { BuildInfo } from '@/lib/buildInfo'

const info = (over: Partial<BuildInfo> = {}): BuildInfo => ({
  version: '0.1.0',
  commit: '33ae6ab1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7',
  shortCommit: '33ae6ab',
  dirty: false,
  builtAt: '2026-08-20T15:31:09.000Z',
  ...over,
})

describe('shortenCommit', () => {
  it('takes the first 7 characters', () => {
    expect(shortenCommit('33ae6ab1c2d3e4f5')).toBe('33ae6ab')
  })

  it('names the gap rather than rendering an empty one', () => {
    expect(shortenCommit('')).toBe('unknown')
  })
})

describe('releaseLabel', () => {
  it('reads version then commit', () => {
    expect(releaseLabel(info())).toBe('v0.1.0 · 33ae6ab')
  })

  it('marks a dirty tree, because the sha is then not what is running', () => {
    expect(releaseLabel(info({ dirty: true }))).toBe('v0.1.0 · 33ae6ab+')
    expect(commitLabel(info({ dirty: true }))).toBe('33ae6ab+')
  })
})

describe('releaseDetail', () => {
  it('carries the FULL sha — the short one is the only thing on screen', () => {
    expect(releaseDetail(info())).toBe(
      'Version 0.1.0 · commit 33ae6ab1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7 · built 2026-08-20 15:31 UTC',
    )
  })

  it('says so when the commit is unknown, and drops an absent build time', () => {
    expect(
      releaseDetail(info({ commit: '', shortCommit: 'unknown', builtAt: '' })),
    ).toBe('Version 0.1.0 · commit unknown')
  })

  it('spells out what the + means', () => {
    expect(releaseDetail(info({ dirty: true, builtAt: '' }))).toContain(
      '(+ uncommitted changes)',
    )
  })
})

describe('formatBuiltAt', () => {
  // The bar is SSR'd, so this must not depend on the host's zone or locale —
  // a Node/browser disagreement here is a hydration mismatch.
  it('is UTC and zero-padded regardless of the host zone', () => {
    expect(formatBuiltAt('2026-01-02T03:04:05.000Z')).toBe(
      '2026-01-02 03:04 UTC',
    )
  })

  it('passes a value it cannot parse straight through', () => {
    expect(formatBuiltAt('not-a-date')).toBe('not-a-date')
  })
})
