// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginHostListEntry } from '../../../../preload/api-types'
import { RepositoryPluginHookSourceSetting } from './RepositoryPluginHookSourceSetting'
import { buildPluginWorktreeHookOptions } from './plugin-worktree-hook-options'

const HOOK = {
  id: 'git-workspace',
  title: 'Lifecycle',
  setup: 'orca-git-workspace setup',
  archive: 'orca-git-workspace archive'
}
const SOURCE = { pluginKey: 'ewilazarus.git-workspace', contributionId: 'git-workspace' }

function plugin(overrides: Partial<PluginHostListEntry> = {}): PluginHostListEntry {
  return {
    pluginKey: SOURCE.pluginKey,
    consentFingerprint: 'sha256-x',
    name: 'git-workspace',
    version: '1.0.0',
    publisher: 'ewilazarus',
    status: 'idle',
    needsReconsent: false,
    isDev: false,
    official: false,
    bundled: false,
    capabilities: [],
    panels: [],
    commands: [],
    hasWorker: false,
    worktreeHooks: [HOOK],
    restarts: 0,
    ...overrides
  }
}

afterEach(cleanup)

describe('buildPluginWorktreeHookOptions', () => {
  it('offers each hook set, available only while Orca would run it', () => {
    expect(buildPluginWorktreeHookOptions([plugin()])).toEqual([
      expect.objectContaining({ source: SOURCE, pluginName: 'git-workspace', available: true })
    ])
    for (const blocked of [
      plugin({ status: 'pending' }),
      plugin({ status: 'disabled' }),
      plugin({ needsReconsent: true }),
      plugin({ blockedByKillList: { reason: 'malware' } })
    ]) {
      expect(buildPluginWorktreeHookOptions([blocked])[0]?.available).toBe(false)
    }
    // Older hosts omit the field entirely.
    expect(buildPluginWorktreeHookOptions([plugin({ worktreeHooks: undefined })])).toEqual([])
  })
})

describe('RepositoryPluginHookSourceSetting', () => {
  it("shows the picked plugin's commands read-only", () => {
    render(
      <RepositoryPluginHookSourceSetting
        selected={SOURCE}
        options={buildPluginWorktreeHookOptions([plugin()])}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('orca-git-workspace setup')).toBeTruthy()
    expect(screen.getByText('orca-git-workspace archive')).toBeTruthy()
    expect(screen.queryByText(/no local hook commands run/)).toBeNull()
  })

  it('warns that nothing runs while the picked plugin is unavailable or removed', () => {
    const { rerender } = render(
      <RepositoryPluginHookSourceSetting
        selected={SOURCE}
        options={buildPluginWorktreeHookOptions([plugin({ status: 'disabled' })])}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText(/no local hook commands run/)).toBeTruthy()
    rerender(
      <RepositoryPluginHookSourceSetting selected={SOURCE} options={[]} onSelect={vi.fn()} />
    )
    expect(screen.getByText(/no local hook commands run/)).toBeTruthy()
  })

  it('stays quiet when the user keeps their own scripts', () => {
    render(
      <RepositoryPluginHookSourceSetting
        selected={undefined}
        options={buildPluginWorktreeHookOptions([plugin()])}
        onSelect={vi.fn()}
      />
    )
    expect(screen.queryByText('orca-git-workspace setup')).toBeNull()
    expect(screen.queryByText(/no local hook commands run/)).toBeNull()
  })
})
